"""Extraction: one Muse Spark call per CHANGED page, fixed JSON schema.

The model is never trusted: it must attach a literal `quote` from the page
to every value it returns, and validate.py checks each quote against the
fetched text deterministically. Extraction goes through the existing Meta
Model API connector helper (meta_api.py, surrogate credential — the key
never touches this process), the same pattern the live Worker uses.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

from .validate import allowed_fields

MODEL = "muse-spark-1.3"
DEFAULT_HELPER = Path(
    "~/workspace/custom-connectors/custom.meta-model-api/bin/meta_api.py"
).expanduser()

_KIND_NOUN = {"part": "robot-part", "material": "material (filament or sheet stock)",
              "tool": "workshop tool"}

# Kind-specific guidance appended to the shared instructions. The field
# schema itself is enforced deterministically in validate.py — this only
# tells the model what to look for.
_KIND_NOTES = {
    "part": "",
    "material": """
Material specifics:
- "price_basis" says what one unit price buys, as printed (e.g. "1 kg spool",
  "per sheet", "300 x 300 mm sheet"). A material price without its basis is
  useless, so report it whenever the page states the package size.
- density_g_cm3 feeds mass math: only report it when the page prints a density.
- Process window: nozzle_temp_c and bed_temp_c as [min, max] ranges when the
  page prints a recommended range.
- Sizes: spool_weight_g for filament spools; sheet_length_mm / sheet_width_mm /
  sheet_thickness_mm for sheet stock, each with its own quote.
""",
    "tool": """
Tool specifics (report only the specs the page actually prints for THIS
tool type — an absent spec stays absent, never inferred from the tool class):
- 3D printers: build_volume_x_mm / build_volume_y_mm / build_volume_z_mm from
  the printed build volume (each value may share one quote), and
  "supported_materials" as a list of the filament/material names the page
  lists as supported, with a quote covering the list.
- Soldering stations: power_w and temp_range_c as a [min, max] range.
- Oscilloscopes: bandwidth_mhz, sample_rate_gsps, channels.
- Calipers: measuring_range_mm as a [min, max] range and resolution_mm.
- "price_basis" for a tool is normally "each"; report it only if printed.
""",
}

INSTRUCTIONS = """You extract structured facts from a {noun} product page or datasheet.
Return ONLY a JSON object, no prose, in exactly this shape:
{{
  "fields": [{{"field": "<name>", "value": <number or [min, max] or string or list of strings>, "unit": "<unit as printed>", "quote": "<exact text copied from the page>"}}],
  "price_breaks": [{{"qty": <int>, "unit_price": <number>, "currency": "USD", "quote": "<exact text copied from the page>"}}],
  "stock_wording": {{"value": "<short stock phrase>", "quote": "<exact text copied from the page>"}} or null,
  "price_basis": {{"value": "<what the unit price buys, as printed>", "quote": "<exact text copied from the page>"}} or null
}}
Rules:
- "field" must be one of the allowed field names listed in the request.
- "quote" must be copied CHARACTER-FOR-CHARACTER from the page text given to you,
  including the numbers. If you cannot quote it, omit the field.
- Report values in the units printed on the page; do not convert units.
- A price break is a quantity tier (e.g. buy 10+ at a lower unit price). The
  single-unit price is a break with qty 1.
