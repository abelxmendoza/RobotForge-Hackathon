"""Natural language -> RobotSpec, via Muse Spark on the Meta Model API.

The Meta Model API is OpenAI-compatible; this client uses only the standard
library so the core stays dependency-free. Standard mode only: Contributor
mode permits training on prompts/code and must not be used for this project.

Live mode needs META_API_KEY (and RF_MODEL naming a model from the Meta
Model API catalogue). --mock mode returns a canned parse of the demo robot
so the rest of the pipeline can be developed and tested without a key.
"""
from __future__ import annotations

import json
import os
import urllib.request

from .schema import RobotSpec, SpecError

API_BASE = os.environ.get("META_API_BASE", "https://api.meta.ai/v1")

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


def describe_live(description: str, model: str | None = None) -> RobotSpec:
    key = os.environ.get("META_API_KEY")
    if not key:
        raise SpecError("META_API_KEY is not set (live describe mode)")
    model = model or os.environ.get("RF_MODEL")
    if not model:
        raise SpecError("RF_MODEL is not set — name a model from the Meta Model "
                        "API catalogue (e.g. a Muse Spark model id)")
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
    text = payload["choices"][0]["message"]["content"].strip()
    if text.startswith("```"):
        text = text.strip("`").removeprefix("json").strip()
    return RobotSpec.from_json(text)
