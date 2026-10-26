"""Photo intake: robot photo -> ESTIMATED RobotSpec draft (+ SAM cross-check).

Two live layers, both on the Meta Model API via the registered
``custom.meta-model-api`` connector (the credential enters requests as a
platform surrogate through ``dynamic_credentials``; no raw key ever enters
this process, the environment, or the repo):

1. ``draft_spec_from_photo`` — one Muse Spark vision chat call. The model
   inspects the photo, names the parts it can actually see, gives its best
   identity guess for the robot, and drafts a spec in the existing schema.
   A photograph carries no scale reference, so EVERY dimension in the draft
   is an estimate from the robot's apparent proportions and typical parts —
   the draft says so, and callers must too. Nothing here is measured.

2. ``locate_parts`` — SAM 3.1 (``sam-3.1`` on POST /v1/responses, streamed)
   localizes one text concept per call ("wheel", "camera", ...) and returns
   region boxes. It cross-checks the vision draft's visible counts; it does
   not identify robots or recover scale. An empty result is a valid answer
   (zero matches), not an error. Verified live 2026-10-26: 3 wheel regions
   with boxes/confidences on a real TurtleBot photo; zero matches on a
   cartoon-style synthetic image (a real limit, kept visible to callers).

Photo mode needs the connector environment. Outside it (no
``dynamic_credentials`` module), both entry points raise SpecError saying so
instead of guessing.
"""
from __future__ import annotations

import base64
import json
import os
import re
import sys
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

from .describe import DEFAULT_MODEL, SYSTEM_PROMPT
from .schema import RobotSpec, SpecError

API_BASE = os.environ.get("META_API_BASE", "https://api.meta.ai/v1")
SAM_MODEL = "sam-3.1"
_CONNECTOR_BIN = "/opt/muse/skills/custom-connector-setup/bin"
_PROVIDER = "custom.meta-model-api"
_HOSTS = ["api.meta.ai"]

PHOTO_INSTRUCTIONS = """
You are now looking at a PHOTO of a robot (attached as an image). Work from
what is actually visible in the photo, not from a typical robot.

Output ONLY one JSON object with exactly these keys:
- "identity_guess": your best identification of the robot (e.g. "TurtleBot 2
  (iRobot Create base, Kinect sensor)"), or "unknown custom robot" if you
  cannot identify it. Never state an identity you are not fairly confident
  about; a wrong name is worse than "unknown".
- "visible_parts": a list of {"kind": ..., "count": ..., "position": ...,
  "notes": ...} for parts you can SEE in the photo (wheels, cameras, lidar,
  arms, antennas...). "count" is how many are VISIBLE, which may be fewer
  than the robot really has (occlusion). Do not list parts you cannot see.
- "spec": the robot specification object, in exactly the field format
  described above.

Dimensions: a photo has no scale reference, so every length, mass and size
in the spec is an ESTIMATE from apparent proportions and the typical size
of the identified robot or parts — never present a dimension as measured.
If you recognized the robot model, use its published approximate size as
the estimate basis and say so in the spec "description" (prefix the
description with "Photo draft (all dimensions ESTIMATED): "). Keep the
design physically coherent: ground clearance must not exceed the wheel
radius, and the motor voltage must not exceed the battery voltage. For a
two-visible-wheel differential base with a caster, wheel count is the
number of DRIVE wheels (usually 2), not the visible total.
"""


# --------------------------------------------------------------------------
# transport (connector surrogate, same mechanism as meta_api.py)
# --------------------------------------------------------------------------

class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        raise RuntimeError("redirect refused, verify the endpoint")


def _surrogate_opener():
    """Build an opener + credential hook, or raise SpecError if the
    connector environment is unavailable."""
    if _CONNECTOR_BIN not in sys.path:
        sys.path.insert(0, _CONNECTOR_BIN)
    try:
        from dynamic_credentials import add_surrogate_to_request
    except ImportError as exc:
        raise SpecError(
            "photo mode requires the Meta Model API connector environment "
            f"(dynamic_credentials not importable from {_CONNECTOR_BIN}); "
            "run inside the workspace with the custom.meta-model-api "
            "connector registered") from exc
    return add_surrogate_to_request, urllib.request.build_opener(_NoRedirect())


