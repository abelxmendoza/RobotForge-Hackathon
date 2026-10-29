"""Robodex grouping: Spotter dossiers -> families, variants, sightings.

Spotter (``spotter.py``) produces one dossier per spotting — a photo, an
identity guess, a PHOTO-ESTIMATED draft spec, and a catalog match. This
module is the layer that FILES those dossiers into the Robodex proper:
a robot product line is a **Family** (e.g. Boston Dynamics Spot), each
distinct hardware configuration seen within it is a **Variant** (Spot
with its arm; Spot without; Spot with arm + a Hokuyo top lidar), and
every individual spotting filed under a variant is a **Sighting**.

Honesty rules (the same posture as Spotter's, applied to grouping):

- A signature field read as ``"unknown"`` is a VALUE, never a wildcard.
  Two signatures are equal only when every field matches exactly,
  ``"unknown" == "unknown"`` included.
- A manipulator is ``"absent"`` only on positive inventory evidence:
  the photo draft listed visible parts including a body/chassis anchor
  and no arm appeared. A photo draft that lists parts but no arm reads
  as absent in v1 — that is the honest read of a complete-looking
  inventory, and the rule is stated here rather than hidden. With no
  inventory at all, the field stays ``"unknown"``.
- A name match the draft CONTRADICTS (different drivetrain, or a
  length/width more than 2.5x off the family's recorded draft — the
  ratio approach Spotter uses against catalog specs) is never silently
  attached. It is demoted to PROPOSE_FAMILY: a human confirms or
  rejects it, and applying a proposal mutates nothing.
- A shared brand alone ("family" name relation) is likewise only a
  proposal. Same brand, different model is how product lines grow —
  and how a DIY namesake would otherwise get merged by accident.
- Sightings are NEVER deduplicated or collapsed. Two spottings of the
  same variant are two sightings, even of the same robot: the dex
  records encounters, not a census of unique units.

Persistence design: ``families_to_dict`` produces plain JSON tagged
``robotforge-robodex-families/1`` — families[] each {id, name, aliases,
catalog_dex_id, credit, variants[] each {label, signature{manipulator,
top_lidar, drivetrain, payloads}, sightings[] each {id, identity,
photo, sha256, spotted_at, where, by, dossier}}}. That JSON is the
exact shape a future Cloudflare Worker would store server-side; v1
ships it as static data (``catalog/families.json``, generated from the
example dossiers) plus browser-local sightings in the web app.

Zero new dependencies; Python stdlib only.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

from .lookup import parse_identity  # re-exported for callers/tests
from .spotter import _name_relation, _ratio

FAMILIES_SCHEMA = "robotforge-robodex-families/1"

# Grouping outcomes (plain strings, in Spotter's style).
ATTACH_VARIANT = "ATTACH_VARIANT"
NEW_VARIANT = "NEW_VARIANT"
NEW_FAMILY = "NEW_FAMILY"
PROPOSE_FAMILY = "PROPOSE_FAMILY"
OUTCOMES = (ATTACH_VARIANT, NEW_VARIANT, NEW_FAMILY, PROPOSE_FAMILY)

__all__ = [
    "FAMILIES_SCHEMA", "ATTACH_VARIANT", "NEW_VARIANT", "NEW_FAMILY",
    "PROPOSE_FAMILY", "OUTCOMES", "ConfigSignature",
    "signature_from_dossier", "Sighting", "Variant", "Family",
    "variant_label", "slugify", "sighting_from_dossier",
    "GroupingDecision", "classify_spotting", "apply_decision",
    "families_to_dict", "families_from_dict", "build_example_families",
    "parse_identity",
]


# ---------------------------------------------------------------------------
# dossier accessors (a dossier is a plain dict, robotforge-spotter/1)
# ---------------------------------------------------------------------------

def _identity_of(dossier: dict) -> str:
    ident = dossier.get("identity") or {}
    if isinstance(ident, dict):
        return str(ident.get("value") or "")
    return str(ident or "")


def _visible_parts(dossier: dict) -> list[dict]:
    photo = dossier.get("photo") or {}
    parts = photo.get("visible_parts") if isinstance(photo, dict) else None
    return [p for p in parts or [] if isinstance(p, dict)]


def _draft_spec(dossier: dict) -> dict:
    spec = dossier.get("draft_spec")
    return spec if isinstance(spec, dict) else {}


def _draft_sensors(dossier: dict) -> list[dict]:
    """Draft sensors: draft_spec.sensors, falling back to the fields[]
    sensors row (dossiers carry the same list in both places)."""
    sensors = _draft_spec(dossier).get("sensors")
    if isinstance(sensors, list) and sensors:
        return [s for s in sensors if isinstance(s, dict)]
    for row in dossier.get("fields") or []:
        if isinstance(row, dict) and row.get("field") == "sensors":
            draft = row.get("draft") or {}
            value = draft.get("value") if isinstance(draft, dict) else None
            if isinstance(value, list):
                return [s for s in value if isinstance(s, dict)]
    return []


def _draft_value(dossier: dict, field_name: str):
    spec = _draft_spec(dossier)
    if spec.get(field_name) is not None:
        return spec.get(field_name)
    for row in dossier.get("fields") or []:
        if isinstance(row, dict) and row.get("field") == field_name:
            draft = row.get("draft") or {}
            if isinstance(draft, dict):
                return draft.get("value")
    return None


def _norm_token(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(text).lower()).strip("_")


# ---------------------------------------------------------------------------
# configuration signature
# ---------------------------------------------------------------------------

# Notable mounted extras, as an explicit (kind substring -> token) map.
# Kinds naming base anatomy or another signature field are excluded
# BEFORE this map is consulted (see _PAYLOAD_EXCLUDED): wheels, legs,
# chassis/body, casters, switches, arms and lidars are the robot or are
# already carried by manipulator / top_lidar. The map stays small on
# purpose — an unmapped extra is simply not a payload token in v1.
_PAYLOAD_MAP = (
    ("ultrasonic", "ultrasonic_sensor"),
    ("depth camera", "depth_camera"),
    ("camera", "camera"),
    ("antenna", "antenna"),
    ("gps", "gps"),
    ("speaker", "speaker"),
    ("microphone", "microphone"),
    ("screen", "display"),
    ("display", "display"),
    ("basket", "cargo_basket"),
    ("cargo", "cargo_box"),
    ("beacon", "beacon"),
)
_PAYLOAD_EXCLUDED = ("body", "chassis", "leg", "wheel", "caster",
                     "switch", "arm", "manipulator", "gripper", "lidar")

# Brand tokens that name a top-lidar model when they appear in a lidar
# visible part's kind/notes. (kind substring set -> normalized model)
_LIDAR_BRAND_MODELS = (
    (("hokuyo",), "hokuyo_urg"),
    (("urg",), "hokuyo_urg"),
    (("rplidar",), "rplidar_a1"),
    (("velodyne",), "velodyne_lidar"),
)


@dataclass(frozen=True)
class ConfigSignature:
    """The configuration axes a variant is keyed on. Exact equality."""
    manipulator: str                 # present | absent | unknown
    top_lidar: str                   # none | unknown | model string
    drivetrain: str = ""             # "" if unknown
    payloads: tuple = ()             # sorted normalized extra tokens

    def __post_init__(self):
        if self.manipulator not in ("present", "absent", "unknown"):
            raise ValueError(f"manipulator {self.manipulator!r} not in "
                             "('present', 'absent', 'unknown')")
        object.__setattr__(self, "payloads",
                           tuple(sorted(str(p) for p in self.payloads)))

    def to_dict(self) -> dict:
        return {"manipulator": self.manipulator,
                "top_lidar": self.top_lidar,
                "drivetrain": self.drivetrain,
                "payloads": list(self.payloads)}

    @classmethod
    def from_dict(cls, d: dict) -> "ConfigSignature":
        return cls(manipulator=str(d.get("manipulator", "unknown")),
                   top_lidar=str(d.get("top_lidar", "unknown")),
                   drivetrain=str(d.get("drivetrain", "") or ""),
                   payloads=tuple(d.get("payloads", ()) or ()))


def signature_from_dossier(dossier: dict) -> ConfigSignature:
    """Extract a ConfigSignature from a Spotter dossier dict. Pure."""
    visible = _visible_parts(dossier)
    sensors = _draft_sensors(dossier)

    # -- manipulator ---------------------------------------------------
    arm_in_photo = any(
        "arm" in str(p.get("kind", "")).lower()
        or "manipulator" in str(p.get("kind", "")).lower()
        for p in visible)
    arm_sensor = any(
        "arm" in str(s.get("position", "")).lower()
        or "gripper" in str(s.get("position", "")).lower()
        for s in sensors)
    if arm_in_photo or arm_sensor:
        manipulator = "present"
    elif visible and any(
            "body" in str(p.get("kind", "")).lower()
            or "chassis" in str(p.get("kind", "")).lower()
            for p in visible):
        # Non-empty inventory anchored on a body/chassis, no arm in it:
        # absent (the v1 rule documented in the module docstring).
        manipulator = "absent"
    else:
        manipulator = "unknown"

    # -- top lidar ------------------------------------------------------
    top_lidar_sensor = any(
        _norm_token(s.get("kind", "")) == "lidar_2d"
        and "top" in str(s.get("position", "")).lower()
        for s in sensors)
    lidar_visible_top = [
        p for p in visible
        if "lidar" in str(p.get("kind", "")).lower()
        and "top" in str(p.get("position", "")).lower()]
    if top_lidar_sensor or lidar_visible_top:
        top_lidar = _top_lidar_model(dossier, lidar_visible_top)
    elif sensors or visible:
        top_lidar = "none"       # inventoried, and no top lidar in it
    else:
        top_lidar = "unknown"    # no inventory at all

    # -- drivetrain ------------------------------------------------------
    drivetrain = str(_draft_value(dossier, "drivetrain") or "")

    # -- payloads ---------------------------------------------------------
    payloads: set[str] = set()
    for p in visible:
        kind = str(p.get("kind", "")).lower()
        if any(x in kind for x in _PAYLOAD_EXCLUDED):
            continue
        for needle, token in _PAYLOAD_MAP:
            if needle in kind:
                payloads.add(token)
                break

    return ConfigSignature(manipulator=manipulator, top_lidar=top_lidar,
                           drivetrain=drivetrain,
                           payloads=tuple(sorted(payloads)))


def _top_lidar_model(dossier: dict, lidar_visible_top: list) -> str:
    """Name the top lidar, most specific evidence first."""
    # 1. A parts[] guess whose label mentions lidar and resolved a
    #    catalog part id (e.g. Andino's lidar -> rplidar_a1).
    for guess in dossier.get("parts") or []:
        if not isinstance(guess, dict):
            continue
        if "lidar" in str(guess.get("label", "")).lower() \
                and guess.get("catalog_id"):
            return _norm_token(guess["catalog_id"])
    # 2. A brand token in the lidar part's own kind/notes.
    for p in lidar_visible_top:
        text = (str(p.get("kind", "")) + " " +
                str(p.get("notes", ""))).lower()
        for needles, model in _LIDAR_BRAND_MODELS:
            if all(n in text for n in needles):
                return model
    # 3. Only the kind is known.
    return "lidar_2d"


def _sig_text(sig: ConfigSignature) -> str:
    return (f"manipulator {sig.manipulator}, top lidar {sig.top_lidar}, "
            f"drivetrain {sig.drivetrain or '(unknown)'}, payloads "
            f"{', '.join(sig.payloads) if sig.payloads else '(none)'}")


# ---------------------------------------------------------------------------
# model: families, variants, sightings
# ---------------------------------------------------------------------------

def slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", str(name).lower()).strip("-")
    return slug or "unknown-robot"


@dataclass
class Sighting:
    """One spotting filed under a variant. Never deduplicated."""
    id: str
    identity: str                        # the dossier's identity value
    photo: str | None = None             # photo path, when present
    sha256: str | None = None            # photo sha256, when present
    spotted_at: str | None = None        # optional context
    where: str | None = None             # optional context
    by: str | None = None                # optional context
    dossier: dict | None = None          # the full dossier dict

    def to_dict(self) -> dict:
        return {"id": self.id, "identity": self.identity,
                "photo": self.photo, "sha256": self.sha256,
                "spotted_at": self.spotted_at, "where": self.where,
                "by": self.by, "dossier": self.dossier}

    @classmethod
    def from_dict(cls, d: dict) -> "Sighting":
        return cls(id=str(d.get("id", "")), identity=str(d.get("identity", "")),
                   photo=d.get("photo"), sha256=d.get("sha256"),
                   spotted_at=d.get("spotted_at"), where=d.get("where"),
                   by=d.get("by"), dossier=d.get("dossier"))


def sighting_from_dossier(dossier: dict, *, sighting_id: str | None = None,
                          spotted_at: str | None = None,
                          where: str | None = None,
                          by: str | None = None) -> Sighting:
    """Wrap a dossier dict as a Sighting (photo + hash carried over)."""
    photo = dossier.get("photo") or {}
    if not isinstance(photo, dict):
        photo = {}
    identity = _identity_of(dossier)
    if sighting_id is None:
        stem = photo.get("sha256") or "sighting"
        sighting_id = f"{slugify(identity)}-{str(stem)[:8]}"
    return Sighting(id=sighting_id, identity=identity,
                    photo=photo.get("path"), sha256=photo.get("sha256"),
                    spotted_at=spotted_at, where=where, by=by,
                    dossier=dossier)


@dataclass
class Variant:
    signature: ConfigSignature
    label: str = ""
    sightings: list = field(default_factory=list)   # of Sighting

    def to_dict(self) -> dict:
        return {"label": self.label,
                "signature": self.signature.to_dict(),
                "sightings": [s.to_dict() for s in self.sightings]}

    @classmethod
    def from_dict(cls, d: dict) -> "Variant":
        return cls(signature=ConfigSignature.from_dict(
                       d.get("signature") or {}),
                   label=str(d.get("label", "")),
                   sightings=[Sighting.from_dict(s)
                              for s in d.get("sightings", [])])


def variant_label(family_name: str, signature: ConfigSignature,
                  variant_count: int = 1) -> str:
    """Deterministic variant label from family name + signature.

    - an arm names the variant: "<Family> with Arm";
    - a top lidar MODEL appends " + top lidar (<model>)"; payloads
      append " + <token>" each, in sorted order;
    - an all-baseline signature (manipulator absent, top lidar none,
      no payloads) adds nothing while it is the family's only variant —
      a single-variant family just uses the family name — and takes
      " (base configuration)" only when sibling variants make the
      disambiguation necessary (variant_count > 1).
    """
    label = family_name
    if signature.manipulator == "present":
        label += " with Arm"
    if signature.top_lidar not in ("none", "unknown"):
        label += f" + top lidar ({signature.top_lidar})"
    for token in signature.payloads:
        label += f" + {token}"
    baseline = (signature.manipulator == "absent"
                and signature.top_lidar == "none"
                and not signature.payloads)
    if label == family_name and baseline and variant_count > 1:
        label += " (base configuration)"
    return label


@dataclass
class Family:
    id: str                              # slug, e.g. "boston-dynamics-spot"
    name: str
    aliases: tuple = ()
    catalog_dex_id: str | None = None    # Robodex id, when catalogued
    credit: str = ""                     # who made this robot
    variants: list = field(default_factory=list)   # of Variant

    def to_dict(self) -> dict:
        return {"id": self.id, "name": self.name,
                "aliases": list(self.aliases),
                "catalog_dex_id": self.catalog_dex_id,
                "credit": self.credit,
                "variants": [v.to_dict() for v in self.variants]}

    @classmethod
    def from_dict(cls, d: dict) -> "Family":
        return cls(id=str(d.get("id", "")), name=str(d.get("name", "")),
                   aliases=tuple(d.get("aliases", ()) or ()),
                   catalog_dex_id=d.get("catalog_dex_id"),
                   credit=str(d.get("credit", "") or ""),
                   variants=[Variant.from_dict(v)
                             for v in d.get("variants", [])])


def _refresh_variant_labels(family: Family) -> None:
    count = len(family.variants)
    for v in family.variants:
        v.label = variant_label(family.name, v.signature,
                                variant_count=count)


# ---------------------------------------------------------------------------
# grouping engine
# ---------------------------------------------------------------------------

@dataclass
class GroupingDecision:
    outcome: str                         # one of OUTCOMES
    signature: ConfigSignature
    score: int = 0
    evidence: list = field(default_factory=list)
    family: Family | None = None         # target (or proposed) family
    variant: Variant | None = None       # target variant (ATTACH only)
    family_name: str = ""                # identity / proposed family name
    confirm: str = ""                    # PROPOSE: what a human must check

    def to_dict(self) -> dict:
        return {"outcome": self.outcome,
                "signature": self.signature.to_dict(),
                "score": self.score,
                "evidence": self.evidence,
                "family": (self.family.name if self.family else None),
                "variant": (self.variant.label if self.variant else None),
                "family_name": self.family_name,
                "confirm": self.confirm}


def _family_relation(identity: str, family: Family):
    """Best _name_relation of the identity against name + aliases."""
    rank = {"exact": 3, "strong": 2, "family": 1, "none": 0}
    best_rel, best_ev = "none", []
    for candidate in (family.name, *family.aliases):
        rel, ev = _name_relation(identity, candidate)
        if rank[rel] > rank[best_rel]:
            best_rel, best_ev = rel, ev
    return best_rel, best_ev


def _reference_draft(family: Family) -> dict:
    """The family's recorded draft spec (its first sighting's), or {}."""
    for variant in family.variants:
        for sighting in variant.sightings:
            if sighting.dossier:
                spec = _draft_spec(sighting.dossier)
                if spec:
                    return spec
    return {}


def classify_spotting(dossier: dict, families: list) -> GroupingDecision:
    """Decide where a new dossier files in the dex. Pure; mutates
    nothing. See the module docstring for the honesty rules."""
    identity = _identity_of(dossier)
    if not identity:
        raise ValueError("dossier has no identity value to group by")
    signature = signature_from_dossier(dossier)
    base_score = {"exact": 100, "strong": 80, "family": 40, "none": 0}

    best = None      # (rank, score, family, relation, evidence, contra)
    for family in families:
        relation, evidence = _family_relation(identity, family)
        if relation == "none":
            continue
        evidence = [f"family '{family.name}': {e}" for e in evidence]
        score = base_score[relation]
        contradictions: list[str] = []
        if relation in ("exact", "strong"):
            ref = _reference_draft(family)
            new_drive = signature.drivetrain
            ref_drive = str(ref.get("drivetrain") or "")
            if ref:
                if new_drive and ref_drive:
                    if new_drive == ref_drive:
                        score += 10
                        evidence.append(
                            f"drivetrain agrees with family "
                            f"'{family.name}' recorded draft ({new_drive})")
                    else:
                        score -= 25
                        msg = (f"drivetrain CONTRADICTS family "
                               f"'{family.name}' recorded draft: dossier "
                               f"says {new_drive}, family record says "
                               f"{ref_drive}")
                        evidence.append(msg)
                        contradictions.append(msg)
                for f_name in ("length_m", "width_m"):
                    d = _draft_value(dossier, f_name)
                    c = ref.get(f_name)
                    if not isinstance(d, (int, float)) \
                            or not isinstance(c, (int, float)):
                        continue
                    r = _ratio(float(d), float(c))
                    if r <= 1.5:
                        score += 5
                        evidence.append(
                            f"{f_name} consistent with family "
                            f"'{family.name}' record (dossier {d:g} vs "
                            f"recorded {c:g})")
                    elif r <= 2.5:
                        evidence.append(
                            f"{f_name} differs from family "
                            f"'{family.name}' record but within photo-"
                            f"estimate range (dossier {d:g} vs "
                            f"recorded {c:g})")
                    else:
                        score -= 15
                        msg = (f"{f_name} CONTRADICTS family "
                               f"'{family.name}' record (dossier {d:g} "
                               f"vs recorded {c:g}, {r:.1f}x apart — too "
                               f"far for a photo estimate of the same "
                               f"robot)")
                        evidence.append(msg)
                        contradictions.append(msg)
            else:
                evidence.append(
                    f"family '{family.name}' has no recorded draft spec; "
                    f"cross-check rests on the name alone")
        rank = {"exact": 3, "strong": 2, "family": 1}[relation]
        cand = (rank, score, family, relation, evidence, contradictions)
        if best is None or (cand[0], cand[1]) > (best[0], best[1]):
            best = cand

    if best is None:
        return GroupingDecision(
            outcome=NEW_FAMILY, signature=signature, score=0,
            evidence=[f"no Robodex family name-matches '{identity}' "
                      f"({len(families)} families checked)"],
            family_name=identity)

    _, score, family, relation, evidence, contradictions = best

    if relation == "family":
        evidence.append(
            f"same-brand family relation alone is not a merge: "
            f"'{identity}' may be a relative of '{family.name}', not "
            f"the same robot")
        return GroupingDecision(
            outcome=PROPOSE_FAMILY, signature=signature, score=score,
            evidence=evidence, family=family, family_name=identity,
            confirm=(f"confirm whether '{identity}' really belongs to "
                     f"the '{family.name}' family before filing it "
                     f"there; a shared brand is not the same model"))

    if contradictions:
        evidence.append(
            f"name match demoted: the draft contradicts family "
            f"'{family.name}', so this is a proposal, not an attach")
        return GroupingDecision(
            outcome=PROPOSE_FAMILY, signature=signature, score=score,
            evidence=evidence, family=family, family_name=identity,
            confirm=(f"confirm that '{identity}' is really "
                     f"'{family.name}' despite the contradiction(s): "
                     + "; ".join(contradictions)))

    for variant in family.variants:
        if variant.signature == signature:
            evidence.append(
                f"configuration signature matches variant "
                f"'{variant.label}' exactly ({_sig_text(signature)})")
            return GroupingDecision(
                outcome=ATTACH_VARIANT, signature=signature, score=score,
                evidence=evidence, family=family, variant=variant,
                family_name=identity)
    evidence.append(
        f"no variant of '{family.name}' carries this configuration "
        f"signature ({_sig_text(signature)}) — a new variant")
    return GroupingDecision(
        outcome=NEW_VARIANT, signature=signature, score=score,
        evidence=evidence, family=family, family_name=identity)


def apply_decision(families: list, decision: GroupingDecision,
                   sighting: Sighting) -> list:
    """File a sighting per a decision. PROPOSE_FAMILY mutates NOTHING
    (the proposal waits for the human named in decision.confirm);
    sightings are appended, never deduplicated."""
    if decision.outcome == PROPOSE_FAMILY:
        return families
    if decision.outcome == ATTACH_VARIANT:
        variant = decision.variant
        if variant is None:      # a hand-built decision: re-resolve
            variant = next(
                (v for v in decision.family.variants
                 if v.signature == decision.signature), None)
        if variant is None:
            raise ValueError("ATTACH_VARIANT decision names no variant "
                             "with the decision signature")
        variant.sightings.append(sighting)
        return families
    if decision.outcome == NEW_VARIANT:
        family = decision.family
        if family is None:
            raise ValueError("NEW_VARIANT decision names no family")
        family.variants.append(Variant(signature=decision.signature,
                                       sightings=[sighting]))
        _refresh_variant_labels(family)
        return families
    if decision.outcome == NEW_FAMILY:
        dossier = sighting.dossier or {}
        match = dossier.get("catalog_match") or {}
        credit = dossier.get("credit") or {}
        name = sighting.identity or _identity_of(dossier) \
            or decision.family_name
        family = Family(
            id=slugify(name), name=name, aliases=(),
            catalog_dex_id=(match.get("dex_id")
                            if isinstance(match, dict) else None),
            credit=(str(credit.get("value", ""))
                    if isinstance(credit, dict) else ""),
            variants=[Variant(signature=decision.signature,
                              sightings=[sighting])])
        _refresh_variant_labels(family)
        families.append(family)
        return families
    raise ValueError(f"unknown grouping outcome {decision.outcome!r}")


# ---------------------------------------------------------------------------
# serialization (schema robotforge-robodex-families/1 — see docstring)
# ---------------------------------------------------------------------------

def families_to_dict(families: list) -> dict:
    return {"schema": FAMILIES_SCHEMA,
            "families": [f.to_dict() for f in families]}


def families_from_dict(data: dict) -> list:
    if isinstance(data, dict):
        schema = data.get("schema")
        if schema is not None and schema != FAMILIES_SCHEMA:
            raise ValueError(f"families schema {schema!r} is not "
                             f"{FAMILIES_SCHEMA!r}")
        rows = data.get("families", [])
    else:
        rows = data
    return [Family.from_dict(d) for d in rows]


# ---------------------------------------------------------------------------
# example migration
# ---------------------------------------------------------------------------

# Operator context from examples/spotter/spot-cpp/field-notes.md (the
# spotting: 2026-10-28, Intelligent Robotics Lab, Cal Poly Pomona).
_EXAMPLE_CONTEXT = {
    "spot-cpp": {"spotted_at": "2026-10-28",
                 "where": "Cal Poly Pomona IRLab"},
}


def build_example_families(examples_dir: str | Path | None = None) -> list:
    """File the shipped example dossiers into a fresh dex, in order.

    Loads examples/spotter/*/dossier.json (sorted by directory name),
    wraps each as a Sighting (id = its example directory name; the Spot
    sighting carries the field-notes context above), classifies
    sequentially from an empty dex, and applies each decision."""
    root = Path(examples_dir) if examples_dir is not None else \
        Path(__file__).resolve().parents[2] / "examples" / "spotter"
    families: list = []
    for dossier_path in sorted(root.glob("*/dossier.json")):
        dossier = json.loads(dossier_path.read_text())
        ctx = _EXAMPLE_CONTEXT.get(dossier_path.parent.name, {})
        sighting = sighting_from_dossier(
            dossier, sighting_id=dossier_path.parent.name,
            spotted_at=ctx.get("spotted_at"), where=ctx.get("where"))
        decision = classify_spotting(dossier, families)
        families = apply_decision(families, decision, sighting)
    return families
