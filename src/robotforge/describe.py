"""Natural language -> RobotSpec, via Muse Spark.

Live mode tries inference transports in order, using the next one only
after the previous one fails (every failure is noted on stderr with its
transport name, and the transport that produced the spec is printed on
stderr too):

1. ``meta-connector`` — the registered Meta Model API connector helper
   (``meta_api.py`` of the ``custom.meta-model-api`` connector). The
   connector holds the API credential as a surrogate, so no raw key ever
   enters this process, the environment, or the repo. Model defaults to
   ``muse-spark-1.3`` (override with RF_MODEL), Standard mode only:
   Contributor mode permits training on prompts/code and must not be
   used for this project.
2. ``baseten`` — the registered Baseten connector helper
   (``baseten_api.py`` of the ``custom.baseten`` connector), serving Muse
   Spark Open (``meta-models/muse-spark-open``) under the hackathon
   grant. Same surrogate-credential arrangement. Calls are slow (the
   model reasons; 15-95 s observed), so its timeouts are budgeted
   generously — it is insurance for the primary path, not a peer.
3. ``fireworks`` — an OPTIONAL direct OpenAI-compatible call to
   Fireworks AI's serverless inference API, serving the same Muse
   Spark Open model under ``accounts/fireworks/models/muse-spark-open``.
   It is never enabled merely because FIREWORKS_API_KEY exists: it
   joins the chain only when explicitly opted in with
   RF_DESCRIBE_TRANSPORT=fireworks or RF_FIREWORKS_ENABLED=1. When
   enabled as a chain member it runs after the two connector
   transports and before the direct Meta fallback.
4. ``direct`` — a direct OpenAI-compatible call using META_API_KEY, only
   when that variable is set. Last resort for using the repo outside
   this workspace, where neither connector helper exists.

Set RF_DESCRIBE_TRANSPORT=meta|baseten|fireworks|direct to force one
transport. Helper paths can be overridden with RF_META_API_HELPER /
RF_BASETEN_HELPER.

--mock mode returns a canned parse of the demo robot so the rest of the
pipeline can be developed and tested without any API access.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

from .schema import RobotSpec, SpecError

API_BASE = os.environ.get("META_API_BASE", "https://api.meta.ai/v1")
DEFAULT_MODEL = "muse-spark-1.3"
BASETEN_MODEL = "meta-models/muse-spark-open"
FIREWORKS_API_BASE = "https://api.fireworks.ai/inference/v1"
FIREWORKS_MODEL = "accounts/fireworks/models/muse-spark-open"
DEFAULT_HELPER = (Path.home() / "workspace" / "custom-connectors"
                  / "custom.meta-model-api" / "bin" / "meta_api.py")
DEFAULT_BASETEN_HELPER = (Path.home() / "workspace" / "custom-connectors"
                          / "custom.baseten" / "bin" / "baseten_api.py")

SYSTEM_PROMPT = """You convert a plain-language robot description into a strict JSON
robot specification. Output ONLY the JSON object, no prose, no markdown fences.

Fields (all lengths in metres, masses in kg, voltages in V):
name (string), description (string),
drivetrain: one of differential|skid_steer|ackermann|mecanum|tracked,
length_m, width_m, height_m, mass_kg, ground_clearance_m (numbers),
wheel: {diameter_m, width_m, count, driven},
motor: {kind, voltage_v, count, stall_torque_nm or null},
battery: {chemistry, voltage_v, capacity_mah},
sensors: [{kind: ultrasonic|lidar_2d|depth_camera|rgb_camera|imu|gps|bumper|encoder,
           position, range_m or null}],
component_mass_kg: {part_name: mass} — include when the description gives part masses.

