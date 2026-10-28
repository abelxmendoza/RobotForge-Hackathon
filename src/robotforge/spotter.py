"""Spotter: a photo of a real-world robot -> a provenance dossier.

Pipeline: photo intake (``photo.py``) names the robot and drafts an
ESTIMATED spec; identity lookup (``lookup.py``) finds its public
footprint; this module matches the identity against the Robodex,
guesses catalog parts for what the draft declares, validates the draft
with the engineering checks, and assembles one dossier in which EVERY
field carries its provenance:

- ``PHOTO-ESTIMATED`` — read off a photograph by the vision draft.
  A photo has no scale reference; nothing with this tag is measured.
- ``WEB-SOURCED`` — found on the public web (GitHub), with the URL.
- ``CATALOG`` — already recorded in RobotForge's own Robodex/catalog,
  with the entry it came from.
- ``UNKNOWN`` — not established by any stage. An honest blank.

Rules that keep the dossier honest:

- The draft spec is the photo draft, verbatim. When the robot is
  already catalogued, catalog values appear as a CROSS-CHECK column —
  they never overwrite the estimate (that would launder an estimate
  into a measurement by the back door).
- Parts guesses are guesses. A guess names a catalog part id only when
  the spec evidence scores it; otherwise it stays a free-text guess
  tagged PHOTO-ESTIMATED.
- Someone else's robot is credited to its makers: the dossier carries
  the catalog provenance note or the public repo it was found in.
- Every stage degrades in the open: a stage that did not run or failed
  is recorded in ``stages`` with its reason, never silently dropped.
"""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from .catalog import ROBOTS_DATA, Catalog, Robodex, RobotEntry
from .lookup import LookupError, LookupReport, lookup_robot, parse_identity
from .photo import PhotoDraft, draft_spec_from_photo
from .schema import RobotSpec, SpecError
from .validate import Finding, has_errors, validate

PHOTO_ESTIMATED = "PHOTO-ESTIMATED"
WEB_SOURCED = "WEB-SOURCED"
CATALOG = "CATALOG"
UNKNOWN = "UNKNOWN"
PROVENANCES = (PHOTO_ESTIMATED, WEB_SOURCED, CATALOG, UNKNOWN)

DOSSIER_SCHEMA = "robotforge-spotter/1"
HONESTY_NOTE = (
    "Every value in this dossier carries its provenance. PHOTO-ESTIMATED "
    "values were read off a photograph and are not measurements; "
    "WEB-SOURCED values come from the public pages named beside them; "
    "CATALOG values are RobotForge's own recorded data, shown as a "
    "cross-check and never merged into the photo draft.")


# ---------------------------------------------------------------------------
# provenance-carrying values
# ---------------------------------------------------------------------------

@dataclass
class ProvField:
    value: object
    provenance: str
    source: str = ""        # URL, catalog entry, or stage note

    def to_dict(self) -> dict:
        return {"value": self.value, "provenance": self.provenance,
                "source": self.source}


# ---------------------------------------------------------------------------
# catalog match
# ---------------------------------------------------------------------------

@dataclass
class CatalogMatch:
    verdict: str                       # SAME | VARIANT | NEW
    entry: RobotEntry | None = None    # best-matching entry, if any
    evidence: list[str] = field(default_factory=list)
    score: int = 0

    def to_dict(self) -> dict:
        return {
            "verdict": self.verdict,
            "robot": (self.entry.name if self.entry else None),
            "dex_id": (self.entry.dex_id if self.entry else None),
            "score": self.score,
            "evidence": self.evidence,
        }


def _tokens(text: str) -> list[str]:
    return re.findall(r"[a-z]+|\d+", text.lower())


def _ratio(a: float, b: float) -> float:
    return max(a, b) / min(a, b) if min(a, b) > 0 else float("inf")


def load_catalog_spec(entry: RobotEntry) -> RobotSpec | None:
    """The catalogued spec behind a Robodex entry, or None.

    ``spec_file`` is repo-root relative (e.g. ``examples/andino.json``);
    the root is two levels above catalog/robots.json."""
    if not entry.spec_file:
        return None
    path = Path(ROBOTS_DATA).resolve().parent.parent / entry.spec_file
    try:
        return RobotSpec.from_dict(json.loads(path.read_text()))
    except (OSError, ValueError):
        return None


