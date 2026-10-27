#!/usr/bin/env python3
"""Generate an image via the Meta Model API (muse-image-1.0) through the
registered custom.meta-model-api connection — same surrogate-credential
pattern as the connector's meta_api.py helper. Saves the image bytes to
the --out path and prints a small JSON summary (never the raw base64).
"""
import argparse, base64, json, sys, urllib.request

sys.path.insert(0, "/opt/muse/skills/custom-connector-setup/bin")
from dynamic_credentials import add_surrogate_to_request, read_json_response

PROVIDER = "custom.meta-model-api"
HOSTS = ["api.meta.ai"]
BASE = "https://api.meta.ai/v1"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        raise RuntimeError("redirect refused, verify the endpoint")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prompt", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--model", default="muse-image-1.0")
    ap.add_argument("--timeout", type=int, default=240)
    args = ap.parse_args()

    body = json.dumps({"model": args.model, "prompt": args.prompt}).encode()
    req = urllib.request.Request(
        f"{BASE}/images/generations", data=body,
        headers={"Content-Type": "application/json"})
    add_surrogate_to_request(req, PROVIDER, allowed_hosts=HOSTS)
    try:
        with urllib.request.build_opener(NoRedirect()).open(req, timeout=args.timeout) as resp:
            status, payload = resp.status, read_json_response(resp)
    except urllib.error.HTTPError as e:
        print(json.dumps({"status": e.code, "error": e.read().decode("utf-8", "replace")[:600]}))
        return 1

    summary = {"status": status, "keys": list(payload.keys()) if isinstance(payload, dict) else type(payload).__name__}
    data = payload.get("data") if isinstance(payload, dict) else None
    if data:
        summary["data_len"] = len(data)
        summary["item_keys"] = list(data[0].keys())
        item = data[0]
        if item.get("b64_json"):
            raw = base64.b64decode(item["b64_json"])
            with open(args.out, "wb") as f:
                f.write(raw)
            summary["saved"] = args.out
            summary["bytes"] = len(raw)
        elif item.get("url"):
            summary["url"] = item["url"]
    else:
        summary["payload_preview"] = json.dumps(payload)[:600]
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
