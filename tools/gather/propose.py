"""Diff validated fields against the catalog and render proposals.

A proposal is a FILE, not a write: `run` produces proposals/<run-id>.json
plus a human-readable .md diff; nothing touches catalog/parts.json until
`apply` runs as a separate, explicit step (propose-don't-apply, the
Oct 28 retrieval-layer rule).
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from . import PIPELINE_VERSION
from .validate import SAFETY_FIELDS


def _close(a, b, tol: float = 0.005) -> bool:
    """Float equality with a relative tolerance; ranges compare both ends."""
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return abs(float(a) - float(b)) <= tol * max(1.0, abs(float(a)), abs(float(b)))
    if isinstance(a, list) and isinstance(b, list) and len(a) == len(b) == 2:
        return _close(a[0], b[0], tol) and _close(a[1], b[1], tol)
    return a == b


def _fmt(value) -> str:
    if value is None:
        return "(none)"
    if isinstance(value, list):
        return f"[{value[0]}, {value[1]}]"
    return str(value)


def diff_part(part: dict, validated_by_field: dict, price_info: dict | None,
              fetched_at_iso: str, ttl_price_s: int) -> list[dict]:
    """validated_by_field: {field_name: ValidField} (ranges already split to
    *_min/*_max entries by the pipeline). Returns change dicts."""
    specs = part.get("specs", {})
    changes: list[dict] = []
    for name, vf in sorted(validated_by_field.items()):
        current = specs.get(name)
        if current is not None and _close(current, vf.value):
            continue
        changes.append({
            "field": name,
            "kind": "spec_update" if current is not None else "spec_new",
            "current": current,
            "proposed": vf.value,
            "unit_as_printed": vf.unit,
            "quote": vf.quote,
            "source_url": vf.source_url,
            "fetched_at": fetched_at_iso,
            "state": "web_gathered",
            "safety_relevant": name in SAFETY_FIELDS,
            "pipeline_version": PIPELINE_VERSION,
        })
    if price_info and price_info.get("price_breaks"):
        breaks = price_info["price_breaks"]
        applied = next((b for b in breaks if b["qty"] == 1), breaks[0])
        proposed_price = {
            "unit_price": applied["unit_price"],
            "currency": applied["currency"],
            "price_breaks": [{"qty": b["qty"], "unit_price": b["unit_price"]}
                             for b in breaks],
            "stock_wording": price_info.get("stock_wording"),
            "source_kind": "web_gathered",
            "supplier_url": price_info["source_url"],
            "fetched_at": fetched_at_iso,
            "expires_at": _plus_seconds(fetched_at_iso, ttl_price_s),
            "quote": applied["quote"],
        }
        current_price = part.get("price_estimate")
        same = (
            isinstance(current_price, dict)
            and current_price.get("unit_price") == proposed_price["unit_price"]
            and current_price.get("supplier_url") == proposed_price["supplier_url"]
        )
        if not same:
            changes.append({
                "field": "price_estimate",
                "kind": "price_update",
                "current": current_price,
                "proposed": proposed_price,
                "quote": applied["quote"],
                "source_url": price_info["source_url"],
                "fetched_at": fetched_at_iso,
                "state": "web_gathered",
                "safety_relevant": False,
                "pipeline_version": PIPELINE_VERSION,
            })
    return changes


def _plus_seconds(iso: str, seconds: int) -> str:
    dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    from datetime import timedelta
    return (dt + timedelta(seconds=seconds)).strftime("%Y-%m-%dT%H:%M:%SZ")


def render_md(proposal: dict) -> str:
    lines: list[str] = []
    lines.append(f"# Gather proposal {proposal['run_id']}")
    lines.append("")
    lines.append(f"Pipeline: {proposal['pipeline_version']} · "
                 f"Run at: {proposal['created_at']} · "
                 f"Changes proposed: {proposal['summary']['changes']} · "
                 f"Fields rejected at validation: {proposal['summary']['rejected']}")
    lines.append("")
    lines.append("Nothing in the catalog has been changed by this file. "
                 "Review, then apply with: "
                 f"`python3 tools/gather/gather.py apply {proposal['run_id']}`")
    lines.append("")
    any_changes = False
    for entry in proposal["entries"]:
        part_changes = entry["changes"]
        pages = entry["pages"]
        lines.append(f"## {entry['part_id']}")
        for pg in pages:
            state = ("skipped: " + pg["skipped_reason"]) if pg.get("skipped_reason") \
                else ("unchanged (hash match, not re-extracted)" if not pg["changed"]
                      else "fetched, content changed")
            lines.append(f"- Source: {pg['url']} — {state}")
        if entry.get("notes"):
            for note in entry["notes"]:
                lines.append(f"- Note: {note}")
        if not part_changes:
            lines.append("- No changes proposed.")
            lines.append("")
            continue
        any_changes = True
        bulk = [c for c in part_changes if not c["safety_relevant"]]
        confirm = [c for c in part_changes if c["safety_relevant"]]
        if bulk:
            lines.append("")
            lines.append("### Bulk-approvable")
            for c in bulk:
                lines.append(_change_line(c))
        if confirm:
            lines.append("")
            lines.append("### ⚠ Confirm individually (safety-relevant)")
            for c in confirm:
                lines.append(_change_line(c))
        lines.append("")
    for entry in proposal["entries"]:
        if entry["rejected"]:
            lines.append(f"## Rejected extractions — {entry['part_id']}")
            for r in entry["rejected"]:
                lines.append(f"- `{r['item']}`: {r['reason']}"
                             + (f" ({r['detail']})" if r.get("detail") else ""))
            lines.append("")
    if not any_changes:
        lines.append("**No changes proposed by this run.**")
    return "\n".join(lines) + "\n"


def _change_line(c: dict) -> str:
    if c["field"] == "price_estimate":
        p = c["proposed"]
        breaks = ", ".join(f"{b['qty']}+ @ {b['unit_price']}" for b in p["price_breaks"])
        return (f"- **price**: {_fmt(c['current'] and c['current'].get('unit_price'))} → "
                f"**{p['unit_price']} {p['currency']}** (breaks: {breaks}; "
                f"stock: {p.get('stock_wording') or 'not stated'})\n"
                f"  - quote: “{c['quote']}”\n"
                f"  - source: {c['source_url']} · fetched {c['fetched_at']} · "
                f"state: web-gathered estimate")
    return (f"- **{c['field']}**: {_fmt(c['current'])} → **{_fmt(c['proposed'])}**"
            f"{' (new field)' if c['kind'] == 'spec_new' else ''}\n"
            f"  - quote: “{c['quote']}”\n"
            f"  - source: {c['source_url']} · fetched {c['fetched_at']} · state: web_gathered")


def write_proposal(proposal: dict, out_dir: Path) -> tuple[Path, Path]:
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    json_path = out_dir / f"{proposal['run_id']}.json"
    md_path = out_dir / f"{proposal['run_id']}.md"
    json_path.write_text(json.dumps(proposal, indent=1, ensure_ascii=False))
    md_path.write_text(render_md(proposal))
    return json_path, md_path
