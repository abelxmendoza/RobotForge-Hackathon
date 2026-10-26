"""Natural language -> RobotSpec, via Muse Spark on the Meta Model API.

Live transport: in this workspace, describe runs through the registered
Meta Model API connector helper (``meta_api.py`` of the
``custom.meta-model-api`` connector). The connector holds the API credential
as a surrogate, so no raw key ever enters this process, the environment, or
the repo. The helper speaks the same OpenAI-compatible chat endpoint and is
the path verified end-to-end for this project. If the helper is not present
(e.g. the repo is used outside this workspace), live mode falls back to a
direct call using META_API_KEY. Either way the model defaults to
``muse-spark-1.3`` (override with RF_MODEL), in Standard mode only:
Contributor mode permits training on prompts/code and must not be used for
this project.

--mock mode returns a canned parse of the demo robot so the rest of the
pipeline can be developed and tested without any API access.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

from .schema import RobotSpec, SpecError

API_BASE = os.environ.get("META_API_BASE", "https://api.meta.ai/v1")
DEFAULT_MODEL = "muse-spark-1.3"
DEFAULT_HELPER = (Path.home() / "workspace" / "custom-connectors"
                  / "custom.meta-model-api" / "bin" / "meta_api.py")

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


def _describe_via_connector(description: str, model: str,
                            helper: Path) -> RobotSpec:
    """One chat call through the connector helper (subprocess).

    The helper's CLI takes the system prompt as a file and prints
    {"status": ..., "payload": ...} as JSON on stdout. Its process holds
    only a credential surrogate; the real key is swapped in by the platform
    on the outbound request to api.meta.ai.
    """
    with tempfile.NamedTemporaryFile("w", suffix=".txt",
                                     delete=False) as tmp:
        tmp.write(SYSTEM_PROMPT)
        system_file = tmp.name
    try:
        proc = subprocess.run(
            [sys.executable, str(helper), "chat",
             "--model", model, "--user", description,
             "--system-file", system_file, "--temperature", "0.2"],
            capture_output=True, text=True, timeout=180)
    except subprocess.TimeoutExpired:
        raise SpecError("connector helper timed out after 180 s")
    finally:
        Path(system_file).unlink(missing_ok=True)
    if proc.returncode != 0:
        tail = proc.stderr.strip().splitlines()[-3:]
        raise SpecError("connector helper failed: " + " | ".join(tail))
    try:
        result = json.loads(proc.stdout)
    except json.JSONDecodeError:
        raise SpecError("connector helper returned non-JSON output: "
                        + proc.stdout[:200])
    status = result.get("status")
    payload = result.get("payload") or {}
    if status != 200:
        raise SpecError(f"Meta Model API returned HTTP {status}: "
                        + json.dumps(payload)[:500])
    return _spec_from_chat_payload(payload)


def _describe_direct(description: str, model: str) -> RobotSpec:
    """Fallback: direct OpenAI-compatible call with META_API_KEY."""
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
    with urllib.request.urlopen(req, timeout=60) as resp:
        payload = json.loads(resp.read())
    return _spec_from_chat_payload(payload)


def describe_live(description: str, model: str | None = None) -> RobotSpec:
    model = model or os.environ.get("RF_MODEL") or DEFAULT_MODEL
    helper = Path(os.environ.get("RF_META_API_HELPER",
                                 str(DEFAULT_HELPER))).expanduser()
    if helper.is_file():
        return _describe_via_connector(description, model, helper)
    if os.environ.get("META_API_KEY"):
        return _describe_direct(description, model)
    raise SpecError(
        "no live transport available: connector helper not found at "
        f"{helper} (set RF_META_API_HELPER) and META_API_KEY is not set")
