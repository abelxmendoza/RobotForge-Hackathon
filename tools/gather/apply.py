"""Apply: the separate, explicit step that writes a reviewed proposal into
catalog/parts.json as versioned record updates.

Every applied change:
- records the PRIOR value in the part's `gather_history` (rollback = re-apply
  the prior value from history; nothing is lost),
- stamps per-field provenance under `provenance_gathered` (value, source URL,
  fetched-at, quote, state, run id),
- keeps the field's state at `web_gathered` — applying a proposal is not the
  same as confirming it; confirmation stays a distinct human act (§8).

A proposal entry marked `new_part` (from gather_part.py's on-demand flow)
creates the catalog part instead of failing as missing, and apply_run then
promotes the part's draft registry entry from sources.drafts.json into
sources.json — one registry entry per part, in exactly one registry.
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
    what was written: {applied: [...], missing_parts: [...]}.

    An entry marked `new_part` (written by gather_part.py for a part the
    catalog did not know) CREATES the catalog part from its `part_stub`
    instead of landing in missing_parts; an entry's `photo_candidate`
    becomes the part's `photo` record when the part has none."""
    applied_at = applied_at or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    parts_by_id = {p["id"]: p for p in catalog.get("parts", [])}
    report = {"run_id": proposal["run_id"], "applied": [], "missing_parts": [],
              "created_parts": []}
    for entry in proposal["entries"]:
        part = parts_by_id.get(entry["part_id"])
        if part is None and entry.get("new_part"):
            stub = entry.get("part_stub") or {}
            part = {"id": entry["part_id"],
                    "name": stub.get("name") or entry["part_id"],
                    "specs": {}}
            catalog.setdefault("parts", []).append(part)
            parts_by_id[part["id"]] = part
            report["created_parts"].append(part["id"])
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
        photo = entry.get("photo_candidate")
        if photo and not part.get("photo"):
            part["photo"] = photo
            part.setdefault("gather_history", []).append({
                "run_id": proposal["run_id"],
                "applied_at": applied_at,
                "field": "photo",
                "prior": None,
                "new": photo,
                "source_url": photo.get("source_page", ""),
            })
            part.setdefault("provenance_gathered", {})["photo"] = {
                "value": photo,
                "source_url": photo.get("source_page", ""),
                "fetched_at": applied_at,
                "quote": "",
                "state": photo.get("state", "web_gathered"),
                "pipeline_version": proposal.get("pipeline_version", ""),
                "run_id": proposal["run_id"],
            }
            report["applied"].append({
                "part_id": entry["part_id"], "field": "photo",
                "prior": None, "new": photo,
            })
    return report


def promote_drafts(part_ids: list[str], gather_dir: Path) -> list[str]:
    """Move draft registry entries for newly created parts from
    sources.drafts.json into sources.json (one registry entry per part,
    in exactly one registry). Returns the promoted part ids."""
    gather_dir = Path(gather_dir)
    drafts_path = gather_dir / "sources.drafts.json"
    registry_path = gather_dir / "sources.json"
    if not part_ids or not drafts_path.exists() or not registry_path.exists():
        return []
    drafts = json.loads(drafts_path.read_text())
    registry = json.loads(registry_path.read_text())
    moved, keep = [], []
    for entry in drafts.get("sources", []):
        if entry.get("part_id") in part_ids:
            moved.append({k: v for k, v in entry.items() if k != "draft"})
        else:
            keep.append(entry)
    if not moved:
        return []
    drafts["sources"] = keep
    registry.setdefault("sources", []).extend(moved)
    for path, data in ((drafts_path, drafts), (registry_path, registry)):
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n")
        tmp.replace(path)
    return [e["part_id"] for e in moved]


def apply_run(run_id: str, proposals_dir: Path, catalog_path: Path) -> dict:
    proposal_path = Path(proposals_dir) / f"{run_id}.json"
    if not proposal_path.exists():
        raise FileNotFoundError(f"no proposal at {proposal_path}")
    proposal = json.loads(proposal_path.read_text())
    catalog = load_catalog(catalog_path)
    report = apply_proposal(proposal, catalog)
    save_catalog(catalog, catalog_path)
    promoted = promote_drafts(report.get("created_parts", []),
                              Path(proposals_dir).parent)
    if promoted:
        report["registry_promoted"] = promoted
    report["catalog"] = str(catalog_path)
    return report