def _name_relation(identity: str, entry_name: str) -> tuple[str, list[str]]:
    """How the spotted identity relates to a catalog name.

    Returns (relation, evidence) with relation one of
    exact | strong | family | none."""
    try:
        terms = parse_identity(identity)
        brand, number, compact = terms.brand, terms.number, terms.compact
        id_tokens = set(terms.tokens)
    except LookupError:
        toks = _tokens(identity)
        if not toks:
            return "none", []
        brand = next((t for t in toks if t.isalpha()), toks[0])
        number = next((t for t in toks if t.isdigit()), "")
        compact = "".join(toks)
        id_tokens = set(toks)
    e_tokens = _tokens(entry_name)
    e_set = set(e_tokens)
    e_brand = next((t for t in e_tokens if t.isalpha()),
                   e_tokens[0] if e_tokens else "")
    e_number = next((t for t in e_tokens if t.isdigit()), "")
    e_compact = "".join(e_tokens)
    ev: list[str] = []
    if compact and compact == e_compact:
        ev.append(f"name is an exact match for catalog entry "
                  f"'{entry_name}'")
        return "exact", ev
    if id_tokens == e_set:
        ev.append(f"name tokens match catalog entry '{entry_name}' "
                  f"exactly")
        return "exact", ev
    if brand == e_brand and number == e_number and number != "":
        ev.append(f"brand and model number match '{entry_name}' "
                  f"({brand} {number})")
        return "strong", ev
    if brand == e_brand and number == e_number and \
            (id_tokens <= e_set or e_set <= id_tokens):
        # A fuller/shorter name for the SAME model (extra tokens are
        # descriptors). Numbers must agree: an identity carrying a
        # model number the entry lacks is a different model, below.
        ev.append(f"name is a fuller/shorter form of catalog entry "
                  f"'{entry_name}' (brand '{brand}')")
        return "strong", ev
    if brand == e_brand:
        ev.append(f"same brand/family as catalog entry '{entry_name}' "
                  f"(brand '{brand}') but a different model or variant")
        return "family", ev
    return "none", ev


# Size fields a photo can actually speak to (proportions are visible).
# Mass is handled separately below: a photo carries no scale reference
# at all, so a mass miss is weak evidence — noted, never a veto.
_DIM_FIELDS = ("length_m", "width_m")


