"""Identity lookup: robot name -> public repos and a pullable twin model.

Given a free-text robot identity (typically the identity guess produced by
photo intake, e.g. "TurtleBot 3 Waffle Pi"), find the robot's public
open-source footprint on GitHub and, optionally, pull the single best
digital-twin candidate (URDF/xacro) plus that repo's LICENSE file.

Design constraints, all deliberate:

- **Public GitHub API only, stdlib urllib, no token.** The feature must work
  for any user, so it cannot depend on the Muse connector or a personal
  access token. Unauthenticated limits apply (10 search req/min, 60 core
  req/hr) and rate-limit responses are surfaced as clear LookupErrors.
- **Licenses are never optional decoration.** Every repo and every model
  asset is printed next to its repo's license; when the API reports no
  license the report says "license: not stated" rather than implying one.
- **Provenance is labeled, not asserted.** A repo is called "official" only
  when its owner is a known vendor org for the robot's brand (small
  built-in table) or the owner name itself carries the brand. Everything
  else is "community" or "unknown". Rankings are heuristics — the report
  says so in its own text.
- **No results is a valid answer.** If nothing public is found, the report
  says so ("no public model found — photo-estimate path applies") instead
  of dressing up an empty search as a failure.
"""
from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

API_BASE = "https://api.github.com"
RAW_BASE = "https://raw.githubusercontent.com"
USER_AGENT = "RobotForge/0.1 (identity lookup; no auth)"
TOP_REPOS = 5          # repos whose trees are walked for model assets
SEARCH_PER_PAGE = 10

# Brand root -> GitHub org logins that are the vendor's own. Deliberately
# tiny: a wrong "official" label is worse than a missed one. The generic
# fallback (owner name carries the brand) covers vendors not listed here.
KNOWN_VENDOR_ORGS = {
    "turtlebot": {"robotis-git"},
}

ASSET_EXTS = (".urdf", ".xacro", ".sdf", ".stl", ".dae", ".step", ".stp")
LICENSE_NAMES = ("LICENSE", "LICENSE.md", "LICENSE.txt", "LICENSE-MIT",
                 "COPYING", "COPYING.md")


class LookupError(ValueError):
    """Raised when a lookup cannot complete (network, rate limit, input)."""


# ---------------------------------------------------------------------------
# identity -> search terms
# ---------------------------------------------------------------------------

@dataclass
class IdentityTerms:
    raw: str
    tokens: list[str]            # ["turtlebot", "3", "waffle", "pi"]
    brand: str                   # first alpha token: "turtlebot"
    number: str                  # first numeric token after brand, or ""
    compact: str                 # "turtlebot3wafflepi"
    brand_compact: str           # "turtlebot3"
    variant_tokens: list[str]    # ["waffle", "pi"]
    variant_joined: str          # "waffle_pi"
    slug: str                    # "turtlebot-3-waffle-pi"
    queries: list[str]


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


def parse_identity(identity: str) -> IdentityTerms:
    tokens = re.findall(r"[a-z]+|\d+", identity.lower())
    if not tokens:
        raise LookupError(
            f"could not parse a robot name from {identity!r}; "
            "give a name like 'TurtleBot 3 Waffle Pi'")
    brand = next((t for t in tokens if t.isalpha()), tokens[0])
    rest = tokens[tokens.index(brand) + 1:]
    number = next((t for t in rest if t.isdigit()), "")
    variant = [t for t in rest if t != number]
    brand_compact = brand + number
    compact = "".join(tokens)
    queries = [
        f"{brand_compact} in:name,description",
        f"{brand_compact} ros2 in:name,description",
        f"{brand} {number} in:name,description".replace("  ", " ").strip(),
        f"{compact} in:name,description",
    ]
    # dedupe, keep order (a bare-brand query differs from brand_compact only
    # when a number exists; without one several variants collapse)
    seen: set[str] = set()
    uniq = [q for q in queries if not (q in seen or seen.add(q))]
    return IdentityTerms(
        raw=identity, tokens=tokens, brand=brand, number=number,
        compact=compact, brand_compact=brand_compact,
        variant_tokens=variant, variant_joined="_".join(variant),
        slug="-".join(tokens), queries=uniq)


