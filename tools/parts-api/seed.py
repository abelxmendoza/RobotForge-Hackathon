#!/usr/bin/env python3
"""Seed tool for the RobotForge Parts API (live/worker.js /parts*).

Suppliers won't give RobotForge an API, so RobotForge is the API:
this tool builds the part records the Worker serves, from

  - catalog/parts.json — the catalogue of record (which, once the
    gather pipeline's `apply` step has run, also carries applied
    `price_estimate` records and per-field `provenance_gathered`), and
  - tools/gather/proposals/*.json — gather runs not yet applied;
    their price_estimate changes join the record as alternates,
    still in their `web_gathered` state (a proposal is not a
    confirmation, and the record says so).

Record shape (stored in RF_LIVE_KV under `parts:<id>`, with the id
list under `parts:index`) — field-aligned with the two parents:
gather's `price_estimate` ({unit_price, currency, price_breaks,
stock_wording, basis, source_kind, supplier_url, fetched_at,
expires_at, quote}) and buildPlan.ts's SourcedPrice ({amount <-> unit_price,
url <-> supplier_url, snippet <-> quote, verification <-> state}).

The catalogue's `image` field is an AI illustration. It is NEVER
copied into a record's `photo` — a photo exists only when a
verified photo record (url + credit + source page) exists.

Usage:
  python3 tools/parts-api/seed.py build [--catalog PATH]
      [--proposals-dir PATH] [--out PATH] [--seeded-at ISO]
  python3 tools/parts-api/seed.py upload --records PATH
      --account ACCT --kv-id NS_ID

`build` is a pure local transform (safe anywhere). `upload` is the
deploy-time step: it writes to the LIVE KV namespace, following
the cf_api.py credential pattern (registered custom.cloudflare
connection via dynamic_credentials; CLOUDFLARE_API_TOKEN env as a
fallback). The runbook lives in tools/parts-api/README.md.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

SEED_VERSION = "parts-api-seed/1.0.0"

_SUPPLIER_NAMES = {
    "pololu.com": "Pololu",
    "digikey.com": "Digi-Key",
    "mouser.com": "Mouser",
    "sparkfun.com": "SparkFun",
    "adafruit.com": "Adafruit",
    "amazon.com": "Amazon",
    "aliexpress.com": "AliExpress",
    "mcmaster.com": "McMaster-Carr",
    "lcsc.com": "LCSC",
    "octopart.com": "Octopart",
    "nexar.com": "Nexar",
    "robotshop.com": "RobotShop",
    "waveshare.com": "Waveshare",
    "dfrobot.com": "DFRobot",
    "seeedstudio.com": "Seeed Studio",
}


def supplier_name(url: str | None) -> str | None:
    """Display name for a supplier URL: known hosts by name, any
    other host by its registrable label. None when there is no URL
    (an estimate without a source URL is dropped before this)."""
    if not url:
        return None
    host = url.split("://", 1)[-1].split("/", 1)[0].lower()
    if host.startswith("www."):
        host = host[4:]
    if host in _SUPPLIER_NAMES:
        return _SUPPLIER_NAMES[host]
    label = host.split(".")[0]
    return label.replace("-", " ").title() if label else None


def normalize_estimate(raw: dict) -> dict | None:
    """One estimate in the API's canonical shape, or None when the
    raw record cannot carry a price honestly (no unit price, or no
    source record: the API serves no currency without one)."""
    if not isinstance(raw, dict):
        return None
    unit_price = raw.get("unit_price", raw.get("amount"))
    url = raw.get("supplier_url") or raw.get("url")
    fetched_at = raw.get("fetched_at") or raw.get("fetchedAt")
    if unit_price is None or not url or not fetched_at:
        return None
    breaks = []
    for b in raw.get("price_breaks") or []:
        if isinstance(b, dict) and b.get("qty") is not None \
                and b.get("unit_price") is not None:
            breaks.append({"qty": int(b["qty"]),
                           "unit_price": b["unit_price"]})
    if not breaks:
        breaks = [{"qty": 1, "unit_price": unit_price}]
    breaks.sort(key=lambda b: b["qty"])
    est = {
        "unit_price": unit_price,
        "currency": raw.get("currency", "USD"),
        "price_breaks": breaks,
        "supplier": raw.get("supplier") or supplier_name(url),
        "supplier_url": url,
        "source_kind": raw.get("source_kind")
        or raw.get("sourceKind") or "web_gathered",
        "state": raw.get("state") or raw.get("verification")
        or "web_gathered",
        "fetched_at": fetched_at,
        "expires_at": raw.get("expires_at"),
        "quote": raw.get("quote") or raw.get("snippet"),
        "stock_wording": raw.get("stock_wording"),
        "basis": raw.get("basis"),
    }
    return {k: v for k, v in est.items() if v is not None}


def normalize_photo(part: dict) -> dict | None:
    """A verified photo record or None. Reads ONLY part['photo']
    (the {url, credit, source_page} shape the photo-gathering work
    records); the catalogue `image` AI illustration is never used."""
    photo = part.get("photo")
    if not isinstance(photo, dict) or not photo.get("url"):
        return None
    out = {
        "url": photo["url"],
        "credit": photo.get("credit"),
        "source_page": photo.get("source_page")
        or photo.get("source_url"),
        "fetched_at": photo.get("fetched_at"),
        "state": photo.get("state", "web_gathered"),
    }
    return {k: v for k, v in out.items() if v is not None}


def part_interfaces(part: dict) -> list[str]:
    specs = part.get("specs") or {}
    out: list[str] = []
    for item in specs.get("interfaces") or []:
        value = str(item).strip().lower()
        if value and value not in out:
            out.append(value)
    single = specs.get("interface")
    if single:
        for piece in str(single).split("/"):
            value = piece.strip().lower()
            if value and value not in out:
                out.append(value)
    return out


def build_records(catalog: dict, proposals: list[dict] | None = None,
                  seeded_at: str | None = None) -> list[dict]:
    """Catalogue (+ gather proposals) -> Parts API records."""
    seeded_at = seeded_at or datetime.now(timezone.utc).strftime(
        "%Y-%m-%dT%H:%M:%SZ")
    proposal_prices: dict[str, list[dict]] = {}
    for proposal in proposals or []:
        for entry in proposal.get("entries", []):
            for change in entry.get("changes", []):
                if change.get("field") != "price_estimate":
                    continue
                raw = dict(change.get("proposed") or {})
                # Change-level provenance backs a proposed value
                # that does not carry its own.
                raw.setdefault("fetched_at", change.get("fetched_at"))
                raw.setdefault("state", change.get("state"))
                est = normalize_estimate(raw)
                if est:
                    proposal_prices.setdefault(
                        entry["part_id"], []).append(est)

    records = []
    for part in catalog.get("parts", []):
        estimates: list[dict] = []
        applied = normalize_estimate(part.get("price_estimate") or {})
        if applied:
            estimates.append(applied)
        for est in proposal_prices.get(part["id"], []):
            if any(e["supplier_url"] == est["supplier_url"]
                   for e in estimates):
                continue  # the applied record for a source wins
            estimates.append(est)
        specs = part.get("specs") or {}
        records.append({
            "id": part["id"],
            "name": part.get("name"),
            "mpn": part.get("mpn") or specs.get("mpn"),
            "category": part.get("part_class"),
            "blurb": part.get("blurb"),
            "used_for": part.get("used_for"),
            "notes": part.get("notes"),
            "source": part.get("source"),
            "license": part.get("license"),
            "specs": specs,
            "interfaces": part_interfaces(part),
            "photo": normalize_photo(part),
            "estimates": estimates,
            "provenance": {
                "catalog_source": part.get("source"),
                "license": part.get("license"),
                "gathered": part.get("provenance_gathered") or {},
            },
            "seed_version": SEED_VERSION,
            "seeded_at": seeded_at,
        })
    return records


def build_index(records: list[dict], seeded_at: str) -> dict:
    return {
        "ids": [r["id"] for r in records],
        "count": len(records),
        "seeded_at": seeded_at,
        "seed_version": SEED_VERSION,
    }


def load_proposals(proposals_dir: Path) -> list[dict]:
    if not proposals_dir or not Path(proposals_dir).is_dir():
        return []
    out = []
    for path in sorted(Path(proposals_dir).glob("*.json")):
        try:
            out.append(json.loads(path.read_text()))
        except (OSError, json.JSONDecodeError):
            continue
    return out


def cmd_build(args: argparse.Namespace) -> int:
    catalog = json.loads(Path(args.catalog).read_text())
    proposals = load_proposals(Path(args.proposals_dir))
    seeded_at = args.seeded_at or datetime.now(timezone.utc).strftime(
        "%Y-%m-%dT%H:%M:%SZ")
    records = build_records(catalog, proposals, seeded_at=seeded_at)
    payload = {
        "seed_version": SEED_VERSION,
        "seeded_at": seeded_at,
        "index": build_index(records, seeded_at),
        "records": records,
    }
    Path(args.out).write_text(json.dumps(payload, indent=1) + "\n")
    priced = sum(1 for r in records if r["estimates"])
    photos = sum(1 for r in records if r["photo"])
    print(f"built {len(records)} records "
          f"({priced} with estimates, {photos} with photos) "
          f"-> {args.out}")
    return 0


def _kv_put(account: str, kv_id: str, key: str, value: str) -> None:
    """One KV value write, cf_api.py style: same Cloudflare REST
    base, same registered-connection credential route (with a
    CLOUDFLARE_API_TOKEN env fallback for non-Muse shells)."""
    import os
    import urllib.parse
    import urllib.request

    base = "https://api.cloudflare.com/client/v4"
    path = (f"/accounts/{account}/storage/kv/namespaces/{kv_id}"
            f"/values/{urllib.parse.quote(key, safe='')}")
    req = urllib.request.Request(
        base + path, data=value.encode(), method="PUT",
        headers={"Content-Type": "application/json"})
    token = os.environ.get("CLOUDFLARE_API_TOKEN")
    used_surrogate = False
    if not token:
        sys.path.insert(
            0, "/opt/muse/skills/custom-connector-setup/bin")
        try:
            from dynamic_credentials import add_surrogate_to_request
            add_surrogate_to_request(
                req, "custom.cloudflare",
                allowed_hosts=["api.cloudflare.com"])
            used_surrogate = True
        except Exception:
            pass
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    if not token and not used_surrogate:
        raise RuntimeError(
            "no Cloudflare credential route: register the "
            "custom.cloudflare connection or set CLOUDFLARE_API_TOKEN")
    with urllib.request.urlopen(req, timeout=60) as resp:
        body = json.loads(resp.read().decode() or "{}")
    if not body.get("success", True):
        raise RuntimeError(f"KV put failed for {key}: {body}")


def cmd_upload(args: argparse.Namespace) -> int:
    payload = json.loads(Path(args.records).read_text())
    records = payload["records"]
    for record in records:
        _kv_put(args.account, args.kv_id, f"parts:{record['id']}",
                json.dumps(record))
    _kv_put(args.account, args.kv_id, "parts:index",
            json.dumps(payload["index"]))
    print(f"uploaded {len(records)} part records + parts:index "
          f"to KV namespace {args.kv_id}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)

    b = sub.add_parser("build", help="build records JSON locally")
    b.add_argument("--catalog", default="catalog/parts.json")
    b.add_argument("--proposals-dir", default="tools/gather/proposals")
    b.add_argument("--out", default="tools/parts-api/records.json")
    b.add_argument("--seeded-at", default=None)
    b.set_defaults(fn=cmd_build)

    u = sub.add_parser("upload", help="upload records to RF_LIVE_KV")
    u.add_argument("--records", default="tools/parts-api/records.json")
    u.add_argument("--account", required=True)
    u.add_argument("--kv-id", required=True)
    u.set_defaults(fn=cmd_upload)

    args = parser.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