def match_catalog(identity: str, draft_spec: RobotSpec | None = None,
                  robodex: Robodex | None = None) -> CatalogMatch:
    """Verdict on whether the spotted robot is already in the Robodex.

    SAME — the identity names a catalog entry and the photo draft does
    not contradict it. VARIANT — same family (or a name match the draft
    contradicts): a relative of a catalog entry, not the entry itself.
    NEW — no catalog entry claims it.
    """
    dex = robodex or Robodex.load()
    best: CatalogMatch | None = None
    base_score = {"exact": 100, "strong": 80, "family": 40, "none": 0}
    for entry in dex.robots:
        relation, evidence = _name_relation(identity, entry.name)
        if relation == "none":
            continue
        score = base_score[relation]
        contradiction = False
        cat_spec = load_catalog_spec(entry) if draft_spec else None
        if draft_spec is not None and cat_spec is not None:
            if draft_spec.drivetrain == cat_spec.drivetrain:
                score += 10
                evidence.append(
                    f"drivetrain agrees with the catalog spec "
                    f"({draft_spec.drivetrain})")
            else:
                score -= 25
                contradiction = True
                evidence.append(
                    f"drivetrain CONTRADICTS the catalog spec: photo "
                    f"draft says {draft_spec.drivetrain}, catalog says "
                    f"{cat_spec.drivetrain}")
            for f in _DIM_FIELDS:
                d = getattr(draft_spec, f)
                c = getattr(cat_spec, f)
                r = _ratio(d, c)
                if r <= 1.5:
                    score += 5
                    evidence.append(
                        f"{f} consistent with catalog "
                        f"(photo {d:g} vs catalog {c:g})")
                elif r <= 2.5:
                    evidence.append(
                        f"{f} differs from catalog but within photo-"
                        f"estimate range (photo {d:g} vs catalog {c:g})")
                else:
                    score -= 15
                    contradiction = True
                    evidence.append(
                        f"{f} CONTRADICTS the catalog spec "
                        f"(photo {d:g} vs catalog {c:g}, {r:.1f}x apart "
                        f"— too far for a photo estimate of the same "
                        f"robot)")
            d_mass, c_mass = draft_spec.mass_kg, cat_spec.mass_kg
            r = _ratio(d_mass, c_mass)
            if r <= 1.5:
                score += 5
                evidence.append(
                    f"mass_kg consistent with catalog "
                    f"(photo {d_mass:g} vs catalog {c_mass:g})")
            elif r <= 2.5:
                evidence.append(
                    f"mass_kg differs from catalog (photo {d_mass:g} "
                    f"vs catalog {c_mass:g}) — within the wide error "
                    f"band of a photo mass estimate")
            else:
                score -= 5
                evidence.append(
                    f"mass_kg differs sharply from catalog "
                    f"(photo {d_mass:g} vs catalog {c_mass:g}, "
                    f"{r:.1f}x apart) — noted, but mass is the "
                    f"least photo-reliable field, so this alone does "
                    f"not veto a name match")
        elif draft_spec is not None:
            evidence.append("catalog entry has no loadable spec file; "
                            "match rests on the name alone")
        if relation in ("exact", "strong"):
            verdict = "VARIANT" if contradiction else "SAME"
        else:
            verdict = "VARIANT"
        cand = CatalogMatch(verdict=verdict, entry=entry,
                            evidence=evidence, score=score)
        if best is None or cand.score > best.score:
            best = cand
    if best is None:
        return CatalogMatch(
            verdict="NEW",
            evidence=[f"no Robodex entry name-matches '{identity}' "
                      f"({len(dex.robots)} entries checked)"])
    return best


# ---------------------------------------------------------------------------
# parts guesses
# ---------------------------------------------------------------------------

@dataclass
class PartGuess:
    label: str                    # what the robot needs ("drive motor x2")
    basis: str                    # the spec evidence behind the guess
    provenance: str               # CATALOG when a part id matched
    catalog_id: str | None = None
    catalog_name: str | None = None
    match_basis: str = ""         # why this catalog part scored
    free_text: str = ""           # the guess when no catalog part fits

    def to_dict(self) -> dict:
        return {"label": self.label, "basis": self.basis,
                "provenance": self.provenance,
                "catalog_id": self.catalog_id,
                "catalog_name": self.catalog_name,
                "match_basis": self.match_basis,
                "free_text": self.free_text}


def _first_number(value) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        m = re.search(r"\d+(?:\.\d+)?", value)
        if m:
            return float(m.group())
    return None


def _best_part(candidates, scorer) -> tuple[object | None, int, str]:
    best, best_score, best_why = None, 0, ""
    for part in candidates:
        score, why = scorer(part)
        if score > best_score:
            best, best_score, best_why = part, score, why
    return best, best_score, best_why


