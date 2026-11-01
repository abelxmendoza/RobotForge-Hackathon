#!/usr/bin/env python3
"""Gather pipeline CLI — Forge Engine §8 / §8.1.

Usage:
  python3 tools/gather/gather.py run [--part ID] [--force]
  python3 tools/gather/gather.py apply <run-id>

`run` is a DRY RUN: fetch -> extract (changed pages only) -> validate ->
diff -> write proposals/<run-id>.json + .md. It changes nothing in the
catalog. `apply` is the separate explicit step that writes a reviewed
proposal into catalog/parts.json with prior values kept in gather_history.

Repeat-run economics (§8.1): pages are cached by content hash. A page whose
hash is unchanged is never re-extracted, so a repeat run over unchanged
sources makes ZERO model calls and proposes ZERO changes.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from gather import PIPELINE_VERSION  # noqa: E402
from gather.apply import apply_run  # noqa: E402
from gather.extract import ExtractionUnavailable, MetaModelExtractor  # noqa: E402
from gather.fetcher import Fetcher  # noqa: E402
from gather.propose import diff_part, write_proposal  # noqa: E402
from gather.validate import validate_extraction  # noqa: E402

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent.parent

DEFAULT_TTLS = {"price": 86400, "stock": 21600, "specs": 2592000, "datasheet": 7776000}
PAGE_KINDS = {"product", "datasheet"}


def iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------- registry

def load_registry(path: Path) -> list[dict]:
    data = json.loads(Path(path).read_text())
    entries = data["sources"] if isinstance(data, dict) else data
    for entry in entries:
        if "part_id" not in entry or "pages" not in entry:
            raise ValueError(f"registry entry missing part_id/pages: {entry!r}")
        for page in entry["pages"]:
            if "url" not in page or page.get("kind") not in PAGE_KINDS:
                raise ValueError(f"bad page in registry for {entry['part_id']}: {page!r}")
            if not page.get("provides"):
                raise ValueError(f"page without 'provides' for {entry['part_id']}: {page!r}")
    return entries


def page_ttl(entry: dict, page: dict) -> int:
    ttls = {**DEFAULT_TTLS, **entry.get("ttl_seconds", {})}
    return min(ttls[c] for c in page["provides"])


# ---------------------------------------------------------------- pipeline

def _split_ranges(fields: list) -> dict:
    """{field: ValidField}; a range on field F becomes F_min/F_max when both
    are catalog fields (the catalog already speaks voltage_v_max), else the
    range is kept whole under F."""
    out: dict = {}
    from gather.validate import ALLOWED_FIELDS
    for vf in fields:
        if isinstance(vf.value, list):
            lo_key, hi_key = f"{vf.field}_min", f"{vf.field}_max"
            if lo_key in ALLOWED_FIELDS and hi_key in ALLOWED_FIELDS:
                for key, val in ((lo_key, vf.value[0]), (hi_key, vf.value[1])):
                    out[key] = type(vf)(field=key, value=val, unit=vf.unit,
                                        quote=vf.quote, source_url=vf.source_url,
                                        safety_relevant=True)
                continue
        out[vf.field] = vf
    return out


def run_pipeline(entries: list[dict], catalog: dict, fetcher: Fetcher,
                 extractor, *, part_filter: str | None = None,
                 force: bool = False, now: float | None = None) -> dict:
    now = time.time() if now is None else now
    run_id = datetime.fromtimestamp(now, timezone.utc).strftime("%Y%m%dT%H%M%SZ") \
        + "-" + uuid.uuid4().hex[:6]
    parts_by_id = {p["id"]: p for p in catalog.get("parts", [])}
    proposal = {
        "run_id": run_id,
        "pipeline_version": PIPELINE_VERSION,
        "created_at": iso(now),
        "entries": [],
        "summary": {"pages": 0, "fetched_changed": 0, "unchanged": 0, "skipped": 0,
                    "model_calls": 0, "changes": 0, "rejected": 0,
                    "extractor_errors": 0},
    }
    calls_before = getattr(extractor, "calls", 0)

    for entry in entries:
        part_id = entry["part_id"]
        if part_filter and part_id != part_filter:
            continue
        part = parts_by_id.get(part_id)
        ent = {"part_id": part_id, "pages": [], "changes": [], "rejected": [],
               "notes": []}
        if part is None:
            ent["notes"].append("part id not found in catalog; skipped")
            proposal["entries"].append(ent)
            continue

        fields_by_name: dict = {}
        price_info: dict | None = None
        latest_fetch = 0.0
        # product pages first, datasheets last (datasheet wins a spec conflict)
        pages = sorted(entry["pages"], key=lambda p: 0 if p["kind"] == "product" else 1)
        for page in pages:
            proposal["summary"]["pages"] += 1
            result = fetcher.fetch(page["url"], ttl_seconds=page_ttl(entry, page),
                                   force=force)
            page_rec = {"url": page["url"], "kind": page["kind"],
                        "changed": result.changed,
                        "content_hash": result.content_hash,
                        "fetched_at": iso(result.fetched_at) if result.fetched_at else "",
                        "skipped_reason": result.skipped_reason}
            ent["pages"].append(page_rec)
            if result.skipped_reason:
                proposal["summary"]["skipped"] += 1
                continue
            latest_fetch = max(latest_fetch, result.fetched_at)
            if not result.changed:
                proposal["summary"]["unchanged"] += 1
                continue
            proposal["summary"]["fetched_changed"] += 1
            try:
                raw = extractor.extract(
                    {"part_id": part_id, "name": part.get("name", part_id),
                     "mpn": entry.get("mpn")},
                    result.text, page["url"])
            except ExtractionUnavailable as e:
                proposal["summary"]["extractor_errors"] += 1
                ent["notes"].append(f"extraction unavailable for {page['url']}: {e}")
                continue
            validated = validate_extraction(raw, result.text, page["url"])
            for rej in validated.rejected:
                ent["rejected"].append({"item": rej.item, "reason": rej.reason,
                                        "detail": rej.detail})
            for name, vf in _split_ranges(validated.fields).items():
                if name in fields_by_name and page["kind"] != "datasheet":
                    continue  # an earlier page already set it; only datasheets override
                if name in fields_by_name:
                    ent["notes"].append(
                        f"field {name}: datasheet value overrides product-page value")
                fields_by_name[name] = vf
            if validated.price_breaks and price_info is None:
                price_info = {
                    "price_breaks": validated.price_breaks,
                    "stock_wording": validated.stock_wording,
                    "source_url": page["url"],
                }
                for b in validated.price_breaks:
                    b.setdefault("quote", b.get("quote", ""))
            elif validated.price_breaks:
                ent["notes"].append(
                    f"price breaks from {page['url']} ignored; "
                    f"already priced from {price_info['source_url']}")

        fetched_iso = iso(latest_fetch or now)
        ttls = {**DEFAULT_TTLS, **entry.get("ttl_seconds", {})}
        ent["changes"] = diff_part(part, fields_by_name, price_info,
                                   fetched_iso, ttls["price"])
        ent["rejected"].sort(key=lambda r: (r["item"], r["reason"]))
        proposal["summary"]["changes"] += len(ent["changes"])
        proposal["summary"]["rejected"] += len(ent["rejected"])
        proposal["entries"].append(ent)

    proposal["summary"]["model_calls"] = getattr(extractor, "calls", 0) - calls_before
    return proposal


# ---------------------------------------------------------------- CLI

def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="gather", description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)

    r = sub.add_parser("run", help="dry run: fetch, extract, validate, propose")
    r.add_argument("--part", help="only this catalog part id")
    r.add_argument("--force", action="store_true",
                   help="refetch even within TTL (hash still gates extraction)")
    r.add_argument("--registry", type=Path, default=HERE / "sources.json")
    r.add_argument("--catalog", type=Path, default=REPO_ROOT / "catalog" / "parts.json")
    r.add_argument("--cache-dir", type=Path, default=HERE / "cache")
    r.add_argument("--proposals-dir", type=Path, default=HERE / "proposals")

    a = sub.add_parser("apply", help="write a reviewed proposal into the catalog")
    a.add_argument("run_id")
    a.add_argument("--proposals-dir", type=Path, default=HERE / "proposals")
    a.add_argument("--catalog", type=Path, default=REPO_ROOT / "catalog" / "parts.json")

    args = ap.parse_args(argv)

    if args.cmd == "run":
        entries = load_registry(args.registry)
        catalog = json.loads(args.catalog.read_text())
        fetcher = Fetcher(cache_dir=args.cache_dir)
        extractor = MetaModelExtractor()
        proposal = run_pipeline(entries, catalog, fetcher, extractor,
                                part_filter=args.part, force=args.force)
        json_path, md_path = write_proposal(proposal, args.proposals_dir)
        report = {**proposal["summary"], "run_id": proposal["run_id"],
                  "proposal_json": str(json_path), "proposal_md": str(md_path)}
        print(json.dumps(report, indent=1))
        return 2 if proposal["summary"]["extractor_errors"] else 0

    if args.cmd == "apply":
        report = apply_run(args.run_id, args.proposals_dir, args.catalog)
        print(json.dumps(report, indent=1))
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