- Never invent, round, or infer a value that is not printed on the page.
{notes}"""

_WINDOW_KEYWORDS = (
    "voltage", "current", "torque", "price", "$", "in stock", "out of stock",
    "weight", "mass", "dimensions", "range", "capacity", "operating",
    "supply", "vdc", " v ", " a ", " mm", " kg", " g ",
    "density", "build volume", "nozzle", "bed temp", "bandwidth",
    "sample rate", "resolution", "spool", "wattage", "filament",
    "supported materials", "sheet",
)


def window_text(text: str, limit: int = 24000) -> str:
    """Keep the head of the page plus windows around spec/price keywords, so
    a datasheet's electrical tables reach the model without shipping the
    whole document (§8: window first, whole PDF never)."""
    if len(text) <= limit:
        return text
    lower = text.lower()
    spans: list[tuple[int, int]] = [(0, 6000)]
    for kw in _WINDOW_KEYWORDS:
        start = 0
        while True:
            i = lower.find(kw, start)
            if i < 0:
                break
            spans.append((max(0, i - 900), min(len(text), i + 900)))
            start = i + len(kw)
    spans.sort()
    merged: list[list[int]] = []
    for s, e in spans:
        if merged and s <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], e)
        else:
            merged.append([s, e])
    out: list[str] = []
    total = 0
    for s, e in merged:
        chunk = text[s:e]
        if total + len(chunk) > limit:
            chunk = chunk[: max(0, limit - total)]
        if chunk:
            out.append(chunk)
            total += len(chunk)
        if total >= limit:
            break
    return "\n...\n".join(out)


class ExtractionUnavailable(RuntimeError):
    pass


class Extractor:
    """Interface: extract(item_context, page_text, source_url, kind)
    -> raw model JSON dict."""

    def extract(self, part: dict, page_text: str, source_url: str,
                kind: str = "part") -> dict:  # pragma: no cover
        raise NotImplementedError


class MetaModelExtractor(Extractor):
    def __init__(self, helper: Path | None = None, model: str = MODEL, timeout: int = 180):
        self.helper = Path(helper) if helper else Path(
            os.environ.get("META_API_HELPER", str(DEFAULT_HELPER)))
        self.model = model
        self.timeout = timeout
        self.calls = 0

    def extract(self, part: dict, page_text: str, source_url: str,
                kind: str = "part") -> dict:
        if not self.helper.exists():
            raise ExtractionUnavailable(
                f"Meta API helper not found at {self.helper} "
                "(set META_API_HELPER to the meta_api.py path)")
        allowed = sorted(allowed_fields(kind))
        user = (
            f"Item ({kind}): {part.get('name', part['part_id'])} "
            f"(catalog id {part['part_id']}, MPN {part.get('mpn') or 'unknown'})\n"
            f"Source URL: {source_url}\n"
            f"Allowed field names: {', '.join(allowed)}\n\n"
            f"PAGE TEXT:\n{window_text(page_text)}"
        )
        instructions = INSTRUCTIONS.format(
            noun=_KIND_NOUN.get(kind, "robot-part"),
            notes=_KIND_NOTES.get(kind, ""))
        with tempfile.NamedTemporaryFile(
                "w", suffix=".md", delete=False) as sf:
            sf.write(instructions)
            system_file = sf.name
        try:
            self.calls += 1
            proc = subprocess.run(
                [sys.executable, str(self.helper), "chat",
                 "--model", self.model, "--user", user,
                 "--system-file", system_file,
                 "--temperature", "0", "--timeout", str(self.timeout)],
                capture_output=True, text=True, timeout=self.timeout + 30,
            )
        finally:
            os.unlink(system_file)
        if proc.returncode != 0:
            raise ExtractionUnavailable(
                f"meta_api.py exited {proc.returncode}: {proc.stderr.strip()[:300]}")
        try:
            envelope = json.loads(proc.stdout)
            content = envelope["payload"]["choices"][0]["message"]["content"]
        except (json.JSONDecodeError, KeyError, IndexError, TypeError) as e:
            raise ExtractionUnavailable(f"unparseable helper response: {e}")
        content = content.strip()
        fence = re.search(r"```(?:json)?\s*(.*?)```", content, re.S)
        if fence:
            content = fence.group(1).strip()
        try:
            parsed = json.loads(content)
        except json.JSONDecodeError as e:
            raise ExtractionUnavailable(f"model did not return JSON: {e}")
        if not isinstance(parsed, dict):
            raise ExtractionUnavailable("model JSON was not an object")
        return parsed


class MockExtractor(Extractor):
    """Test double: canned raw extractions keyed by source URL; counts calls
    so idempotency (zero repeat calls) is directly assertable."""

    def __init__(self, canned: dict):
        self.canned = canned
        self.calls = 0
        self.called_urls: list[str] = []

    def extract(self, part: dict, page_text: str, source_url: str,
                kind: str = "part") -> dict:
        self.calls += 1
        self.called_urls.append(source_url)
        result = self.canned.get(source_url, {})
        if callable(result):
            return result(part, page_text)
        return json.loads(json.dumps(result))  # deep copy