def guess_parts(spec: RobotSpec, visible_parts=(),
                catalog: Catalog | None = None) -> list[PartGuess]:
    """Guess catalog parts for what the draft spec declares.

    A catalog id is claimed only when the evidence scores >= 4 (e.g.
    chemistry + voltage for a battery, kind + diameter band for a
    wheel). Below that the guess stays free text — a wrong id is worse
    than an honest sentence."""
    cat = catalog or Catalog.load()
    parts = list(cat.parts.values())
    guesses: list[PartGuess] = []

    def add(label, basis, candidates, scorer, threshold=4):
        part, score, why = _best_part(candidates, scorer)
        if part is not None and score >= threshold:
            guesses.append(PartGuess(
                label=label, basis=basis, provenance=CATALOG,
                catalog_id=part.id, catalog_name=part.name,
                match_basis=f"score {score}: {why}"))
        else:
            guesses.append(PartGuess(
                label=label, basis=basis, provenance=PHOTO_ESTIMATED,
                free_text=f"no catalog part scored above threshold "
                          f"(best {score}); needs a human pick"))

    # Battery — chemistry + voltage + capacity.
    b = spec.battery
    def battery_score(part):
        if part.part_class != "power":
            return 0, ""
        s = part.specs
        score, why = 0, []
        chem = re.sub(r"[^a-z0-9]", "", str(s.get("chemistry",
                                                  "")).lower())
        want_chem = re.sub(r"[^a-z0-9]", "", b.chemistry.lower())
        if chem and chem == want_chem:
            score += 3
            why.append(f"chemistry {chem}")
        v = _first_number(s.get("voltage_v"))
        if v is not None:
            if abs(v - b.voltage_v) < 0.05:
                score += 3
                why.append(f"voltage {v:g} V matches")
            elif abs(v - b.voltage_v) <= 1.0:
                score += 1
                why.append(f"voltage {v:g} V near {b.voltage_v:g} V")
        cap = _first_number(s.get("capacity_mah"))
        if cap:
            r = _ratio(cap, b.capacity_mah)
            if r <= 2:
                score += 2
                why.append(f"capacity {cap:g} mAh in range")
            elif r <= 4:
                score += 1
                why.append(f"capacity {cap:g} mAh same order")
        return score, "; ".join(why)
    add(f"battery ({b.chemistry} {b.voltage_v:g} V, {b.capacity_mah} mAh)",
        "draft spec battery block", parts, battery_score)

    # Motors — kind token overlap (with alias expansion) + voltage.
    m = spec.motor
    def kind_tokens(text):
        toks = {t for t in re.findall(r"[a-z]+", str(text).lower())
                if len(t) >= 3 and t != "motor"}
        if "gearmotor" in toks or "geared" in toks:
            toks.add("gear")
        if "dynamixel" in toks:
            toks |= {"servo", "serial"}
        return toks
    want_tokens = kind_tokens(m.kind)
    def motor_score(part):
        if part.part_class != "actuators":
            return 0, ""
        kind = str(part.specs.get("kind", "")).lower()
        shared = kind_tokens(kind) & want_tokens
        score, why = 0, []
        if shared:
            score += 3
            why.append(f"kind tokens {sorted(shared)} shared by "
                       f"catalog {kind} and draft {m.kind}")
        v = _first_number(part.specs.get("voltage_v"))
        if v is not None and abs(v - m.voltage_v) <= 2.0:
            score += 1
            why.append(f"voltage {v:g} V near {m.voltage_v:g} V")
        return score, "; ".join(why)
    # A kind-family match alone (score 3) is a fair claim for a motor:
    # the basis string prints the score, so the strength is visible.
    add(f"motor x{m.count} ({m.kind}, {m.voltage_v:g} V)",
        "draft spec motor block", parts, motor_score, threshold=3)

    # Wheels — diameter band.
    if spec.wheel is not None:
        w = spec.wheel
        def wheel_score(part):
            if part.part_class != "wheels":
                return 0, ""
            d = _first_number(part.specs.get("diameter_m"))
            score, why = 0, []
            if d is not None:
                r = _ratio(d, w.diameter_m)
                if r <= 1.6:
                    score += 4
                    why.append(f"diameter {d:g} m vs draft "
                               f"{w.diameter_m:g} m")
                elif r <= 2.5:
                    score += 2
                    why.append(f"diameter {d:g} m same order as "
                               f"{w.diameter_m:g} m")
            if part.specs.get("kind") == "caster":
                score -= 5
                why.append("caster, not a drive wheel")
            return score, "; ".join(why)
        add(f"wheel x{w.count} ({w.diameter_m:g} m diameter)",
            "draft spec wheel block", parts, wheel_score)

    # Rotors — propellers for multirotors.
    if spec.rotors is not None:
        def prop_score(part):
            if part.part_class != "propulsion_air":
                return 0, ""
            return 4, "the catalog's propeller part class"
        add(f"propeller x{spec.rotors.count} "
            f"({spec.rotors.prop_diameter_m:g} m)",
            "draft spec rotors block", parts, prop_score)

    # Sensors — catalog sensor kinds reuse the schema vocabulary.
    for s in spec.sensors:
        def sensor_score(part, want=s.kind):
            if part.part_class != "cameras_sensors":
                return 0, ""
            kind = str(part.specs.get("kind", "")).lower()
            if kind == want:
                return 5, f"catalog kind {kind} matches"
            if want in ("rgb_camera", "depth_camera") and \
                    "camera" in kind:
                return 4, f"catalog kind {kind} is a camera"
            return 0, ""
        add(f"sensor: {s.kind} ({s.position})",
            "draft spec sensors list", parts, sensor_score)

    # Visible parts the spec did not already cover.
    covered = {g.label.split("(")[0].strip().lower() for g in guesses}
    kind_words = {"wheel": "wheel", "lidar": "lidar_2d",
                  "camera": "rgb_camera", "depth camera": "depth_camera",
                  "imu": "imu", "ultrasonic": "ultrasonic",
                  "arm": "arm", "gripper": "gripper",
                  "antenna": "antenna"}
    for vp in visible_parts:
        key = str(getattr(vp, "kind", "")).lower()
        if any(key in c or c in key for c in covered if c):
            continue
        schema_kind = next((v for k, v in kind_words.items()
                            if k in key), None)
        if schema_kind in ("lidar_2d", "rgb_camera", "depth_camera",
                           "imu", "ultrasonic"):
            def vis_score(part, want=schema_kind):
                if part.part_class != "cameras_sensors":
                    return 0, ""
                kind = str(part.specs.get("kind", "")).lower()
                return (5, f"catalog kind {kind} matches") \
                    if kind == want else (0, "")
            add(f"visible part: {vp.kind} x{getattr(vp, 'count', 1)}",
                "seen in the photo by the vision draft",
                parts, vis_score)
        else:
            guesses.append(PartGuess(
                label=f"visible part: {vp.kind} "
                      f"x{getattr(vp, 'count', 1)}",
                basis="seen in the photo by the vision draft",
                provenance=PHOTO_ESTIMATED,
                free_text="no catalog mapping attempted for this kind "
                          "in Spotter v1"))
    return guesses