def _post_json(path: str, body: dict, timeout: int = 240) -> dict:
    hook, opener = _surrogate_opener()
    req = urllib.request.Request(
        f"{API_BASE}{path}", data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"})
    hook(req, _PROVIDER, allowed_hosts=_HOSTS)
    try:
        with opener.open(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:400]
        raise SpecError(f"Meta Model API HTTP {exc.code} on {path}: "
                        f"{detail}") from exc


def _post_stream_lines(path: str, body: dict, timeout: int = 240):
    """Yield decoded lines of a streamed (SSE) response."""
    hook, opener = _surrogate_opener()
    req = urllib.request.Request(
        f"{API_BASE}{path}", data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json",
                 "Accept": "text/event-stream"})
    hook(req, _PROVIDER, allowed_hosts=_HOSTS)
    try:
        with opener.open(req, timeout=timeout) as resp:
            for raw in resp:
                yield raw.decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:400]
        raise SpecError(f"Meta Model API HTTP {exc.code} on {path}: "
                        f"{detail}") from exc


# --------------------------------------------------------------------------
# vision draft (Muse Spark)
# --------------------------------------------------------------------------

@dataclass
class VisiblePart:
    kind: str
    count: int
    position: str = ""
    notes: str = ""


@dataclass
class PhotoDraft:
    spec: RobotSpec
    identity_guess: str
    visible_parts: list[VisiblePart] = field(default_factory=list)


_MIME = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
         ".webp": "image/webp", ".gif": "image/gif"}


def image_data_uri(image_path: str | Path) -> str:
    p = Path(image_path)
    mime = _MIME.get(p.suffix.lower())
    if not mime:
        raise SpecError(f"unsupported image type {p.suffix!r} for {p}")
    if not p.is_file():
        raise SpecError(f"photo not found: {p}")
    return f"data:{mime};base64," + base64.b64encode(p.read_bytes()).decode()


