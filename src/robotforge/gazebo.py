"""Gazebo release detection shared by optional Python adapters.

CLI execution remains available without Python bindings. Match one release's
Sim / Transport / Msgs family; never mix their ABIs on side-by-side installs.
"""
from dataclasses import dataclass
from functools import lru_cache
import re
import subprocess


@dataclass(frozen=True)
class GazeboRelease:
    name: str
    sim: int
    transport: int
    msgs: int


HARMONIC = GazeboRelease('Harmonic', 8, 13, 10)
JETTY = GazeboRelease('Jetty', 10, 15, 12)


@lru_cache(maxsize=1)
def detect_release():
    try:
        result = subprocess.run(['gz','sim','--versions'], capture_output=True,
                                text=True, timeout=5, check=True)
    except (OSError, subprocess.SubprocessError):
        return None
    majors = [int(x) for x in re.findall(r'(?m)^\s*(\d+)\.\d+', result.stdout)]
    # gz-tools selects the highest installed version by default.
    major = max(majors, default=0)
    return {8: HARMONIC, 10: JETTY}.get(major)