# ---------------------------------------------------------------------------
# dossier
# ---------------------------------------------------------------------------

_SPEC_FIELDS = (
    "name", "drivetrain", "length_m", "width_m", "height_m", "mass_kg",
    "ground_clearance_m", "wheel.diameter_m", "wheel.width_m",
    "wheel.count", "motor.kind", "motor.voltage_v", "motor.count",
    "battery.chemistry", "battery.voltage_v", "battery.capacity_mah",
)


def _dotted(data: dict, path: str):
    cur = data
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur[part]
    return cur


@dataclass
class Dossier:
    identity: ProvField
    credit: ProvField
    catalog_match: CatalogMatch
    fields: list[dict]
    parts: list[PartGuess]
    sources: list[dict]
    draft_spec: dict | None
    validation: dict
    stages: list[dict]
    photo: dict
    generated_at: str

    def to_dict(self) -> dict:
        return {
            "schema": DOSSIER_SCHEMA,
            "generated_at": self.generated_at,
            "honesty_note": HONESTY_NOTE,
            "identity": self.identity.to_dict(),
            "credit": self.credit.to_dict(),
            "catalog_match": self.catalog_match.to_dict(),
            "photo": self.photo,
            "fields": self.fields,
            "parts": [p.to_dict() for p in self.parts],
            "sources": self.sources,
            "draft_spec": self.draft_spec,
            "validation": self.validation,
            "stages": self.stages,
        }


