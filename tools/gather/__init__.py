"""RobotForge web-gathering pipeline (Forge Engine §8).

Fetch -> extract -> validate -> diff -> propose. Gathering files proposals;
it never silently overwrites catalog records. `apply` is a separate step.
"""

PIPELINE_VERSION = "gather/0.1.0"
