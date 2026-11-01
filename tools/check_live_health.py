#!/usr/bin/env python3
"""Read-only readiness check for RobotForge's deployed live Worker."""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from typing import Any
from urllib.parse import urlparse


def parse_health(body: bytes) -> Any:
    try:
        return json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("health response is not valid JSON") from exc


def health_failures(payload: Any) -> list[str]:
    if not isinstance(payload, dict):
        return ["health response is not a JSON object"]

    failures = []
    if payload.get("ok") is not True:
        failures.append("health response did not report ok=true")
    if payload.get("mode") != "live":
        failures.append("live mode is off")
    if payload.get("configured") is not True:
        failures.append("no text model provider is configured")
    if payload.get("kv") is not True:
        failures.append("RF_LIVE_KV is not bound")
    if payload.get("auth") is not True:
        failures.append("account authentication is not configured")
    if not isinstance(payload.get("budget"), dict):
        failures.append("budget state is unavailable")

    routes = payload.get("routes")
    for route in ("describe", "chat", "list"):
        if not isinstance(routes, dict) or routes.get(route) is not True:
            failures.append(f"required route {route} is not configured")
    return failures


def health_url(base_url: str) -> str:
    parsed = urlparse(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("Worker URL must be an absolute http(s) URL")
    return base_url.rstrip("/") + "/health"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("worker_url", help="Worker base URL; no credentials are sent")
    parser.add_argument("--timeout", type=float, default=15.0)
    args = parser.parse_args(argv)

    try:
        request = urllib.request.Request(
            health_url(args.worker_url),
            headers={"Accept": "application/json", "User-Agent": "RobotForge-health-check/1"},
        )
        with urllib.request.urlopen(request, timeout=args.timeout) as response:
            payload = parse_health(response.read())
    except (ValueError, urllib.error.URLError, urllib.error.HTTPError) as exc:
        print(f"live health: ERROR: {exc}", file=sys.stderr)
        return 2

    failures = health_failures(payload)
    if failures:
        for failure in failures:
            print(f"live health: FAIL: {failure}", file=sys.stderr)
        return 1

    budget = payload["budget"]
    routes = sorted(name for name, enabled in payload["routes"].items() if enabled)
    print(
        "live health: PASS; "
        f"budget {budget.get('used', '?')}/{budget.get('limit', '?')}; "
        f"enabled routes: {', '.join(routes)}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
