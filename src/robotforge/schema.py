"""Robot specification schema.

A RobotSpec is the structured contract between the language model (describe),
the engineering checks (validate), and the twin generator (urdf/gazebo).
Plain dataclasses, zero dependencies, strict parsing: unknown or malformed
input raises SpecError rather than being silently coerced.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field


class SpecError(ValueError):
    """Raised when a spec document cannot be parsed into a RobotSpec."""


DRIVETRAINS = ("differential", "skid_steer", "ackermann", "mecanum", "tracked")
SENSOR_KINDS = ("ultrasonic", "lidar_2d", "depth_camera", "rgb_camera", "imu", "gps",
                "bumper", "encoder")


@dataclass
class Wheel:
    diameter_m: float
    width_m: float
    count: int
    driven: bool = True


@dataclass
class Motor:
    kind: str                 # e.g. "dc_gearmotor", "bldc", "servo", "stepper"
    voltage_v: float
    count: int
    stall_torque_nm: float | None = None


@dataclass
class Battery:
    chemistry: str            # e.g. "lipo", "liion", "nimh", "lead_acid"
    voltage_v: float
    capacity_mah: int


@dataclass
class Sensor:
    kind: str                 # one of SENSOR_KINDS
    position: str             # free text: "front", "rear", "top", ...
    range_m: float | None = None


@dataclass
class RobotSpec:
    name: str
    description: str
    drivetrain: str
    length_m: float
    width_m: float
    height_m: float
    mass_kg: float            # declared total mass (checked against budget if given)
    ground_clearance_m: float
    wheel: Wheel
    motor: Motor
    battery: Battery
    sensors: list[Sensor] = field(default_factory=list)
    component_mass_kg: dict[str, float] = field(default_factory=dict)

    # -- parsing ---------------------------------------------------------
    @classmethod
    def from_dict(cls, data: dict) -> "RobotSpec":
        try:
            if data["drivetrain"] not in DRIVETRAINS:
                raise SpecError(f"drivetrain must be one of {DRIVETRAINS}, "
                                f"got {data['drivetrain']!r}")
            sensors = []
            for s in data.get("sensors", []):
                if s["kind"] not in SENSOR_KINDS:
                    raise SpecError(f"sensor kind must be one of {SENSOR_KINDS}, "
                                    f"got {s['kind']!r}")
                sensors.append(Sensor(kind=s["kind"], position=s["position"],
                                      range_m=s.get("range_m")))
            return cls(
                name=str(data["name"]),
                description=str(data.get("description", "")),
                drivetrain=data["drivetrain"],
                length_m=float(data["length_m"]),
                width_m=float(data["width_m"]),
                height_m=float(data["height_m"]),
                mass_kg=float(data["mass_kg"]),
                ground_clearance_m=float(data["ground_clearance_m"]),
                wheel=Wheel(**{k: data["wheel"][k] for k in
                               ("diameter_m", "width_m", "count")},
                            driven=bool(data["wheel"].get("driven", True))),
                motor=Motor(kind=str(data["motor"]["kind"]),
                            voltage_v=float(data["motor"]["voltage_v"]),
                            count=int(data["motor"]["count"]),
                            stall_torque_nm=data["motor"].get("stall_torque_nm")),
                battery=Battery(chemistry=str(data["battery"]["chemistry"]),
                                voltage_v=float(data["battery"]["voltage_v"]),
                                capacity_mah=int(data["battery"]["capacity_mah"])),
                sensors=sensors,
                component_mass_kg={str(k): float(v) for k, v in
                                   data.get("component_mass_kg", {}).items()},
            )
        except (KeyError, TypeError, ValueError) as exc:
            if isinstance(exc, SpecError):
                raise
            raise SpecError(f"invalid spec: {exc}") from exc

    @classmethod
    def from_json(cls, text: str) -> "RobotSpec":
        try:
            return cls.from_dict(json.loads(text))
        except json.JSONDecodeError as exc:
            raise SpecError(f"spec is not valid JSON: {exc}") from exc

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "description": self.description,
            "drivetrain": self.drivetrain,
            "length_m": self.length_m,
            "width_m": self.width_m,
            "height_m": self.height_m,
            "mass_kg": self.mass_kg,
            "ground_clearance_m": self.ground_clearance_m,
            "wheel": {"diameter_m": self.wheel.diameter_m,
                      "width_m": self.wheel.width_m,
                      "count": self.wheel.count,
                      "driven": self.wheel.driven},
            "motor": {"kind": self.motor.kind,
                      "voltage_v": self.motor.voltage_v,
                      "count": self.motor.count,
                      "stall_torque_nm": self.motor.stall_torque_nm},
            "battery": {"chemistry": self.battery.chemistry,
                        "voltage_v": self.battery.voltage_v,
                        "capacity_mah": self.battery.capacity_mah},
            "sensors": [{"kind": s.kind, "position": s.position,
                         "range_m": s.range_m} for s in self.sensors],
            "component_mass_kg": self.component_mass_kg,
        }