def parse_photo_payload(payload: dict) -> PhotoDraft:
    """Parse a chat-completions payload from the photo prompt (pure)."""
    try:
        text = payload["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError, TypeError) as exc:
        raise SpecError(f"photo response has no message content: {exc}") \
            from exc
    if text.startswith("```"):
        text = text.strip("`").removeprefix("json").strip()
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise SpecError(f"photo response is not valid JSON: {exc}") from exc
    if not isinstance(data, dict) or "spec" not in data:
        raise SpecError("photo response JSON has no 'spec' object: "
                        + text[:200])
    parts = []
    for entry in data.get("visible_parts", []):
        try:
            parts.append(VisiblePart(
                kind=str(entry["kind"]), count=int(entry["count"]),
                position=str(entry.get("position", "")),
                notes=str(entry.get("notes", ""))))
        except (KeyError, TypeError, ValueError):
            continue  # a malformed part note must not sink the whole draft
    return PhotoDraft(
        spec=RobotSpec.from_dict(data["spec"]),
        identity_guess=str(data.get("identity_guess",
                                    "unknown custom robot")),
        visible_parts=parts)


def draft_spec_from_photo(image_path: str | Path,
                          model: str | None = None) -> PhotoDraft:
    """One Muse Spark vision call: photo -> ESTIMATED spec draft."""
    model = model or os.environ.get("RF_MODEL") or DEFAULT_MODEL
    body = {
        "model": model,
        "messages": [
            {"role": "system",
             "content": SYSTEM_PROMPT + PHOTO_INSTRUCTIONS},
            {"role": "user", "content": [
                {"type": "text",
                 "text": "Draft a robot specification from this photo."},
                {"type": "image_url",
                 "image_url": {"url": image_data_uri(image_path)}},
            ]},
        ],
        "temperature": 0.2,
    }
    payload = _post_json("/chat/completions", body)
    return parse_photo_payload(payload)


# --------------------------------------------------------------------------
# SAM 3.1 part localization (cross-check layer)
# --------------------------------------------------------------------------

@dataclass
class SamRegion:
    object_id: str
    box: tuple[int, int, int, int]        # x1, y1, x2, y2 (source pixels)
    image_w: int
    image_h: int
    confidence: float | None = None


_FRAME_RE = re.compile(r"^<(\d+)f(?:;[^>]*)?>")
_BOX_RE = re.compile(
    r"<\|box;x1=(-?\d+);y1=(-?\d+);x2=(-?\d+);y2=(-?\d+);w=(\d+);h=(\d+)"
    r"(?:;c=([0-9.eE+-]+))?\|>")


def parse_sam_text(text: str) -> list[SamRegion]:
    """Parse SAM's output_text lane (pure).

    Wire format (meta-sam protocol): one line per frame, ``<Nf>`` then
    comma-separated records ``<id><|box;...|><|mask;...|>``. Only box tokens
    are read; mask payloads are opaque and skipped (they cannot contain the
    ``|>`` terminator). An empty lane means zero matches — a valid result.
    """
    regions: list[SamRegion] = []
    for line in text.splitlines():
        line = line.strip()
        if not _FRAME_RE.match(line):
            continue
        for m in _BOX_RE.finditer(line):
            prefix = line[:m.start()]
            ids = re.findall(r"(\d+)\s*$", prefix.rstrip(","))
            x1, y1, x2, y2, w, h = (int(m.group(i)) for i in range(1, 7))
            conf = m.group(7)
            regions.append(SamRegion(
                object_id=ids[-1] if ids else str(len(regions)),
                box=(x1, y1, x2, y2), image_w=w, image_h=h,
                confidence=float(conf) if conf else None))
    return regions


def sam_text_from_stream(lines) -> str:
    """Extract the finalized output_text from SSE lines (pure).

    Accepts an iterable of raw stream lines (with or without ``data: ``
    prefixes). Uses response.output_text.done / content_part.done events;
    falls back to accumulated deltas. Aggregate output in
    response.completed is deliberately not trusted over the lane events.
    """
    final = None
    deltas: list[str] = []
    for raw in lines:
        line = raw.strip()
        if not line.startswith("data:"):
            continue
        data = line[5:].strip()
        if not data or data == "[DONE]":
            continue
        try:
            event = json.loads(data)
        except json.JSONDecodeError:
            continue
        etype = event.get("type", "")
        if etype == "response.output_text.done" and \
                isinstance(event.get("text"), str):
            final = event["text"]
        elif etype == "response.content_part.done":
            part = event.get("part") or {}
            if part.get("type") == "output_text" and \
                    isinstance(part.get("text"), str):
                final = part["text"]
        elif etype == "response.output_text.delta" and \
                isinstance(event.get("delta"), str):
            deltas.append(event["delta"])
    if final is not None:
        return final
    return "".join(deltas)


def locate_parts(image_path: str | Path,
                 concepts: list[str]) -> dict[str, list[SamRegion]]:
    """Run SAM 3.1 once per concept; return regions per concept.

    A concept with zero matches maps to an empty list — that is SAM saying
    "not visible", which is evidence, not an error.
    """
    uri = image_data_uri(image_path)
    results: dict[str, list[SamRegion]] = {}
    for concept in concepts:
        body = {
            "model": SAM_MODEL,
            "input": [{
                "type": "message",
                "role": "user",
                "content": [
                    {"type": "input_text", "text": concept},
                    {"type": "input_image", "image_url": uri},
                ],
            }],
            "stream": True,
            "metadata": {"mask_encoding": "one_bit",
                         "include_confidence": "true"},
        }
        text = sam_text_from_stream(_post_stream_lines("/responses", body))
        results[concept] = parse_sam_text(text)
    return results
