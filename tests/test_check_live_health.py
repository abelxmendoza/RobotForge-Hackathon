import json

import pytest

from tools.check_live_health import health_failures, parse_health


def healthy(**updates):
    payload = {
        "ok": True,
        "mode": "live",
        "configured": True,
        "kv": True,
        "auth": True,
        "budget": {"used": 3, "limit": 200},
        "routes": {"describe": True, "chat": True, "list": True},
    }
    payload.update(updates)
    return payload


def test_healthy_live_worker_has_no_failures():
    assert health_failures(healthy()) == []


@pytest.mark.parametrize(
    ("updates", "message"),
    [
        ({"ok": False}, "health response did not report ok=true"),
        ({"mode": "off"}, "live mode is off"),
        ({"configured": False}, "no text model provider is configured"),
        ({"kv": False}, "RF_LIVE_KV is not bound"),
        ({"auth": False}, "account authentication is not configured"),
        ({"budget": None}, "budget state is unavailable"),
        ({"routes": {"describe": True, "chat": False, "list": True}}, "required route chat is not configured"),
    ],
)
def test_unready_worker_reports_actionable_failure(updates, message):
    assert message in health_failures(healthy(**updates))


def test_malformed_health_shape_is_rejected():
    assert health_failures(["not", "an", "object"]) == [
        "health response is not a JSON object"
    ]


def test_non_json_health_body_is_rejected():
    with pytest.raises(ValueError, match="valid JSON"):
        parse_health(b"service unavailable")


def test_json_health_body_is_parsed():
    assert parse_health(json.dumps(healthy()).encode()) == healthy()
