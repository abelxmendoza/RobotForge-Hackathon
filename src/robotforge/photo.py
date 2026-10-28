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

Document mode (``draft_spec_from_document``) is the second intake for an
image: a photo/scan of a spec sheet, datasheet or blueprint. It TRANSCRIBES
printed values instead of estimating from appearance — the framing is
"Document draft (values transcribed from the document)", never ESTIMATED,
and the rules are enforced in code, not just in the prompt: a numeric spec
value with no matching transcribed ``values`` entry is dropped by the
parser (see ``parse_document_payload``), and a field the document does not
print stays absent, so a document draft may be a partial spec on purpose.
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

PHOTO_PREFIX = "Photo draft (all dimensions ESTIMATED): "

DOCUMENT_PREFIX = "Document draft (values transcribed from the document): "

DOCUMENT_INSTRUCTIONS = """
You are now looking at a DOCUMENT (attached as an image): a photo or scan
of a spec sheet, datasheet or blueprint. Your job is TRANSCRIPTION, not
estimation: read the values the document PRINTS and carry them into the
draft exactly. Do not work from the appearance or proportions of anything
in the image — there may be no robot in it at all.

Output ONLY one JSON object with exactly these keys:
- "identity_guess": the robot or product the document describes, as
  printed (e.g. "TurtleBot3 Burger"), or "unknown document" if the
  document does not name it.
- "values": a list of {"label": ..., "printed": ..., "field": ...} —
  one entry for EVERY value you transcribe: "label" is the document's
  own label ("Overall length"), "printed" is the value exactly as
  printed, with its unit ("178 mm"), and "field" is the spec field it
  fills, as a dotted path ("length_m", "wheel.diameter_m",
  "battery.capacity_mah"). Use ONLY these field paths: name,
  description, drivetrain, length_m, width_m, height_m, mass_kg,
  ground_clearance_m, wheel.diameter_m, wheel.width_m, wheel.count,
  motor.kind, motor.voltage_v, motor.count, motor.stall_torque_nm,
  battery.chemistry, battery.voltage_v, battery.capacity_mah, and for
  sensors: sensors.kind, sensors.position, sensors.range_m.
- "spec": the robot specification object in the field format described
  above, built ONLY from the values you transcribed.

Hard rules:
- Transcribe ONLY printed values. A number you cannot read in the
  document does not go in the draft: no typical values, no values from
  memory of a similar product, no completing the table. This overrides
  any instruction above about filling in realistic values for omissions.
- NEVER infer a dimension from drawing scale, proportions, or the size
  of anything in the image. If a blueprint dimension is not printed as
  a callout, it is absent, even if the drawing looks measurable.
- A value that is not printed stays ABSENT: leave the field out of the
  spec entirely. A partial spec is a correct answer for a partial
  document.
- Units: keep the printed unit in "values". In the spec, convert to
  metres / volts / kilograms ONLY when the printed unit is explicit
  (178 mm becomes 0.178 in length_m; 1800 mAh stays 1800 in
  battery.capacity_mah). If a printed value carries no unit, leave it
  out of the spec and note that in the "description".
- Prefix the spec "description" with "Document draft (values
  transcribed from the document): " and mention anything you could not
  read or had to leave out.
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
    if not isinstance(data, dict) or not isinstance(data.get("spec"), dict):
        raise SpecError("photo response JSON has no 'spec' object: "
                        + text[:200])
    spec_data = data["spec"]
    # The ESTIMATED banner is enforced here, in code — the same way
    # document mode enforces its banner — because the whole honesty
    # chain keys off it (schema.spec_is_estimated): validate withholds
    # its clean pass, the gate refuses the draft, the CAD kit banners
    # every file. A model that forgets the prefix must not be able to
    # launder a photo draft into a measured-looking spec.
    desc = spec_data.get("description")
    if not isinstance(desc, str) or not desc.startswith("Photo draft"):
        spec_data["description"] = PHOTO_PREFIX + (
            desc if isinstance(desc, str) else "")
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
# document mode (spec sheet / datasheet / blueprint -> transcribed draft)
# --------------------------------------------------------------------------

@dataclass
class TranscribedValue:
    label: str          # the document's own label ("Overall length")
    printed: str        # exactly as printed, with unit ("178 mm")
    field: str          # dotted spec path ("length_m", "wheel.diameter_m")


@dataclass
class DocumentDraft:
    """A document-mode draft. ``spec_data`` is the raw spec dict and may
    be PARTIAL on purpose: fields the document does not print stay absent.
    ``spec`` parses it into a RobotSpec when (and only when) it is
    complete enough for the strict schema."""
    spec_data: dict
    identity_guess: str
    values: list[TranscribedValue] = field(default_factory=list)
    dropped: list[str] = field(default_factory=list)  # unbacked numerics

    @property
    def spec(self) -> RobotSpec | None:
        try:
            return RobotSpec.from_dict(self.spec_data)
        except SpecError:
            return None

    @property
    def is_complete(self) -> bool:
        return self.spec is not None


_FIELD_ALIASES = {
    "wheel_diameter_m": "wheel.diameter_m",
    "wheel_width_m": "wheel.width_m",
    "wheel_count": "wheel.count",
    "motor_voltage_v": "motor.voltage_v",
    "motor_count": "motor.count",
    "motor_stall_torque_nm": "motor.stall_torque_nm",
    "battery_chemistry": "battery.chemistry",
    "battery_voltage_v": "battery.voltage_v",
    "battery_capacity_mah": "battery.capacity_mah",
}


def _numeric_leaf_paths(data, prefix=""):
    """Yield (dotted_path, parent_dict, key) for every numeric leaf."""
    if isinstance(data, dict):
        for k, v in data.items():
            path = f"{prefix}.{k}" if prefix else str(k)
            yield from _numeric_leaf_paths(v, path)
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                yield path, data, k
    elif isinstance(data, list):
        for item in data:
            yield from _numeric_leaf_paths(item, prefix)


def parse_document_payload(payload: dict) -> DocumentDraft:
    """Parse a chat-completions payload from the document prompt (pure).

    Enforcement, in code rather than in the prompt's goodwill:
    - the spec description carries the DOCUMENT banner prefix;
    - every numeric spec value must be backed by a transcribed
      ``values`` entry naming its field — an unbacked number is
      dropped and named in ``dropped`` (under-claim, never over-claim).
    """
    try:
        text = payload["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError, TypeError) as exc:
        raise SpecError(f"document response has no message content: "
                        f"{exc}") from exc
    if text.startswith("```"):
        text = text.strip("`").removeprefix("json").strip()
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise SpecError(f"document response is not valid JSON: {exc}") \
            from exc
    if not isinstance(data, dict) or not isinstance(data.get("spec"), dict):
        raise SpecError("document response JSON has no 'spec' object: "
                        + text[:200])
    spec_data = data["spec"]
    values: list[TranscribedValue] = []
    for entry in data.get("values", []):
        try:
            raw_field = str(entry["field"]).strip()
            values.append(TranscribedValue(
                label=str(entry["label"]), printed=str(entry["printed"]),
                field=_FIELD_ALIASES.get(raw_field, raw_field)))
        except (KeyError, TypeError, ValueError):
            continue  # a malformed value note must not sink the draft
    backed = {v.field for v in values}
    dropped: list[str] = []
    # paths under these parents are backed by a same-prefix entry
    for path, parent, key in list(_numeric_leaf_paths(spec_data)):
        base = path.split(".")[0]
        ok = path in backed or (
            base == "component_mass_kg" and
            any(f.startswith("component_mass_kg") for f in backed)) or (
            base == "sensors" and
            any(f == path for f in backed))
        if not ok:
            dropped.append(path)
            del parent[key]
    desc = spec_data.get("description")
    if not isinstance(desc, str) or not desc.startswith("Document draft"):
        spec_data["description"] = DOCUMENT_PREFIX + (
            desc if isinstance(desc, str) else "")
    return DocumentDraft(
        spec_data=spec_data,
        identity_guess=str(data.get("identity_guess",
                                    "unknown document")),
        values=values, dropped=dropped)


def draft_spec_from_document(image_path: str | Path,
                             model: str | None = None) -> DocumentDraft:
    """One Muse Spark vision call: document image -> transcribed draft."""
    model = model or os.environ.get("RF_MODEL") or DEFAULT_MODEL
    body = {
        "model": model,
        "messages": [
            {"role": "system",
             "content": SYSTEM_PROMPT + DOCUMENT_INSTRUCTIONS},
            {"role": "user", "content": [
                {"type": "text",
                 "text": "Transcribe the printed specification values "
                         "in this document into a robot specification "
                         "draft."},
                {"type": "image_url",
                 "image_url": {"url": image_data_uri(image_path)}},
            ]},
        ],
        "temperature": 0.2,
    }
    payload = _post_json("/chat/completions", body)
    return parse_document_payload(payload)


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
