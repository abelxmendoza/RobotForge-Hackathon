"""Apply: the separate, explicit step that writes a reviewed proposal into
the catalogs as versioned record updates.

Every applied change:
- records the PRIOR value in the record's `gather_history` (rollback =
  re-apply the prior value from history; nothing is lost),
- stamps per-field provenance under `provenance_gathered` (value, source
  URL, fetched-at, quote, state, run id),
- keeps the field's state at `web_gathered` — applying a proposal is not
  the same as confirming it; confirmation stays a distinct human act (§8).

Proposal entries route to their catalog HOME (Forge Engine §10): parts to
catalog/parts.json, materials to catalog/materials.json (except material
records that live in parts.json — their entries say so), tools to
catalog/tools.json. An entry marked `new_part`/`new_item` (the on-demand
flow, or a registry material/tool with no record yet) CREATES the record
in its home file instead of failing as missing, and apply_run then
promotes the item's draft registry entry from sources.drafts.json into
sources.json — one registry entry per item, in exactly one registry.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

# Catalog home -> the record-list key inside that file (and its filename
# stem: catalog/<home>.json).
HOMES = ("parts", "materials", "tools")


def load_catalog(catalog_path: Path) -> dict:
    return json.loads(Path(catalog_path).read_text())


def save_catalog(catalog: dict, catalog_path: Path) -> None:
    catalog_path = Path(catalog_path)
    tmp = catalog_path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(catalog, indent=1, ensure_ascii=False) + "\n")
    tmp.replace(catalog_path)


def _entry_home(entry: dict) -> str:
    home = entry.get("catalog_home")
    if home in HOMES:
        return home
    return {"material": "materials", "tool": "tools"}.get(
        entry.get("kind", "part"), "parts")


def apply_proposal_set(proposal: dict, docs: dict,
                       applied_at: str | None = None) -> dict:
    """Mutates the catalog documents in `docs` ({home: parsed JSON doc}).
    Returns a report: {applied: [...], missing_parts: [...],
    created_parts: [...]} (ids across all homes)."""
    applied_at = applied_at or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    by_home = {home: {r["id"]: r for r in doc.get(home, [])}
               for home, doc in docs.items()}
    report = {"run_id": proposal["run_id"], "applied": [], "missing_parts": [],
              "created_parts": []}
    for entry in proposal["entries"]:
        home = _entry_home(entry)
        doc = docs.get(home)
        if doc is None:
            report["missing_parts"].append(entry["part_id"])
            continue
        records = doc.setdefault(home, [])
        part = by_home.setdefault(home, {}).get(entry["part_id"])
        if part is None and (entry.get("new_part") or entry.get("new_item")):
            stub = entry.get("part_stub") or {}
            part = {"id": entry["part_id"],
                    "name": stub.get("name") or entry["part_id"],
                    "specs": {}}
            if entry.get("kind", "part") != "part":
                part["kind"] = entry["kind"]
            records.append(part)
            by_home[home][part["id"]] = part
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


def apply_proposal(proposal: dict, catalog: dict,
                   applied_at: str | None = None) -> dict:
    """Parts-catalog-only apply (the original §8 entry point): mutates
    `catalog` (the parsed parts.json dict). Entries homed in other
    catalog files are reported missing — use apply_proposal_set /
    apply_run for multi-catalog proposals."""
    return apply_proposal_set(proposal, {"parts": catalog}, applied_at)


def apply_run(run_id: str, proposals_dir: Path, catalog_path: Path) -> dict:
    """Apply a proposal file to the catalogs around `catalog_path` (the
    parts catalog): materials.json / tools.json are read from — and, when
    an entry homes there, written to — the same directory. The parts
    catalog is always saved; the other files only when touched."""
    proposal_path = Path(proposals_dir) / f"{run_id}.json"
    if not proposal_path.exists():
        raise FileNotFoundError(f"no proposal at {proposal_path}")
    proposal = json.loads(proposal_path.read_text())
    catalog_path = Path(catalog_path)
    docs = {"parts": load_catalog(catalog_path)}
    paths = {"parts": catalog_path}
    for home in ("materials", "tools"):
        sibling = catalog_path.parent / f"{home}.json"
        paths[home] = sibling
        docs[home] = (load_catalog(sibling) if sibling.exists()
                      else {home: []})
    touched = {_entry_home(e) for e in proposal["entries"]}
    report = apply_proposal_set(proposal, docs)
    written = []
    for home in HOMES:
        if home == "parts" or home in touched:
            save_catalog(docs[home], paths[home])
            written.append(str(paths[home]))
    promoted = promote_drafts(report.get("created_parts", []),
                              Path(proposals_dir).parent)
    if promoted:
        report["registry_promoted"] = promoted
    report["catalog"] = str(catalog_path)
    report["catalog_files"] = written
    return report
