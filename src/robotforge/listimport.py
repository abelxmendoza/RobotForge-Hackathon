"""Shopping-list intake: paste a list -> assembled robot draft.

The third front door (after plain-language describe and photo intake). A
pasted shopping/wish list — Amazon's paste format today, plain title lists
too — is parsed into items, each item is identified against functional
slots by deterministic title rules, the identified parts are assembled
against a robot-class slot map, and the module produces:

- an assembly (slot -> item, quantities have/need),
- suggested wiring connections + orientation notes (each with a reason),
- the missing/needed diff, with alternative-store *search* links
  (vendor search links only — never scraped prices or stock claims),
- warnings (kit overlaps, duplicated lines, dated parts).

Identification is rule-based and conservative on purpose: a title that
matches nothing lands in `unidentified` and is shown, never silently
dropped and never assigned invented specs. Model-assisted identification
(Muse Spark) can replace the matcher behind the same interface later;
the assembly/wiring/missing logic does not care how an item was matched.

Scope v1: quadcopter slot map (the class Abel's first real list targets).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from urllib.parse import quote_plus

# ------------------------------------------------------------- parsing

_NOISE_PREFIXES = ("$", "by ", "item added", "add to cart", "add a note",
                   "move", "see all buying options", "you pay", "size :",
                   "size:", "color :", "color:", "best seller")
_NOISE_CONTAINS = ("out of 5 stars", "free shipping", "details")


def parse_paste(text: str) -> list[dict]:
    """Extract [{title, price}] from a pasted list.

    Amazon's wish-list paste prints every title twice in a row and
    interleaves prices, ratings, and action links; consecutive duplicate
    lines collapse and noise lines are skipped. A plain one-title-per-line
    list parses too."""
    items: list[dict] = []
    prev_line = None
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        low = line.lower()
        if low.startswith("$"):
            m = re.search(r"\$([\d,]+\.\d{2})", line)
            if m and items:
                items[-1]["price"] = float(m.group(1).replace(",", ""))
            prev_line = line
            continue
        if low.startswith(_NOISE_PREFIXES) or \
                any(n in low for n in _NOISE_CONTAINS):
            prev_line = line
            continue
        if len(line) < 12:
            prev_line = line
            continue
        if line == prev_line:
            continue  # the doubled title line in Amazon pastes
        items.append({"title": line, "price": None})
        prev_line = line
    return items


# ------------------------------------------------------- identification

@dataclass
class Identified:
    title: str
    price: float | None
    slot: str                 # functional slot, "bench", or "unidentified"
    qty: int = 1
    specs: dict = field(default_factory=dict)
    note: str = ""


def _qty(title: str, *patterns: str) -> int:
    for pat in patterns:
        m = re.search(pat, title, re.I)
        if m:
            return int(m.group(1))
    return 1


def _first(title: str, pat: str, cast=float):
    m = re.search(pat, title, re.I)
    return cast(m.group(1)) if m else None


_RULES = [
    # order matters: bundles and specific parts before generic ones
    ("kit_bundle", r"quadcopter set|drone kit set|complete kit|full kit"),
    ("bench", r"spectrum analyzer|oscilloscope|logic analyzer|multimeter"),
    ("bench", r"jumper wire|breadboard|esp32|esp-wroom|stm32|nucleo|"
              r"development board"),
    ("power_module", r"power module"),
    ("pdb", r"power distribution board|\bpdb\b"),
    ("charger", r"balance charger|battery charger|lipo charger"),
    ("radio_tx", r"transmitter"),
    ("receiver", r"receiver"),
    ("connectors", r"xt60 connector|connectors plugs"),
    ("battery", r"lipo battery|battery pack"),
    ("esc", r"\besc\b|electronic speed controller"),
    ("propeller", r"propeller|\bprops?\b"),
    ("motor", r"brushless motor"),
    ("frame", r"quadcopter frame|drone frame|\bframe\b"),
    ("flight_controller", r"pixhawk|flight controller"),
    ("gps", r"\bgps\b"),
    ("gimbal", r"gimbal"),
    ("fpv", r"\bvtx\b|fpv camera"),
    ("cable", r"silicone.*wire|\bawg\b.*wire"),
]


def identify(item: dict) -> Identified:
    title = item["title"]
    low = title.lower()
    slot = "unidentified"
    # A battery states its capacity; a connector pack never does. Titles
    # like "...LiPo Battery ... with XT60 Connector" are batteries that
    # merely name their plug — decide those before the generic rules.
    if re.search(r"\d+\s?mah", low) and "batter" in low:
        slot = "battery"
    for name, pat in _RULES if slot == "unidentified" else []:
        if re.search(pat, low):
            slot = name
            break
    specs: dict = {}
    qty = 1
    if slot == "motor":
        qty = _qty(title, r"(\d+)\s?pcs")
        kv = _first(title, r"(\d{3,4})\s?kv", int)
        stator = _first(title, r"\b(\d{4})\s?\d{3,4}\s?kv", str)
        if kv:
            specs["kv"] = kv
        if stator:
            specs["stator"] = stator
    elif slot == "esc":
        qty = _qty(title, r"(\d+)\s?pcs")
        amps = _first(title, r"(\d+)\s?a\b", int)
        if amps:
            specs["amps"] = amps
        s = re.search(r"(\d)\s?-\s?(\d)\s?s\b", low)
        if s:
            specs["cells"] = f"{s.group(1)}-{s.group(2)}S"
    elif slot == "propeller":
        pairs = _qty(title, r"(\d+)\s?pairs")
        qty = pairs * 2 if pairs > 1 or "pairs" in low else qty
        size = re.search(r"\b(10\d{2}|50\d{2}|\d{2}45)\b", title)
        if size:
            specs["size_code"] = size.group(1)
    elif slot == "battery":
        qty = _qty(title, r"(\d+)\s?packs?")
        cells = _first(title, r"(\d)\s?s\b", int)
        mah = _first(title, r"(\d{3,5})\s?mah", int)
        crate = _first(title, r"(\d+)\s?c\b", int)
        if cells:
            specs["cells"] = cells
        if mah:
            specs["capacity_mah"] = mah
        if crate:
            specs["c_rate"] = crate
        if "xt60" in low:
            specs["connector"] = "XT60"
    elif slot == "frame":
        wb = _first(title, r"(\d{3})\s?mm", int)
        if wb:
            specs["wheelbase_mm"] = wb
    elif slot == "connectors":
        qty = _qty(title, r"(\d+)\s?pairs") * 2
    elif slot == "radio_tx" and "receiver" in low:
        pass  # receiver slot filled in assembly, noted there
    return Identified(title=title, price=item.get("price"), slot=slot,
                      qty=qty, specs=specs)


# ------------------------------------------------------------ assembly

# slot -> (qty needed for a quad, required_for_flight, label)
QUAD_SLOTS = {
    "frame": (1, True, "frame"),
    "motor": (4, True, "brushless motors"),
    "esc": (4, True, "ESCs (or one 4-in-1)"),
    "propeller": (4, True, "propellers"),
    "flight_controller": (1, True, "flight controller"),
    "receiver": (1, True, "receiver"),
    "radio_tx": (1, True, "transmitter"),
    "battery": (1, True, "flight battery"),
    "pdb": (1, False, "power distribution board"),
    "power_module": (1, False, "power module (V/I sensing for the FC)"),
    "gps": (1, False, "GPS (needed for position/loiter modes)"),
    "charger": (1, False, "balance charger (support equipment)"),
    "fpv": (1, False, "FPV camera + VTX"),
    "gimbal": (1, False, "camera gimbal (payload)"),
}

VENDOR_SEARCH = {
    "flight_controller": [
        ("Holybro", "https://holybro.com/search?q={q}"),
        ("GetFPV", "https://www.getfpv.com/catalogsearch/result/?q={q}")],
    "gps": [
        ("Holybro", "https://holybro.com/search?q={q}"),
        ("GetFPV", "https://www.getfpv.com/catalogsearch/result/?q={q}")],
    "battery": [
        ("RaceDayQuads", "https://www.racedayquads.com/search?q={q}"),
        ("Pyrodrone", "https://pyrodrone.com/search?q={q}")],
    "motor": [
        ("GetFPV", "https://www.getfpv.com/catalogsearch/result/?q={q}"),
        ("AliExpress", "https://www.aliexpress.com/wholesale?SearchText={q}")],
    "fpv": [
        ("RaceDayQuads", "https://www.racedayquads.com/search?q={q}"),
        ("GetFPV", "https://www.getfpv.com/catalogsearch/result/?q={q}")],
    "_default": [
        ("GetFPV", "https://www.getfpv.com/catalogsearch/result/?q={q}"),
        ("Amazon", "https://www.amazon.com/s?k={q}")],
}

_SEARCH_TERMS = {
    "flight_controller": "pixhawk flight controller",
    "gps": "gps module pixhawk",
    "battery": "4s lipo battery",
    "motor": "brushless motor quadcopter",
    "fpv": "fpv camera vtx",
}


def _vendor_links(slot: str) -> list[dict]:
    q = quote_plus(_SEARCH_TERMS.get(slot, slot.replace("_", " ")))
    return [{"store": name, "url": url.format(q=q)}
            for name, url in VENDOR_SEARCH.get(slot, VENDOR_SEARCH["_default"])]


def assemble(items: list[Identified]) -> dict:
    """Assemble identified items against the quadcopter slot map."""
    by_slot: dict[str, list[Identified]] = {}
    for it in items:
        by_slot.setdefault(it.slot, []).append(it)
        if it.slot == "radio_tx" and "receiver" in it.title.lower():
            by_slot.setdefault("receiver", []).append(
                Identified(it.title + " (bundled receiver)", it.price,
                           "receiver", 1, {}, "bundled with transmitter"))
    kit = by_slot.get("kit_bundle", [])
    kit_fills = {"flight_controller", "gps", "radio_tx", "receiver"} \
        if kit else set()

    slots = {}
    missing = []
    for slot, (need, required, label) in QUAD_SLOTS.items():
        have_items = by_slot.get(slot, [])
        have = sum(i.qty for i in have_items)
        if have >= need:
            status = "filled"
        elif slot in kit_fills:
            status = "in_kit_unverified"
        elif have > 0:
            status = "partial"
        else:
            status = "missing"
        entry = {"label": label, "need": need, "have": have,
                 "status": status, "required": required,
                 "items": [i.title for i in have_items]}
        if status in ("missing", "partial"):
            entry["alternatives"] = _vendor_links(slot)
            missing.append({"slot": slot, **entry})
        slots[slot] = entry

    warnings = []
    if kit:
        overlap = [s for s in ("frame", "motor", "esc", "propeller", "pdb")
                   if by_slot.get(s)]
        warnings.append(
            "kit bundle present: it likely duplicates the individually "
            f"listed {', '.join(overlap)} and its contents are unverified — "
            "buy one route or the other, not both")
    titles = [i.title for i in items]
    for t in set(titles):
        if titles.count(t) > 1:
            warnings.append(f"duplicate line in list: {t[:60]}...")
    bench = [i.title for i in items if i.slot == "bench"]
    unknown = [i.title for i in items if i.slot == "unidentified"]
    return {"slots": slots, "missing": missing, "warnings": warnings,
            "bench": bench, "unidentified": unknown,
            "kit": [i.title for i in kit]}


# -------------------------------------------------------------- wiring

def suggest_wiring(assembly: dict, items: list[Identified]) -> dict:
    """Connection + orientation suggestions for the assembled quad.

    Every suggestion carries its reason, per the product rule: the app
    explains placement instead of just asserting it. Connections are only
    proposed between slots that are filled or in the kit."""
    filled = {s for s, e in assembly["slots"].items()
              if e["status"] in ("filled", "in_kit_unverified", "partial")}
    conns = []

    def add(a, b, via, note):
        conns.append({"from": a, "to": b, "via": via, "note": note})

    if "battery" in filled and "pdb" in filled:
        add("flight battery", "PDB", "XT60",
            "main power in; battery mounts low and centered on the frame "
            "so its mass sits at the centre of gravity")
    if "pdb" in filled and "esc" in filled:
        add("PDB", "ESCs x4", "solder pads / power leads",
            "ESCs mount on the arms close to their motors, keeping power "
            "runs short and the centre plate uncluttered")
    if "esc" in filled and "motor" in filled:
        add("each ESC", "its motor", "3 phase wires",
            "wire order sets spin direction together with the CW/CCW "
            "motor pairing; swap any two wires to reverse a motor")
    if "power_module" in filled and "flight_controller" in filled:
        add("flight battery", "power module -> FC power port", "XT60 pass-through",
            "the module sits in line with the main lead so the FC can "
            "sense pack voltage and current")
    elif "pdb" in filled and "flight_controller" in filled:
        add("PDB 5V BEC", "flight controller", "5V rail",
            "the PDB's regulated 5V feeds the FC; OPTO ESCs provide no "
            "BEC, so this rail is the FC's power source")
    if "receiver" in filled and "flight_controller" in filled:
        add("receiver", "flight controller", "PPM / i-BUS input",
            "bind the transmitter before the first powered test, and do "
            "every bench power-up with props off")
    if "flight_controller" in filled and "esc" in filled:
        add("flight controller motor outputs 1-4", "ESC signal wires",
            "signal leads",
            "diagonal motor pairs share a spin direction in an X quad; "
            "match each output to the corner the configurator expects")
    if "gimbal" in filled and "pdb" in filled:
        add("PDB 12V BEC", "gimbal", "12V rail",
            "the PDB's 12V BEC is the natural feed for the gimbal; keep "
            "its leads clear of the FC's compass/GPS area")
    if "charger" in filled and "battery" in filled:
        add("balance charger", "flight battery", "XT60 lead + balance lead",
            "balance mode, charged off the aircraft; both list packs "
            "sequentially on an 80W-class charger")

    orientation = [
        "X-quad layout: diagonal motor pairs spin the same direction; "
        "CW props go on CW motors, CCW on CCW — the motor and prop sets "
        "in the list are both sold as matched CW/CCW sets for this.",
        "Flight controller arrow points at the frame's front; mount it "
        "on the centre plate, level, away from the PDB's high-current runs.",
        "Battery sits low and centred, connector toward the rear for "
        "easy plug access without shifting the CG.",
        "Receiver antennas exit at angles away from carbon and power "
        "leads; keep them off the arms' ESC wiring.",
    ]
    return {"connections": conns, "orientation": orientation}


# -------------------------------------------------------------- report

def import_list(text: str) -> dict:
    raw = parse_paste(text)
    items = [identify(i) for i in raw]
    assembly = assemble(items)
    wiring = suggest_wiring(assembly, items)
    from .verify import build_verification
    verification = build_verification(items)
    return {"items": [{"title": i.title, "price": i.price, "slot": i.slot,
                       "qty": i.qty, "specs": i.specs} for i in items],
            "assembly": assembly, "wiring": wiring,
            "verification": verification}


def render_text(report: dict) -> str:
    out = ["IDENTIFIED PARTS"]
    for i in report["items"]:
        price = f" ${i['price']:.2f}" if i["price"] else ""
        out.append(f"  [{i['slot']}] x{i['qty']}{price}  {i['title'][:80]}")
    out.append("\nASSEMBLY (quadcopter)")
    for slot, e in report["assembly"]["slots"].items():
        mark = {"filled": "OK ", "in_kit_unverified": "KIT",
                "partial": "LOW", "missing": "MISS"}[e["status"]]
        out.append(f"  [{mark}] {e['label']}: have {e['have']}, need {e['need']}")
    if report["assembly"]["missing"]:
        out.append("\nMISSING / NEEDED")
        for m in report["assembly"]["missing"]:
            req = "required" if m["required"] else "recommended"
            out.append(f"  - {m['label']} ({req})")
            for link in m.get("alternatives", []):
                out.append(f"      search: {link['store']} {link['url']}")
    if report["wiring"]["connections"]:
        out.append("\nWIRING")
        for c in report["wiring"]["connections"]:
            out.append(f"  {c['from']} -> {c['to']} [{c['via']}] — {c['note']}")
        out.append("\nORIENTATION")
        for o in report["wiring"]["orientation"]:
            out.append(f"  - {o}")
    for w in report["assembly"]["warnings"]:
        out.append(f"\nWARNING: {w}")
    if report.get("verification"):
        from .verify import render_lines
        out += render_lines(report["verification"])
    if report["assembly"]["bench"]:
        out.append(f"\nBENCH (not robot parts): {len(report['assembly']['bench'])} items")
    if report["assembly"]["unidentified"]:
        out.append("UNIDENTIFIED (shown, never dropped):")
        for u in report["assembly"]["unidentified"]:
            out.append(f"  ? {u[:80]}")
    return "\n".join(out) + "\n"