def _sources_from_lookup(report: LookupReport | None) -> list[dict]:
    if report is None:
        return []
    from .lookup import report_to_dict
    data = report_to_dict(report)
    level = {"official": "high", "community": "medium", "unknown": "low"}
    sources = []
    for repo in data["repos"]:
        sources.append({
            "kind": "github_repo",
            "name": repo["full_name"],
            "url": repo["url"],
            "claims": repo.get("why", []),
            "license": repo["license"],
            "provenance": WEB_SOURCED,
            "lookup_class": repo["provenance"],
            "confidence": {
                "level": level.get(repo["provenance"], "low"),
                "basis": "lookup ranking class (vendor-org / name / "
                         "stars heuristic — see lookup.py); a class is "
                         "not an endorsement",
            },
            "assets": repo.get("assets", []),
        })
    if data.get("best_candidate"):
        b = data["best_candidate"]
        sources.append({
            "kind": "twin_candidate",
            "name": f"{b['repo']} — {b['path']}",
            "url": f"https://github.com/{b['repo']}",
            "claims": [f"best pullable model candidate ({b['kind']}) "
                       f"by the lookup ranking heuristic"],
            "license": b["license"],
            "provenance": WEB_SOURCED,
            "lookup_class": "candidate",
            "confidence": {"level": "medium",
                           "basis": "single best candidate by file-kind "
                                    "and variant heuristics"},
            "assets": [{"path": b["path"], "kind": b["kind"]}],
        })
    return sources


def _credit(identity: str, match: CatalogMatch,
            report: LookupReport | None) -> ProvField:
    """Who made this robot — credited, never absorbed."""
    if match.entry is not None and match.verdict in ("SAME", "VARIANT"):
        note = match.entry.provenance.get("note", "")
        lic = match.entry.provenance.get("license", "")
        value = (f"An existing design by its original makers — the "
                 f"Robodex records {match.entry.name} with provenance: "
                 f"{note} (license: {lic})").strip()
        return ProvField(value=value, provenance=CATALOG,
                         source=f"Robodex entry {match.entry.dex_id} "
                                f"({match.entry.name}) provenance record")
    if report is not None and report.repos:
        top = report.repos[0]
        return ProvField(
            value=(f"Not identified against the Robodex. Its public "
                   f"footprint starts at {top.full_name} "
                   f"(owner {top.owner}); credit belongs to that "
                   f"project's authors, whoever they are."),
            provenance=WEB_SOURCED, source=top.html_url)
    return ProvField(
        value="Designer not identified by any stage.",
        provenance=UNKNOWN,
        source="no catalog match and no public source found")