Use realistic values for anything the description omits, and keep the design
physically coherent: ground clearance must not exceed the wheel radius, and the
motor voltage must not exceed the battery voltage."""

_MOCK = {
    "name": "pathfinder",
    "description": "Four-wheel skid-steer rover for warehouse aisle patrol.",
    "drivetrain": "skid_steer",
    "length_m": 0.42, "width_m": 0.31, "height_m": 0.18,
    "mass_kg": 3.4, "ground_clearance_m": 0.035,
    "wheel": {"diameter_m": 0.10, "width_m": 0.032, "count": 4, "driven": True},
    "motor": {"kind": "dc_gearmotor", "voltage_v": 12.0, "count": 4,
              "stall_torque_nm": 0.8},
    "battery": {"chemistry": "lipo", "voltage_v": 14.8, "capacity_mah": 5200},
    "sensors": [{"kind": "ultrasonic", "position": "front", "range_m": 3.0},
                {"kind": "imu", "position": "center", "range_m": None}],
    "component_mass_kg": {"chassis": 1.1, "motors": 0.8, "battery": 0.6,
                          "electronics": 0.4, "wheels": 0.5},
}


def describe_mock(description: str) -> RobotSpec:
    """Offline stand-in: returns the canned demo parse (description echoed)."""
    data = dict(_MOCK)
    if description:
        data["description"] = description
    return RobotSpec.from_dict(data)


def _spec_from_chat_payload(payload: dict) -> RobotSpec:
    text = payload["choices"][0]["message"]["content"].strip()
    if text.startswith("```"):
        text = text.strip("`").removeprefix("json").strip()
    return RobotSpec.from_json(text)


def _run_helper_chat(description: str, model: str, helper: Path,
                     label: str, extra_args: tuple = (),
                     timeout: int = 180) -> RobotSpec:
    """One chat call through a connector helper (subprocess).

    Both connector helpers share this CLI: the system prompt goes in as a
    file and ``{"status": ..., "payload": ...}`` comes back as JSON on
    stdout. The helper process holds only a credential surrogate; the
    real key is swapped in by the platform on the outbound request.
    """
    with tempfile.NamedTemporaryFile("w", suffix=".txt",
                                     delete=False) as tmp:
        tmp.write(SYSTEM_PROMPT)
        system_file = tmp.name
    try:
        proc = subprocess.run(
            [sys.executable, str(helper), "chat",
             "--model", model, "--user", description,
             "--system-file", system_file, "--temperature", "0.2",
             *extra_args],
            capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise SpecError(f"{label} helper timed out after {timeout} s")
    finally:
        Path(system_file).unlink(missing_ok=True)
    if proc.returncode != 0:
        tail = proc.stderr.strip().splitlines()[-3:]
        raise SpecError(f"{label} helper failed: " + " | ".join(tail))
    try:
        result = json.loads(proc.stdout)
    except json.JSONDecodeError:
        raise SpecError(f"{label} helper returned non-JSON output: "
                        + proc.stdout[:200])
    status = result.get("status")
    payload = result.get("payload") or {}
    if status != 200:
        raise SpecError(f"{label} API returned HTTP {status}: "
                        + json.dumps(payload)[:500])
    return _spec_from_chat_payload(payload)


def _describe_via_connector(description: str, model: str,
                            helper: Path) -> RobotSpec:
    """Primary transport: Muse Spark via the Meta Model API connector."""
    return _run_helper_chat(description, model, helper, "Meta connector")


def _describe_via_baseten(description: str, model: str,
                          helper: Path) -> RobotSpec:
    """Fallback transport: Muse Spark Open via the Baseten connector.

    Baseten calls reason before answering and took 15-95 s in testing, so
    the helper's own request timeout is raised to 240 s and the
    subprocess timeout sits above it.
    """
    return _run_helper_chat(description, model, helper, "Baseten",
                            extra_args=("--timeout", "240"), timeout=300)


def _fireworks_opted_in(forced_key: str = "") -> bool:
    """Fireworks is opt-in, never a silent default.

    Setting FIREWORKS_API_KEY alone must not reroute describe calls:
    the operator either forces the transport for one run or enables it
    as an additional fallback with RF_FIREWORKS_ENABLED=1.
    """
    if forced_key == "fireworks":
        return True
    return os.environ.get("RF_FIREWORKS_ENABLED", "").strip().lower() in {
        "1", "true", "yes", "on"}


def _describe_via_fireworks(description: str, model: str) -> RobotSpec:
    """Optional transport: Muse Spark Open via Fireworks AI.

    Fireworks exposes an OpenAI-compatible Chat Completions endpoint.
    The API key comes only from FIREWORKS_API_KEY in the process
    environment (in production, supplied by the caller's secret flow);
    it is never stored in the repo or printed.
    """
    key = os.environ.get("FIREWORKS_API_KEY")
    if not key:
        raise SpecError(
            "FIREWORKS_API_KEY is not set (Fireworks describe mode)")
    api_base = os.environ.get(
        "RF_FIREWORKS_API_BASE", FIREWORKS_API_BASE).rstrip("/")
    body = json.dumps({
        "model": model,
        "messages": [{"role": "system", "content": SYSTEM_PROMPT},
                     {"role": "user", "content": description}],
        "temperature": 0.2,
        "max_tokens": 4000,
    }).encode()
    req = urllib.request.Request(
        f"{api_base}/chat/completions", data=body,
        headers={"Authorization": f"Bearer {key}",
                 "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            payload = json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace").strip()[:500]
        suffix = f": {detail}" if detail else ""
        raise SpecError(
            f"Fireworks API returned HTTP {exc.code}{suffix}") from exc
    except (urllib.error.URLError, TimeoutError) as exc:
        raise SpecError(f"Fireworks API call failed: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise SpecError("Fireworks API returned non-JSON output") from exc
    try:
        return _spec_from_chat_payload(payload)
    except (AttributeError, KeyError, IndexError, TypeError) as exc:
        raise SpecError(
            f"Fireworks API returned an unexpected response: {exc}") \
            from exc


def _describe_direct(description: str, model: str) -> RobotSpec:
    """Last resort: direct OpenAI-compatible call with META_API_KEY."""
    key = os.environ.get("META_API_KEY")
    if not key:
        raise SpecError("META_API_KEY is not set (direct live describe mode)")
    body = json.dumps({
        "model": model,
        "messages": [{"role": "system", "content": SYSTEM_PROMPT},
                     {"role": "user", "content": description}],
        "temperature": 0.2,
    }).encode()
    req = urllib.request.Request(
        f"{API_BASE}/chat/completions", data=body,
        headers={"Authorization": f"Bearer {key}",
                 "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            payload = json.loads(resp.read())
    except urllib.error.URLError as exc:
        raise SpecError(f"direct Meta Model API call failed: {exc}") \
            from exc
    return _spec_from_chat_payload(payload)


def describe_live(description: str, model: str | None = None) -> RobotSpec:
    model = model or os.environ.get("RF_MODEL") or DEFAULT_MODEL
    baseten_model = os.environ.get("RF_BASETEN_MODEL") or BASETEN_MODEL
    fireworks_model = os.environ.get("RF_FIREWORKS_MODEL") or FIREWORKS_MODEL
    meta_helper = Path(os.environ.get(
        "RF_META_API_HELPER", str(DEFAULT_HELPER))).expanduser()
    baseten_helper = Path(os.environ.get(
        "RF_BASETEN_HELPER", str(DEFAULT_BASETEN_HELPER))).expanduser()

    forced = os.environ.get("RF_DESCRIBE_TRANSPORT", "").strip().lower()
    aliases = {"meta": "meta", "meta-connector": "meta",
               "baseten": "baseten", "fireworks": "fireworks",
               "direct": "direct"}
    forced_key = aliases.get(forced) if forced else None
    if forced and forced_key is None:
        raise SpecError(
            f"unknown RF_DESCRIBE_TRANSPORT {forced!r} "
            "(expected meta|baseten|fireworks|direct)")

    # (key, display label, attempt) in the order they are tried.
    transports = []
    if meta_helper.is_file():
        transports.append((
            "meta", f"meta-connector ({model})",
            lambda: _describe_via_connector(description, model,
                                            meta_helper)))
    if baseten_helper.is_file():
        transports.append((
            "baseten", f"baseten ({baseten_model})",
            lambda: _describe_via_baseten(description, baseten_model,
                                          baseten_helper)))
    if _fireworks_opted_in(forced_key or ""):
        transports.append((
            "fireworks", f"fireworks ({fireworks_model})",
            lambda: _describe_via_fireworks(description, fireworks_model)))
    if os.environ.get("META_API_KEY"):
        transports.append((
            "direct", f"direct ({model})",
            lambda: _describe_direct(description, model)))

    if forced:
        chosen = [t for t in transports if t[0] == forced_key]
        if not chosen:
            raise SpecError(
                f"RF_DESCRIBE_TRANSPORT={forced} but that transport is "
                "not available (helper missing or the relevant API key "
                "is unset)")
        transports = chosen

    if not transports:
        raise SpecError(
            "no live transport available: connector helpers not found at "
            f"{meta_helper} (set RF_META_API_HELPER) or {baseten_helper} "
            "(set RF_BASETEN_HELPER), and META_API_KEY is not set; "
            "Fireworks is opt-in and additionally needs "
            "RF_DESCRIBE_TRANSPORT=fireworks or RF_FIREWORKS_ENABLED=1, "
            "plus FIREWORKS_API_KEY")

    errors = []
    for attempt_no, (key, label, attempt) in enumerate(transports):
        try:
            spec = attempt()
        except SpecError as exc:
            errors.append((label, exc))
            print(f"describe transport {label} failed: {exc}",
                  file=sys.stderr)
            continue
        if forced:
            suffix = ", forced"
        elif attempt_no > 0:
            suffix = ", fallback"
        elif key == "direct":
            suffix = ", last resort"
        else:
            suffix = ""
        print(f"describe transport: {label}{suffix}", file=sys.stderr)
        return spec
    raise SpecError(
        "all live describe transports failed: "
        + "; ".join(f"{label}: {exc}" for label, exc in errors))


def _helper_text(system: str, user: str, model: str, helper: Path,
                 label: str, extra_args: tuple = (),
                 timeout: int = 180) -> str:
    """One raw chat call through a connector helper; returns the text."""
    with tempfile.NamedTemporaryFile("w", suffix=".txt",
                                     delete=False) as tmp:
        tmp.write(system)
        system_file = tmp.name
    try:
        proc = subprocess.run(
            [sys.executable, str(helper), "chat", "--model", model,
             "--user", user, "--system-file", system_file,
             "--temperature", "0.2", *extra_args],
            capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise SpecError(f"{label} helper timed out after {timeout} s")
    finally:
        Path(system_file).unlink(missing_ok=True)
    if proc.returncode != 0:
        tail = proc.stderr.strip().splitlines()[-3:]
        raise SpecError(f"{label} helper failed: " + " | ".join(tail))
    try:
        result = json.loads(proc.stdout)
        if result.get("status") != 200:
            raise SpecError(f"{label} API returned HTTP {result.get('status')}")
        return result["payload"]["choices"][0]["message"]["content"]
    except (json.JSONDecodeError, KeyError, IndexError, TypeError) as exc:
        raise SpecError(f"{label} helper returned an unexpected reply: {exc}")


def _http_text(system: str, user: str, model: str, base: str, key: str,
               label: str, timeout: int = 180) -> str:
    """One raw OpenAI-compatible chat call over HTTPS; returns the text."""
    body = json.dumps({
        "model": model,
        "messages": [{"role": "system", "content": system},
                     {"role": "user", "content": user}],
        "temperature": 0.2, "max_tokens": 3000,
    }).encode()
    req = urllib.request.Request(
        f"{base.rstrip('/')}/chat/completions", data=body,
        headers={"Authorization": f"Bearer {key}",
                 "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            payload = json.loads(resp.read())
        return payload["choices"][0]["message"]["content"]
    except urllib.error.HTTPError as exc:
        raise SpecError(f"{label} returned HTTP {exc.code}") from exc
    except (urllib.error.URLError, TimeoutError) as exc:
        raise SpecError(f"{label} call failed: {exc}") from exc
    except (json.JSONDecodeError, KeyError, IndexError, TypeError) as exc:
        raise SpecError(f"{label} returned an unexpected reply: {exc}") \
            from exc


def chat_live(system: str, user: str) -> tuple[str, str]:
    """Muse Spark text call over the same transport chain as describe.

    Returns (reply text, transport label). Used by the Forge loop's
    proposer, which needs free-form JSON back rather than a spec.
    """
    model = os.environ.get("RF_MODEL") or DEFAULT_MODEL
    meta_helper = Path(os.environ.get(
        "RF_META_API_HELPER", str(DEFAULT_HELPER))).expanduser()
    baseten_helper = Path(os.environ.get(
        "RF_BASETEN_HELPER", str(DEFAULT_BASETEN_HELPER))).expanduser()
    baseten_model = os.environ.get("RF_BASETEN_MODEL") or BASETEN_MODEL
    fireworks_model = os.environ.get("RF_FIREWORKS_MODEL") or FIREWORKS_MODEL
    attempts = []
    if meta_helper.is_file():
        attempts.append((f"meta-connector ({model})", lambda: _helper_text(
            system, user, model, meta_helper, "Meta connector")))
    if baseten_helper.is_file():
        attempts.append((f"baseten ({baseten_model})", lambda: _helper_text(
            system, user, baseten_model, baseten_helper, "Baseten",
            extra_args=("--timeout", "240"), timeout=300)))
    if _fireworks_opted_in() and os.environ.get("FIREWORKS_API_KEY"):
        attempts.append((f"fireworks ({fireworks_model})", lambda: _http_text(
            system, user, fireworks_model,
            os.environ.get("RF_FIREWORKS_API_BASE", FIREWORKS_API_BASE),
            os.environ["FIREWORKS_API_KEY"], "Fireworks API")))
    if os.environ.get("META_API_KEY"):
        attempts.append((f"direct ({model})", lambda: _http_text(
            system, user, model, API_BASE, os.environ["META_API_KEY"],
            "Meta Model API", timeout=60)))
    if not attempts:
        raise SpecError("no live transport available (see `robotforge "
                        "describe` setup in the README); use --mock to run "
                        "the loop offline")
    errors = []
    for label, attempt in attempts:
        try:
            return attempt(), label
        except SpecError as exc:
            errors.append(f"{label}: {exc}")
    raise SpecError("all live transports failed: " + "; ".join(errors))