# ---------------------------------------------------------------------------
# GitHub transport (injectable for tests)
# ---------------------------------------------------------------------------

def _github_get(url: str) -> dict:
    req = urllib.request.Request(url, headers={
        "Accept": "application/vnd.github+json",
        "User-Agent": USER_AGENT,
        "X-GitHub-Api-Version": "2022-11-28",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        if exc.code in (403, 429):
            reset = exc.headers.get("X-RateLimit-Reset") if exc.headers \
                else None
            when = ""
            if reset:
                try:
                    when = " (resets " + datetime.fromtimestamp(
                        int(reset), tz=timezone.utc).strftime(
                            "%H:%M UTC") + ")"
                except (ValueError, OSError):
                    when = ""
            raise LookupError(
                "GitHub API rate limit exceeded for unauthenticated "
                f"requests{when}; wait and retry") from exc
        raise LookupError(
            f"GitHub API returned HTTP {exc.code} for {url}") from exc
    except urllib.error.URLError as exc:
        raise LookupError(f"could not reach the GitHub API: {exc}") from exc


def _download(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.read()
    except (urllib.error.HTTPError, urllib.error.URLError) as exc:
        raise LookupError(f"download failed for {url}: {exc}") from exc


# ---------------------------------------------------------------------------
# results
# ---------------------------------------------------------------------------

@dataclass
class ModelAsset:
    path: str
    kind: str                    # urdf | urdf_xacro | xacro | sdf | mesh | cad
    size: int | None
    blob_sha: str | None = None


@dataclass
class RepoHit:
    full_name: str
    html_url: str
    owner: str
    description: str
    stars: int
    license_spdx: str | None
    license_name: str | None
    default_branch: str
    provenance: str = "unknown"  # official | community | unknown
    why: list[str] = field(default_factory=list)
    assets: list[ModelAsset] = field(default_factory=list)
    tree_truncated: bool = False
    tree_paths: set[str] = field(default_factory=set, repr=False)
    tree_shas: dict[str, str] = field(default_factory=dict, repr=False)

    @property
    def license_label(self) -> str:
        return self.license_spdx or self.license_name or "not stated"


@dataclass
class TwinCandidate:
    repo: RepoHit
    asset: ModelAsset


@dataclass
class LookupReport:
    terms: IdentityTerms
    repos: list[RepoHit] = field(default_factory=list)
    best: TwinCandidate | None = None


# ---------------------------------------------------------------------------
# ranking
# ---------------------------------------------------------------------------

def _provenance(repo: RepoHit, terms: IdentityTerms) -> str:
    owner_norm = _norm(repo.owner)
    if owner_norm in {_norm(o) for o in
                      KNOWN_VENDOR_ORGS.get(terms.brand, set())}:
        return "official"
    if owner_norm.startswith(_norm(terms.brand)):
        return "official"
    return "community"


def _name_match(repo: RepoHit, terms: IdentityTerms) -> int:
    name = _norm(repo.full_name.split("/")[-1])
    if terms.brand_compact and terms.brand_compact in name:
        return 3
    if _norm(terms.brand) in name:
        return 2
    desc = (repo.description or "").lower()
    if terms.brand_compact and terms.brand_compact in _norm(desc):
        return 1
    return 0


def _rank_key(repo: RepoHit, terms: IdentityTerms) -> tuple:
    prov = {"official": 2, "community": 1, "unknown": 0}[repo.provenance]
    return (prov, _name_match(repo, terms), repo.stars, repo.full_name)


def _why(repo: RepoHit, terms: IdentityTerms) -> list[str]:
    reasons = []
    owner_norm = _norm(repo.owner)
    if owner_norm in {_norm(o) for o in
                      KNOWN_VENDOR_ORGS.get(terms.brand, set())}:
        reasons.append(
            f"owner {repo.owner} is a known vendor org for "
            f"'{terms.brand}'")
    elif owner_norm.startswith(_norm(terms.brand)):
        reasons.append(f"owner name carries the '{terms.brand}' brand")
    match = _name_match(repo, terms)
    if match >= 3:
        reasons.append(f"repo name matches '{terms.brand_compact}'")
    elif match == 2:
        reasons.append(f"repo name mentions '{terms.brand}'")
    elif match == 1:
        reasons.append("description matches the robot name")
    if repo.stars:
        reasons.append(f"{repo.stars} stars (community signal)")
    return reasons or ["returned by GitHub search for the robot name"]


# ---------------------------------------------------------------------------
# assets
# ---------------------------------------------------------------------------

def _asset_kind(path: str) -> str | None:
    p = path.lower()
    if p.endswith(".urdf.xacro"):
        return "urdf_xacro"
    if p.endswith(".xacro"):
        return "xacro"
    if p.endswith(".urdf"):
        return "urdf"
    if p.endswith(".sdf"):
        return "sdf"
    if p.endswith((".stl", ".dae")):
        return "mesh"
    if p.endswith((".step", ".stp")):
        return "cad"
    return None


def _candidate_key(cand: TwinCandidate, terms: IdentityTerms) -> tuple:
    asset = cand.asset
    fname = asset.path.rsplit("/", 1)[-1].lower()
    if terms.variant_joined and terms.variant_joined in fname:
        variant_rank = 0
    elif terms.variant_tokens and all(
            t in fname for t in terms.variant_tokens):
        variant_rank = 1
    elif terms.brand_compact in _norm(fname):
        variant_rank = 2
    else:
        variant_rank = 3
    kind_rank = {"urdf": 0, "urdf_xacro": 1, "xacro": 2, "sdf": 3}[asset.kind]
    prov_rank = {"official": 0, "community": 1, "unknown": 2}[
        cand.repo.provenance]
    desc_bonus = 0 if "description" in asset.path.lower() else 1
    return (prov_rank, variant_rank, kind_rank, desc_bonus, asset.path)


# ---------------------------------------------------------------------------
# search
# ---------------------------------------------------------------------------

def lookup_robot(identity: str, *, fetch_json=None) -> LookupReport:
    """Search public GitHub for the robot's repos and model assets."""
    fetch = fetch_json or _github_get
    terms = parse_identity(identity)
    merged: dict[str, RepoHit] = {}
    for query in terms.queries:
        url = (f"{API_BASE}/search/repositories?"
               + urllib.parse.urlencode(
                   {"q": query, "per_page": SEARCH_PER_PAGE}))
        payload = fetch(url)
        for item in payload.get("items", []):
            key = (item.get("full_name") or "").lower()
            if not key or key in merged:
                continue
            lic = item.get("license") or {}
            merged[key] = RepoHit(
                full_name=item["full_name"],
                html_url=item.get("html_url", ""),
                owner=(item.get("owner") or {}).get("login", ""),
                description=item.get("description") or "",
                stars=item.get("stargazers_count", 0),
                license_spdx=lic.get("spdx_id"),
                license_name=lic.get("name"),
                default_branch=item.get("default_branch") or "main",
            )
    repos = list(merged.values())
    for repo in repos:
        repo.provenance = _provenance(repo, terms)
        repo.why = _why(repo, terms)
    repos.sort(key=lambda r: _rank_key(r, terms), reverse=True)

    # Walk the trees of the top repos for model assets.
    for repo in repos[:TOP_REPOS]:
        tree_url = (f"{API_BASE}/repos/{repo.full_name}/git/trees/"
                    f"{urllib.parse.quote(repo.default_branch)}?recursive=1")
        tree = fetch(tree_url)
        repo.tree_truncated = bool(tree.get("truncated"))
        for entry in tree.get("tree", []):
            if entry.get("type") != "blob":
                continue
            path = entry.get("path", "")
            repo.tree_paths.add(path)
            if entry.get("sha"):
                repo.tree_shas[path] = entry["sha"]
            kind = _asset_kind(path)
            if kind:
                repo.assets.append(ModelAsset(
                    path=path, kind=kind, size=entry.get("size"),
                    blob_sha=entry.get("sha")))
        repo.assets.sort(key=lambda a: a.path)

    report = LookupReport(terms=terms, repos=repos)
    candidates = [TwinCandidate(repo=r, asset=a)
                  for r in repos[:TOP_REPOS] for a in r.assets
                  if a.kind in ("urdf", "urdf_xacro", "xacro", "sdf")]
    if candidates:
        report.best = min(candidates,
                          key=lambda c: _candidate_key(c, terms))
    return report


# ---------------------------------------------------------------------------
# pull
# ---------------------------------------------------------------------------

@dataclass
class PulledFile:
    repo_path: str
    url: str
    size: int
    blob_sha: str | None


@dataclass
class PullResult:
    dest: Path
    files: list[PulledFile]
    manifest: dict


_FILE_REF_RE = re.compile(r'filename\s*=\s*"([^"]+)"')


def _referenced_siblings(model_text: str, asset_path: str,
                         tree_paths: set[str]) -> tuple[list[str], list[str]]:
    """Same-directory files the model references by relative filename.

    Conservative by design: only references that resolve inside the model
    file's own directory are pulled. Anything else (package:// URIs,
    $(find ...) substitutions, ../ or sub-directory paths) is reported as
    an unresolved reference instead of being chased.
    """
    model_dir = asset_path.rsplit("/", 1)[0] if "/" in asset_path else ""
    pull: list[str] = []
    unresolved: list[str] = []
    for ref in sorted(set(_FILE_REF_RE.findall(model_text))):
        if ref.startswith(("$", "package://", "model://", "http://",
                           "https://", "/")):
            unresolved.append(ref)
            continue
        if "/" in ref:
            if ref.startswith("./"):
                target = f"{model_dir}/{ref[2:]}" if model_dir else ref[2:]
            else:
                # sub-directory or ../ reference: outside the conservative
                # same-directory rule, so it is reported, not chased
                unresolved.append(ref)
                continue
        else:
            target = f"{model_dir}/{ref}" if model_dir else ref
        if target in tree_paths:
            pull.append(target)
        else:
            unresolved.append(ref)
    return pull, unresolved


def pull_candidate(report: LookupReport, out_root: Path, *,
                   fetch_bytes=None) -> PullResult:
    """Download the best twin candidate (+ LICENSE + same-dir references)."""
    if report.best is None:
        raise LookupError("no twin candidate to pull")
    fetch = fetch_bytes or _download
    repo, asset = report.best.repo, report.best.asset
    branch = urllib.parse.quote(repo.default_branch)
    dest = Path(out_root) / report.terms.slug
    dest.mkdir(parents=True, exist_ok=True)

    def raw_url(repo_path: str) -> str:
        return f"{RAW_BASE}/{repo.full_name}/{branch}/{repo_path}"

    wanted: list[tuple[str, str | None]] = [(asset.path, asset.blob_sha)]
    # LICENSE at the repo root, if the tree shows one.
    for name in LICENSE_NAMES:
        if name in repo.tree_paths:
            wanted.append((name, repo.tree_shas.get(name)))
            break
    # Same-directory references of the model file itself.
    model_bytes = fetch(raw_url(asset.path))
    unresolved: list[str] = []
    try:
        siblings, unresolved = _referenced_siblings(
            model_bytes.decode("utf-8", errors="replace"),
            asset.path, repo.tree_paths)
    except Exception:
        siblings = []
    for sib in siblings:
        if sib not in {p for p, _ in wanted}:
            wanted.append((sib, repo.tree_shas.get(sib)))

    files: list[PulledFile] = []
    cache: dict[str, bytes] = {asset.path: model_bytes}
    for repo_path, blob_sha in wanted:
        data = cache.get(repo_path)
        if data is None:
            data = fetch(raw_url(repo_path))
        local = dest / repo_path
        local.parent.mkdir(parents=True, exist_ok=True)
        local.write_bytes(data)
        files.append(PulledFile(repo_path=repo_path, url=raw_url(repo_path),
                                size=len(data), blob_sha=blob_sha))
    manifest = {
        "identity": report.terms.raw,
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
        "repo": repo.full_name,
        "repo_url": repo.html_url,
        "license_spdx": repo.license_spdx,
        "license_name": repo.license_name,
        "license_label": repo.license_label,
        "provenance": repo.provenance,
        "candidate": {"path": asset.path, "kind": asset.kind,
                      "source_url": raw_url(asset.path)},
        "files": [{"path": f.repo_path, "url": f.url, "bytes": f.size,
                   "git_blob_sha": f.blob_sha} for f in files],
        "unresolved_references": unresolved,
        "note": "Rankings and the best-candidate choice are heuristics. "
                "Files are the property of their repo under the license "
                "above; RobotForge pulled them for local evaluation only.",
    }
    (dest / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return PullResult(dest=dest, files=files, manifest=manifest)


# ---------------------------------------------------------------------------
# reporting
# ---------------------------------------------------------------------------

def report_to_dict(report: LookupReport) -> dict:
    terms = report.terms
    return {
        "identity": terms.raw,
        "queries": terms.queries,
        "heuristic_note": "Rankings are heuristics (vendor-org match, name "
                          "match, stars), not endorsements.",
        "repos": [{
            "full_name": r.full_name,
            "url": r.html_url,
            "owner": r.owner,
            "stars": r.stars,
            "license": ({"spdx": r.license_spdx, "name": r.license_name}
                        if r.license_spdx or r.license_name
                        else "not stated"),
            "provenance": r.provenance,
            "why": r.why,
            "tree_truncated": r.tree_truncated,
            "assets": [{"path": a.path, "kind": a.kind, "size": a.size}
                       for a in r.assets],
        } for r in report.repos],
        "best_candidate": (
            {"repo": report.best.repo.full_name,
             "path": report.best.asset.path,
             "kind": report.best.asset.kind,
             "license": report.best.repo.license_label}
            if report.best else None),
    }


def format_report(report: LookupReport) -> str:
    terms = report.terms
    lines = [f"Lookup: {terms.raw}",
             "Rankings are heuristics (vendor-org match, name match, "
             "stars), not endorsements.",
             ""]
    if not report.repos:
        lines.append("No public repositories found for this robot.")
        lines.append("No public model found — the photo-estimate path "
                     "applies (draft a spec from the photo and confirm it).")
        return "\n".join(lines)
    lines.append(f"Repositories (ranked, top {len(report.repos)} shown; "
                 f"model assets walked in top {TOP_REPOS}):")
    for i, repo in enumerate(report.repos, 1):
        lines.append(
            f"{i}. {repo.full_name} [{repo.provenance}] "
            f"stars: {repo.stars}  license: {repo.license_label}")
        lines.append(f"   {repo.html_url}")
        lines.append(f"   why: {'; '.join(repo.why)}")
        if repo.assets:
            lines.append("   model assets:")
            for a in repo.assets:
                lines.append(
                    f"     - {a.path} ({a.kind}) "
                    f"[license: {repo.license_label}]")
        if repo.tree_truncated:
            lines.append("   note: GitHub truncated this repo's tree "
                         "listing; the asset list may be incomplete")
    lines.append("")
    if report.best:
        b = report.best
        lines.append(
            f"Best twin candidate: {b.repo.full_name} — {b.asset.path} "
            f"({b.asset.kind}) [license: {b.repo.license_label}]")
    else:
        lines.append(
            f"No URDF/xacro/SDF model found in the top {TOP_REPOS} repos — "
            "the photo-estimate path applies (draft a spec from the photo "
            "and confirm it).")
    return "\n".join(lines)


def format_pull(result: PullResult) -> str:
    m = result.manifest
    lines = [f"Pulled to {result.dest} from {m['repo']} "
             f"(license: {m['license_label']}):"]
    for f in result.files:
        lines.append(f"  - {f.repo_path} ({f.size} bytes) <- {f.url}")
    lines.append("  - manifest.json (source URLs, license, retrieval date)")
    if m["unresolved_references"]:
        lines.append("Unresolved references in the model file (not pulled; "
                     "resolve the owning package to use them):")
        for ref in m["unresolved_references"]:
            lines.append(f"  ! {ref}")
    return "\n".join(lines)