def build_dossier(*, identity_guess: str,
                  draft_spec: RobotSpec | None = None,
                  photo_draft: PhotoDraft | None = None,
                  photo_path: str | Path | None = None,
                  lookup_report: LookupReport | None = None,
                  robodex: Robodex | None = None,
                  parts_catalog: Catalog | None = None,
                  stages: list[dict] | None = None) -> Dossier:
    """Assemble the dossier from stage outputs (pure; no network)."""
    dex = robodex or Robodex.load()
    spec = draft_spec
    visible = []
    if photo_draft is not None:
        spec = spec or photo_draft.spec
        visible = list(photo_draft.visible_parts)
    match = match_catalog(identity_guess, spec, robodex=dex)
    cat_spec = load_catalog_spec(match.entry) \
        if match.entry is not None else None

    fields: list[dict] = []
    if spec is not None:
        draft_data = spec.to_dict()
        cat_data = cat_spec.to_dict() if cat_spec is not None else {}
        for path in _SPEC_FIELDS:
            dv = _dotted(draft_data, path)
            if dv is None:
                continue
            row = {"field": path,
                   "draft": ProvField(
                       dv, PHOTO_ESTIMATED,
                       "photo vision draft — every dimension ESTIMATED, "
                       "no scale reference in a photo").to_dict()}
            if cat_spec is not None:
                cv = _dotted(cat_data, path)
                if cv is not None:
                    agreement = "n/a"
                    if isinstance(dv, (int, float)) and \
                            isinstance(cv, (int, float)):
                        r = _ratio(float(dv), float(cv))
                        agreement = ("consistent" if r <= 1.5 else
                                     "differs")
                    elif re.sub(r"[^a-z0-9]", "", str(dv).lower()) == \
                            re.sub(r"[^a-z0-9]", "", str(cv).lower()):
                        # "Li-ion" vs "liion" is a spelling difference,
                        # not a disagreement.
                        agreement = "consistent"
                    else:
                        agreement = "differs"
                    row["catalog"] = ProvField(
                        cv, CATALOG,
                        f"Robodex {match.entry.dex_id} "
                        f"{match.entry.name} spec "
                        f"({match.entry.spec_file})").to_dict()
                    row["agreement"] = agreement
            fields.append(row)
        sensors = [{"kind": s.kind, "position": s.position,
                    "range_m": s.range_m,
                    "provenance": PHOTO_ESTIMATED}
                   for s in spec.sensors]
        if sensors:
            fields.append({"field": "sensors",
                           "draft": ProvField(
                               sensors, PHOTO_ESTIMATED,
                               "photo vision draft").to_dict()})

    parts = guess_parts(spec, visible, catalog=parts_catalog) \
        if spec is not None else []

    if spec is not None:
        findings = validate(spec)
        validation = {
            "verdict": "FAIL" if has_errors(findings) else "PASS",
            "note": "validate() checks physical coherence of the "
                    "ESTIMATED draft; a PASS means the draft is "
                    "self-consistent, not that it matches the real "
                    "robot",
            "findings": [{"severity": f.severity, "check": f.check,
                          "message": f.message} for f in findings],
        }
    else:
        validation = {"verdict": "NOT RUN", "note": "no draft spec was "
                      "produced, so there is nothing to validate",
                      "findings": []}

    photo_info: dict = {"path": str(photo_path) if photo_path else None}
    if photo_path and Path(photo_path).is_file():
        photo_info["sha256"] = hashlib.sha256(
            Path(photo_path).read_bytes()).hexdigest()
    if photo_draft is not None:
        photo_info["identity_guess"] = photo_draft.identity_guess
        photo_info["visible_parts"] = [
            {"kind": p.kind, "count": p.count, "position": p.position,
             "notes": p.notes, "provenance": PHOTO_ESTIMATED}
            for p in photo_draft.visible_parts]

    if photo_draft is not None and \
            identity_guess == photo_draft.identity_guess:
        identity_field = ProvField(
            identity_guess, PHOTO_ESTIMATED,
            "photo vision identity guess — a guess, to be confirmed")
    elif photo_draft is not None:
        identity_field = ProvField(
            identity_guess, UNKNOWN,
            f"operator-provided identity; the photo model itself "
            f"guessed {photo_draft.identity_guess!r} and did not "
            f"confirm it — the catalog match below is the "
            f"corroboration, not the photo")
    else:
        identity_field = ProvField(
            identity_guess, UNKNOWN,
            "operator-provided identity (not photo-verified)")
    return Dossier(
        identity=identity_field,
        credit=_credit(identity_guess, match, lookup_report),
        catalog_match=match,
        fields=fields,
        parts=parts,
        sources=_sources_from_lookup(lookup_report),
        draft_spec=spec.to_dict() if spec is not None else None,
        validation=validation,
        stages=stages or [],
        photo=photo_info,
        generated_at=datetime.now(timezone.utc).isoformat(),
    )


# ---------------------------------------------------------------------------
# orchestration (the live pipeline; each stage degrades in the open)
# ---------------------------------------------------------------------------

