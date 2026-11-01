#!/usr/bin/env python3
"""On-demand gathering for UNKNOWN parts — Forge Engine §8 follow-up.

gather.py refreshes parts the catalog already knows. This CLI is the
intake for parts it does NOT: when chat, a BOM, or a Parts-API 404 names
a part that is not in catalog/parts.json, the flow is

  1. DEDUPE — deterministic name matching against the catalog (ids,
     names, source strings). A hit returns "already known as <id>" and
     STOPS: no fetch, no model call, no proposal, no duplicate registry
     entry. Matching is substring/token based on purpose — no fuzzy
     edit distance, so a near-miss like BNO085 does NOT match the
     catalog's BNO055.
  2. REGISTRY DRAFT — a genuine miss gets ONE draft entry in
     sources.drafts.json (same shape as sources.json). Re-running for
     the same part reuses the draft and merges in any new page URLs.
  3. GATHER -> PROPOSAL — each page runs through the existing pipeline
     (content-hash cache, Muse Spark extraction, literal-quote
     validation, unit normalization). Spec values that CONFLICT across
     sources are surfaced as confirm-queue notes: the datasheet value
     wins (the pipeline's existing precedence), the losing value stays
     recorded on the change, and the change is forced into the
     safety-relevant confirm queue. The catalog is never touched;
     `gather.py apply <run-id>` stays the separate step, and applying a
     new-part proposal creates the catalog part and promotes the draft
     registry entry into sources.json.

Usage:
  python3 tools/gather/gather_part.py "TB6612"
      -> dedupe hit: {"status": "known", "part_id": "driver_tb6612fng", ...}
  python3 tools/gather/gather_part.py "AS5600 magnetic encoder" \
      --url <manufacturer/product page> --url <distributor or datasheet>
      -> dedupe miss: draft entry + proposal at state web_gathered
  python3 tools/gather/gather_part.py "Some new part"
      -> miss without sources: queued in requests.jsonl as needs_sources
  python3 tools/gather/gather_part.py --from-requests
      -> drain requests.jsonl (see README: the requests queue)

Source resolution is an AGENT step, done before the CLI runs: a human or
agent finds the manufacturer's product page and one distributor listing
with web search and passes the URLs in. First URL is the primary source;
a datasheet page (URL ending .pdf, or --kind datasheet) outranks product
pages on spec conflicts, per the pipeline's precedence.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import uuid
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from gather import PIPELINE_VERSION  # noqa: E402
from gather.extract import MetaModelExtractor  # noqa: E402
from gather.fetcher import Fetcher  # noqa: E402
from gather.gather import DEFAULT_TTLS, iso, run_pipeline  # noqa: E402
from gather.propose import _close, write_proposal  # noqa: E402

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent.parent

PROVIDES = {"product": ["price", "stock", "specs"],
            "datasheet": ["specs", "datasheet"]}
DRAFTS_COMMENT = (
    "Draft gather registry entries for parts NOT yet in the catalog, "
    "created by gather_part.py (on-demand gathering, Forge Engine §8). "
    "Same shape as sources.json. An entry is promoted into sources.json "
    "by `gather.py apply` when its new-part proposal is applied."
)
ACTIONABLE_STATUSES = ("pending", "needs_sources")


# ---------------------------------------------------------------- dedupe

_TOKEN_RE = re.compile(r"[a-z0-9]+")


def _tokens(text: str) -> list[str]:
    return _TOKEN_RE.findall((text or "").lower())


def _squash(text: str) -> str:
    return "".join(_tokens(text))


def _token_match(query_tok: str, part_tok: str) -> bool:
    if query_tok == part_tok:
        return True
    return (len(query_tok) >= 3 and len(part_tok) >= 3
            and (query_tok in part_tok or part_tok in query_tok))


def lookup_part(name: str, catalog: dict) -> tuple[dict | None, list[str]]:
    """Deterministic dedupe of a free-text part name against the catalog.

    Returns (best_part, also_matched_ids) or (None, []). A hit requires
    either a squashed-substring match on id/name/source, or EVERY query
    token matching some catalog token. No edit-distance fuzz: BNO085
    must not resolve to BNO055."""
    q_squash = _squash(name)
    q_tokens = _tokens(name)
    scored: list[tuple[int, int, dict]] = []
    for idx, part in enumerate(catalog.get("parts", [])):
        texts = [part.get("id", "").replace("_", " "),
                 part.get("name", ""), part.get("source") or ""]
        p_tokens: set[str] = set()
        for t in texts:
            p_tokens.update(_tokens(t))
        score = 0
        for t in texts:
            st = _squash(t)
            if len(q_squash) >= 4 and q_squash in st:
                score = max(score, 100 + len(q_squash))
            elif len(st) >= 5 and st in q_squash:
                score = max(score, 100 + len(st))
        if q_tokens and all(any(_token_match(qt, pt) for pt in p_tokens)
                            for qt in q_tokens):
            score = max(score, 50 + sum(len(qt) for qt in q_tokens))
        if score:
            scored.append((score, idx, part))
    if not scored:
        return None, []
    scored.sort(key=lambda s: (-s[0], s[1]))
    best = scored[0][2]
    also = [p["id"] for _, _, p in scored[1:]]
    return best, also


def slugify_part_id(name: str) -> str:
    toks = _tokens(name)
    return "_".join(toks) if toks else "unknown_part"


# ---------------------------------------------------------------- drafts

def load_drafts(path: Path) -> dict:
    path = Path(path)
    if not path.exists():
        return {"version": 1, "comment": DRAFTS_COMMENT, "sources": []}
    data = json.loads(path.read_text())
    if isinstance(data, list):
        data = {"version": 1, "comment": DRAFTS_COMMENT, "sources": data}
    data.setdefault("sources", [])
    return data


def save_drafts(path: Path, data: dict) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n")
    tmp.replace(path)


def supplier_of(url: str) -> str:
    host = urlparse(url).netloc.lower().split("@")[-1].split(":")[0]
    parts = [p for p in host.split(".") if p and p != "www"]
    return parts[-2] if len(parts) >= 2 else (parts[0] if parts else "unknown")


def classify_kind(url: str, hint: str | None = None) -> str:
    if hint:
        return hint
    return "datasheet" if urlparse(url).path.lower().endswith(".pdf") else "product"


def build_page(url: str, kind: str | None = None,
               supplier: str | None = None) -> dict:
    kind = classify_kind(url, kind)
    return {"kind": kind, "url": url,
            "supplier": supplier or supplier_of(url),
            "provides": list(PROVIDES[kind])}


def build_draft_entry(part_id: str, name: str, urls: list[str], *,
                      mpn: str | None = None, kinds: list | None = None,
                      suppliers: list | None = None,
                      requested_by: str = "cli", at: str = "") -> dict:
    pages = [build_page(u, kinds[i] if kinds and i < len(kinds) else None,
                        suppliers[i] if suppliers and i < len(suppliers) else None)
             for i, u in enumerate(urls)]
    return {
        "part_id": part_id, "mpn": mpn,
        "supplier": pages[0]["supplier"] if pages else "unknown",
        "ttl_seconds": dict(DEFAULT_TTLS),
        "pages": pages,
        "draft": True,
        "origin": {"via": "gather_part", "requested_name": name,
                   "requested_by": requested_by, "at": at},
    }


# ---------------------------------------------------------------- photo

class _MetaScan(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.og_image: str | None = None

    def handle_starttag(self, tag, attrs):
        if tag == "meta" and self.og_image is None:
            a = {k.lower(): (v or "") for k, v in attrs}
            if a.get("property") == "og:image" and a.get("content"):
                self.og_image = a["content"]


def photo_candidate(fetcher: Fetcher, entry: dict) -> dict | None:
    """Deterministic photo candidate: the og:image of the first product
    page, read from the fetcher's cached raw bytes (no extra fetch, no
    model call). Credit is the page's supplier; state web_gathered —
    a human confirms the photo shows this exact part before apply."""
    for page in entry["pages"]:
        if page["kind"] != "product":
            continue
        rec = fetcher.index.get("urls", {}).get(page["url"])
        if not rec:
            continue
        blob = fetcher.cache_dir / "blobs" / rec["hash"]
        if not blob.exists():
            continue
        scan = _MetaScan()
        try:
            scan.feed(blob.read_bytes().decode("utf-8", errors="replace"))
        except Exception:
            continue
        if scan.og_image:
            return {"url": urljoin(page["url"], scan.og_image),
                    "source_page": page["url"],
                    "credit": page.get("supplier") or supplier_of(page["url"]),
                    "state": "web_gathered", "via": "og:image"}
    return None


# ---------------------------------------------------------------- merging

def _fmt_val(v) -> str:
    return json.dumps(v, ensure_ascii=False)


def _values_differ(field_name: str, a: dict, b: dict) -> bool:
    if field_name == "price_estimate":
        pa, pb = a["proposed"], b["proposed"]
        return (pa.get("unit_price") != pb.get("unit_price")
                or pa.get("currency") != pb.get("currency"))
    return not _close(a["proposed"], b["proposed"])


def _change_value(change: dict):
    """Human-readable rendering for notes."""
    if change["field"] == "price_estimate":
        p = change["proposed"]
        return f"{p.get('unit_price')} {p.get('currency', '')}".strip()
    return _fmt_val(change["proposed"])


def _conflict_value(change: dict):
    """Structured value recorded on a conflict (raw, not rendered)."""
    if change["field"] == "price_estimate":
        p = change["proposed"]
        return {"unit_price": p.get("unit_price"),
                "currency": p.get("currency")}
    return change["proposed"]


def merge_page_entries(part_id: str, per_page: list) -> tuple[dict, list[str]]:
    """per_page: [(page_dict, pipeline_entry)] in the order URLs were
    given. Winner per field: datasheet page first (pipeline precedence),
    else earliest page. Every losing value that DIFFERS is recorded on
    the winning change as a conflict and forces the confirm queue."""
    merged: dict = {"part_id": part_id, "pages": [], "changes": [],
                    "rejected": [], "notes": []}
    by_field: dict[str, list] = {}
    for page, ent in per_page:
        merged["pages"].extend(ent["pages"])
        merged["rejected"].extend(ent["rejected"])
        merged["notes"].extend(ent.get("notes", []))
        for change in ent["changes"]:
            by_field.setdefault(change["field"], []).append((page, change))
    conflicts: list[str] = []
    for field_name in sorted(by_field):
        cands = by_field[field_name]
        ranked = sorted(enumerate(cands),
                        key=lambda t: (0 if t[1][0]["kind"] == "datasheet" else 1,
                                       t[0]))
        win_page, win_change = ranked[0][1]
        winner = dict(win_change)
        for page, other in cands:
            if other is win_change:
                continue
            if not _values_differ(field_name, winner, other):
                continue
            conflicts.append(field_name)
            winner["safety_relevant"] = True
            winner.setdefault("conflicts", []).append({
                "kept": {"value": _conflict_value(winner),
                         "source_url": winner["source_url"],
                         "quote": winner["quote"]},
                "other": {"value": _conflict_value(other),
                          "source_url": other["source_url"],
                          "quote": other["quote"]},
            })
            merged["notes"].append(
                f"conflict on {field_name}: {winner['source_url']} reports "
                f"{_change_value(winner)} (“{winner['quote']}”); "
                f"{other['source_url']} reports {_change_value(other)} "
                f"(“{other['quote']}”) — keeping the "
                f"{win_page['kind']} source per datasheet-over-product "
                f"precedence; routed to the confirm queue")
        merged["changes"].append(winner)
    merged["changes"].sort(key=lambda c: c["field"])
    merged["rejected"].sort(key=lambda r: (r["item"], r["reason"]))
    return merged, conflicts


# ---------------------------------------------------------------- core

def gather_unknown(name: str, urls: list[str], *, catalog: dict,
                   drafts_path: Path, fetcher: Fetcher, extractor,
                   proposals_dir: Path, mpn: str | None = None,
                   kinds: list | None = None, suppliers: list | None = None,
                   requested_by: str = "cli",
                   now: float | None = None) -> dict:
    """Dedupe -> draft -> gather -> proposal for one unknown part name.
    Pure orchestration over the existing pipeline machinery; the catalog
    dict passed in is never mutated (a synthetic copy carries the stub)."""
    now = time.time() if now is None else now
    hit, also = lookup_part(name, catalog)
    if hit is not None:
        return {"status": "known", "part_id": hit["id"],
                "name": hit.get("name"), "also_matched": also}

    part_id = slugify_part_id(name)
    drafts = load_drafts(drafts_path)
    entry = next((e for e in drafts["sources"]
                  if e.get("part_id") == part_id), None)
    draft_state = "reused"
    if entry is None:
        entry = build_draft_entry(part_id, name, urls, mpn=mpn, kinds=kinds,
                                  suppliers=suppliers,
                                  requested_by=requested_by, at=iso(now))
        drafts["sources"].append(entry)
        save_drafts(drafts_path, drafts)
        draft_state = "created"
    else:
        known_urls = {p["url"] for p in entry["pages"]}
        added = False
        for i, u in enumerate(urls):
            if u not in known_urls:
                entry["pages"].append(build_page(
                    u, kinds[i] if kinds and i < len(kinds) else None,
                    suppliers[i] if suppliers and i < len(suppliers) else None))
                added = True
        if added:
            save_drafts(drafts_path, drafts)

    if not entry["pages"]:
        return {"status": "needs_sources", "part_id": part_id,
                "registry_draft": draft_state}

    stub = {"id": part_id, "name": name, "specs": {}}
    synth = {"parts": [*(catalog.get("parts") or []), stub],
             "templates": catalog.get("templates", [])}
    calls_before = getattr(extractor, "calls", 0)
    per_page, summaries = [], []
    for page in entry["pages"]:
        single = {**entry, "pages": [page]}
        prop = run_pipeline([single], synth, fetcher, extractor, now=now)
        per_page.append((page, prop["entries"][0]))
        summaries.append(prop["summary"])

    merged, conflicts = merge_page_entries(part_id, per_page)
    merged["new_part"] = True
    merged["part_stub"] = stub
    merged["requested_name"] = name
    photo = photo_candidate(fetcher, entry)
    if photo:
        merged["photo_candidate"] = photo
        merged["notes"].append(
            f"photo candidate (og:image on {photo['source_page']}): "
            f"{photo['url']} — credit: {photo['credit']}; state "
            f"web_gathered, confirm the photo shows this exact part "
            f"before apply")

    run_id = datetime.fromtimestamp(now, timezone.utc).strftime("%Y%m%dT%H%M%SZ") \
        + "-" + uuid.uuid4().hex[:6]
    summary = {"pages": 0, "fetched_changed": 0, "unchanged": 0, "skipped": 0,
               "model_calls": getattr(extractor, "calls", 0) - calls_before,
               "changes": len(merged["changes"]),
               "rejected": len(merged["rejected"]), "extractor_errors": 0}
    for s in summaries:
        for k in ("pages", "fetched_changed", "unchanged", "skipped",
                  "extractor_errors"):
            summary[k] += s[k]
    proposal = {"run_id": run_id, "pipeline_version": PIPELINE_VERSION,
                "created_at": iso(now), "entries": [merged],
                "summary": summary}
    json_path, md_path = write_proposal(proposal, Path(proposals_dir))
    fetched_ok = any(not pg.get("skipped_reason") for pg in merged["pages"])
    return {"status": "proposed" if fetched_ok else "no_data",
            "part_id": part_id, "run_id": run_id,
            "proposal_json": str(json_path), "proposal_md": str(md_path),
            "model_calls": summary["model_calls"],
            "changes": len(merged["changes"]), "conflicts": conflicts,
            "registry_draft": draft_state,
            "photo_candidate": photo is not None,
            "pages": merged["pages"]}


# ---------------------------------------------------------------- requests

def load_requests(path: Path) -> list[dict]:
    path = Path(path)
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text().splitlines()
            if line.strip()]


def save_requests(path: Path, lines: list[dict]) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".jsonl.tmp")
    tmp.write_text("".join(json.dumps(l, ensure_ascii=False) + "\n"
                           for l in lines))
    tmp.replace(path)


def queue_request(path: Path, name: str, *, requested_by: str = "cli",
                  hint_url: str | None = None, urls: list | None = None,
                  now: float | None = None) -> dict:
    """Append one unknown-part request unless an open line for the same
    normalized name already exists (the queue dedupes like the catalog)."""
    now = time.time() if now is None else now
    lines = load_requests(path)
    key = _squash(name)
    for line in lines:
        if (_squash(line.get("name", "")) == key
                and line.get("status") in ACTIONABLE_STATUSES):
            return {"status": line["status"], "queued": False,
                    "already_queued": True, "line": line}
    line = {"name": name, "requested_by": requested_by, "at": iso(now),
            "status": "pending" if (urls or hint_url) else "needs_sources"}
    if hint_url:
        line["hint_url"] = hint_url
    if urls:
        line["urls"] = list(urls)
    lines.append(line)
    save_requests(path, lines)
    return {"status": line["status"], "queued": True, "line": line}


def drain_requests(path: Path, *, catalog: dict, drafts_path: Path,
                   fetcher: Fetcher, extractor, proposals_dir: Path,
                   now: float | None = None) -> list[dict]:
    """Process every actionable queue line, honestly:
    known name -> "known"; URLs resolvable -> gather -> "proposed";
    no URLs -> "needs_sources"; a total fetch failure stays actionable
    with a last_attempt note; a repeat of a part already proposed in
    this same drain is marked a duplicate, never re-gathered."""
    now = time.time() if now is None else now
    lines = load_requests(path)
    outcomes: list[dict] = []
    proposed_ids: dict[str, str] = {}
    for line in lines:
        if line.get("status") not in ACTIONABLE_STATUSES:
            continue
        name = line["name"]
        hit, _also = lookup_part(name, catalog)
        if hit is not None:
            line["status"] = "known"
            line["part_id"] = hit["id"]
            outcomes.append({"name": name, "result": "known",
                             "part_id": hit["id"]})
            continue
        part_id = slugify_part_id(name)
        if part_id in proposed_ids:
            line["status"] = "proposed"
            line["part_id"] = part_id
            line["run_id"] = proposed_ids[part_id]
            line["note"] = "duplicate of an earlier request in this drain"
            outcomes.append({"name": name, "result": "proposed",
                             "part_id": part_id, "duplicate": True})
            continue
        urls = list(line.get("urls") or
                    ([line["hint_url"]] if line.get("hint_url") else []))
        if not urls:
            line["status"] = "needs_sources"
            outcomes.append({"name": name, "result": "needs_sources"})
            continue
        rep = gather_unknown(name, urls, catalog=catalog,
                             drafts_path=drafts_path, fetcher=fetcher,
                             extractor=extractor, proposals_dir=proposals_dir,
                             kinds=line.get("kinds"),
                             requested_by=line.get("requested_by", "queue"),
                             now=now)
        if rep["status"] == "proposed":
            line["status"] = "proposed"
            line["part_id"] = rep["part_id"]
            line["run_id"] = rep["run_id"]
            proposed_ids[part_id] = rep["run_id"]
        elif rep["status"] == "known":
            line["status"] = "known"
            line["part_id"] = rep["part_id"]
        else:
            line["last_attempt"] = iso(now)
            line["note"] = ("all sources failed to fetch; left actionable "
                            "for a later drain")
        outcomes.append({"name": name, "result": rep["status"],
                         "part_id": rep.get("part_id")})
    save_requests(path, lines)
    return outcomes


# ---------------------------------------------------------------- CLI

def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="gather_part", description=__doc__)
    ap.add_argument("name", nargs="?",
                    help="free-text part name, e.g. \"AS5600 magnetic encoder\"")
    ap.add_argument("--url", action="append", default=[],
                    help="source page URL (repeatable; manufacturer first, "
                         "then distributor/datasheet)")
    ap.add_argument("--kind", action="append", default=[],
                    choices=["product", "datasheet"],
                    help="page kind per --url (default: .pdf = datasheet, "
                         "otherwise product)")
    ap.add_argument("--supplier", action="append", default=[],
                    help="supplier slug per --url (default: from the host)")
    ap.add_argument("--mpn", help="manufacturer part number, if known")
    ap.add_argument("--requested-by", default="cli",
                    help="who asked for this part (recorded on the draft "
                         "entry / queue line)")
    ap.add_argument("--from-requests", action="store_true",
                    help="drain tools/gather/requests.jsonl instead")
    ap.add_argument("--requests", type=Path, default=HERE / "requests.jsonl")
    ap.add_argument("--drafts", type=Path, default=HERE / "sources.drafts.json")
    ap.add_argument("--catalog", type=Path,
                    default=REPO_ROOT / "catalog" / "parts.json")
    ap.add_argument("--cache-dir", type=Path, default=HERE / "cache")
    ap.add_argument("--proposals-dir", type=Path, default=HERE / "proposals")
    args = ap.parse_args(argv)

    if (args.kind and len(args.kind) != len(args.url)) or \
            (args.supplier and len(args.supplier) != len(args.url)):
        print(json.dumps({"error": "--kind/--supplier must be given once "
                                   "per --url"}))
        return 2

    catalog = json.loads(args.catalog.read_text())

    if args.from_requests:
        fetcher = Fetcher(cache_dir=args.cache_dir)
        extractor = MetaModelExtractor()
        outcomes = drain_requests(args.requests, catalog=catalog,
                                  drafts_path=args.drafts, fetcher=fetcher,
                                  extractor=extractor,
                                  proposals_dir=args.proposals_dir)
        print(json.dumps({"drained": outcomes}, indent=1))
        return 0

    if not args.name:
        print(json.dumps({"error": "a part name is required (or use "
                                   "--from-requests)"}))
        return 2

    hit, also = lookup_part(args.name, catalog)
    if hit is not None:
        print(json.dumps({"status": "known", "part_id": hit["id"],
                          "name": hit.get("name"), "also_matched": also},
                         indent=1))
        return 0

    if not args.url:
        rep = queue_request(args.requests, args.name,
                            requested_by=args.requested_by)
        print(json.dumps({"status": rep["status"],
                          "queued": rep["queued"],
                          "already_queued": rep.get("already_queued", False),
                          "requests_file": str(args.requests)}, indent=1))
        return 0

    fetcher = Fetcher(cache_dir=args.cache_dir)
    extractor = MetaModelExtractor()
    rep = gather_unknown(args.name, args.url, catalog=catalog,
                         drafts_path=args.drafts, fetcher=fetcher,
                         extractor=extractor, proposals_dir=args.proposals_dir,
                         mpn=args.mpn, kinds=args.kind or None,
                         suppliers=args.supplier or None,
                         requested_by=args.requested_by)
    print(json.dumps(rep, indent=1))
    return 0 if rep["status"] == "proposed" else 2


if __name__ == "__main__":
    raise SystemExit(main())
