"""Apply: the separate, explicit step that writes a reviewed proposal into
catalog/parts.json as versioned record updates.

Every applied change:
- records the PRIOR value in the part's `gather_history` (rollback = re-apply
  the prior value from history; nothing is lost),
- stamps per-field provenance under `provenance_gathered` (value, source URL,
  fetched-at, quote, state, run id),
- keeps the field's state at `web_gathered` — applying a proposal is not the
  same as confirming it; confirmation stays a distinct human act (§8).
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path


def load_catalog(catalog_path: Path) -> dict:
    return json.loads(Path(catalog_path).read_text())


def save_catalog(catalog: dict, catalog_path: Path) -> None:
    catalog_path = Path(catalog_path)
    tmp = catalog_path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(catalog, indent=1, ensure_ascii=False) + "\n")
    tmp.replace(catalog_path)


def apply_proposal(proposal: dict, catalog: dict,
                     applied_at: str | None = None) -> dict:
    """Mutates `catalog` (the parsed parts.json dict). Returns a report of
    what was written: {applied: [...], missing_parts: [...]}."""
    applied_at = applied_at or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    parts_by_id = {p["id"]: p for p in catalog.get("parts", [])}
    report = {"run_id": proposal["run_id"], "applied": [], "missing_parts": []}
    for entry in proposal["entries"]:
        part = parts_by_id.get(entry["part_id"])
        if part is None:
            report["missing_parts"].append(entry["part_id"])
            continue
        for change in entry["changes"]:
            field_name = change["field"]
            if field_name == "price_estimate":
                prior = part.get("price_estimate")
                part["price_estimate"] = change["proposed"]
            else:
                prior = part.setdefault("specs", {}).get(field_name)
                part["specs"][field_name] = change["proposed"]
            part.setdefault("gather_history", []).append({
                "run_id": proposal["run_id"],
                "applied_at": applied_at,
                "field": field_name,
                "prior": prior,
                "new": change["proposed"],
                "source_url": change["source_url"],
            })
            part.setdefault("provenance_gathered", {})[field_name] = {
                "value": change["proposed"],
                "source_url": change["source_url"],
                "fetched_at": change["fetched_at"],
                "quote": change["quote"],
                "state": change.get("state", "web_gathered"),
                "pipeline_version": change.get("pipeline_version", ""),
                "run_id": proposal["run_id"],
            }
            report["applied"].append({
                "part_id": entry["part_id"], "field": field_name,
                "prior": prior, "new": change["proposed"],
            })
    return report


def apply_run(run_id: str, proposals_dir: Path, catalog_path: Path) -> dict:
    proposal_path = Path(proposals_dir) / f"{run_id}.json"
    if not proposal_path.exists():
        raise FileNotFoundError(f"no proposal at {proposal_path}")
    proposal = json.loads(proposal_path.read_text())
    catalog = load_catalog(catalog_path)
    report = apply_proposal(proposal, catalog)
    save_catalog(catalog, catalog_path)
    report["catalog"] = str(catalog_path)
    return report