def spot_robot(photo_path: str | Path | None = None,
               identity: str | None = None, *,
               do_lookup: bool = True,
               fetch_json=None) -> Dossier:
    """Run the full Spotter pipeline.

    Photo stage needs the Meta connector environment (photo.py raises
    SpecError outside it); lookup needs the public GitHub API. A stage
    failure is recorded in the dossier's ``stages`` and the pipeline
    continues with what it has — unless nothing at all can be known
    (no photo draft and no identity), which raises SpecError.
    """
    stages: list[dict] = []
    draft: PhotoDraft | None = None
    if photo_path is not None:
        try:
            draft = draft_spec_from_photo(photo_path)
            stages.append({"stage": "photo", "status": "ok",
                           "note": "vision draft produced; identity "
                                   "and every dimension are ESTIMATED"})
            guess = draft.identity_guess.strip()
            if not identity and guess and \
                    not guess.lower().startswith("unknown"):
                identity = guess
            elif not identity:
                stages.append(
                    {"stage": "identify", "status": "failed",
                     "note": f"photo model did not identify the robot "
                             f"(guessed {guess!r}); an operator "
                             f"identity is required to continue"})
        except Exception as exc:  # connector missing, API down, ...
            stages.append({"stage": "photo", "status": "failed",
                           "note": f"{type(exc).__name__}: {exc}"})
    else:
        stages.append({"stage": "photo", "status": "skipped",
                       "note": "no photo supplied"})
    if not identity:
        failed = next((s["note"] for s in stages
                       if s["stage"] == "identify"), "")
        raise SpecError("spotter needs a photo it can identify or an "
                        "operator-provided identity to start from. "
                        + failed)
    report: LookupReport | None = None
    if do_lookup:
        try:
            report = lookup_robot(identity, fetch_json=fetch_json)
            stages.append({"stage": "lookup", "status": "ok",
                           "note": f"{len(report.repos)} public repos "
                                   f"found on GitHub"})
        except LookupError as exc:
            stages.append({"stage": "lookup", "status": "failed",
                           "note": str(exc)})
    else:
        stages.append({"stage": "lookup", "status": "skipped",
                       "note": "--no-lookup"})
    dossier = build_dossier(identity_guess=identity, photo_draft=draft,
                            photo_path=photo_path, lookup_report=report,
                            stages=stages)
    dossier.stages = stages + [
        {"stage": "catalog_match", "status": "ok",
         "note": f"verdict {dossier.catalog_match.verdict}"},
        {"stage": "validate", "status": "ok",
         "note": f"draft validation: {dossier.validation['verdict']}"},
    ]
    return dossier


# ---------------------------------------------------------------------------
# card + saving
# ---------------------------------------------------------------------------

def format_card(dossier: Dossier) -> str:
    d = dossier.to_dict()
    m = d["catalog_match"]
    lines = [
        f"# Spotted robot dossier — {d['identity']['value']}",
        "",
        f"_Pipeline test data — generated {d['generated_at']} by "
        f"RobotForge Spotter ({DOSSIER_SCHEMA})._",
        "",
        f"**Identity (guess):** {d['identity']['value']} "
        f"[{d['identity']['provenance']}]",
        f"**Catalog match:** {m['verdict']}"
        + (f" — Robodex {m['dex_id']} {m['robot']}" if m["robot"]
           else ""),
        f"**Draft spec validation:** {d['validation']['verdict']}",
        f"**Credit:** {d['credit']['value']}",
        "",
        "## Match evidence",
    ]
    lines += [f"- {e}" for e in m["evidence"]] or ["- (none)"]
    lines += ["", "## Sources (web)"]
    if d["sources"]:
        for s in d["sources"]:
            lic = s["license"]
            lic_txt = (lic if isinstance(lic, str) else
                       lic.get("spdx") or lic.get("name") or "not stated")
            lines.append(f"- [{s['kind']}] {s['name']} — {s['url']} "
                         f"(license: {lic_txt}; confidence "
                         f"{s['confidence']['level']})")
    else:
        lines.append("- none found or lookup not run")
    lines += ["", "## Parts guesses"]
    if d["parts"]:
        for p in d["parts"]:
            if p["catalog_id"]:
                lines.append(f"- {p['label']} → catalog "
                             f"`{p['catalog_id']}` ({p['catalog_name']}) "
                             f"[{p['provenance']}; {p['match_basis']}]")
            else:
                lines.append(f"- {p['label']} → no catalog match "
                             f"[{p['provenance']}] {p['free_text']}")
    else:
        lines.append("- (no draft spec, so no parts to guess)")
    lines += ["", "## Validation findings"]
    for f in d["validation"]["findings"]:
        lines.append(f"- [{f['severity']}] {f['check']}: {f['message']}")
    if not d["validation"]["findings"]:
        lines.append("- (not run)")
    lines += ["", "## Stages"]
    for s in d["stages"]:
        lines.append(f"- {s['stage']}: {s['status']} — {s['note']}")
    lines += ["", f"_{HONESTY_NOTE}_", ""]
    return "\n".join(lines)


def save_dossier(dossier: Dossier, out_dir: str | Path) -> tuple[Path, Path]:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    jpath = out / "dossier.json"
    cpath = out / "card.md"
    jpath.write_text(json.dumps(dossier.to_dict(), indent=2) + "\n")
    cpath.write_text(format_card(dossier))
    return jpath, cpath
