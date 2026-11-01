"""Deterministic validation — the trust gate between extraction and proposal.

An extracted field survives ONLY if:
  (a) its `quote` is a literal substring of the fetched page text
      (whitespace- and dash-normalized on both sides),
  (b) its value and unit parse deterministically into the catalog field's
      canonical unit (normalization table below), and
  (c) its type matches the field's schema.

Failures are dropped WITH REASONS. Nothing here repairs, rounds into place,
or guesses: a model that cannot produce a verifiable quote loses the field.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field as dc_field

# ---------------------------------------------------------------- schema
# Canonical numeric spec fields of catalog/parts.json, each with the unit the
# catalog stores it in and the unit spellings a page may use for it.
# factor converts the page unit INTO the catalog unit.
FIELD_UNITS: dict[str, dict[str, float]] = {
    "voltage_v": {"v": 1.0, "mv": 0.001, "volt": 1.0, "volts": 1.0},
    "voltage_v_max": {"v": 1.0, "mv": 0.001, "volt": 1.0, "volts": 1.0},
    "voltage_v_min": {"v": 1.0, "mv": 0.001, "volt": 1.0, "volts": 1.0},
    "input_v_max": {"v": 1.0, "mv": 0.001},
    "output_v": {"v": 1.0, "mv": 0.001},
    "logic_v": {"v": 1.0, "mv": 0.001},
    "current_a": {"a": 1.0, "ma": 0.001, "amp": 1.0, "amps": 1.0},
    "current_a_per_channel": {"a": 1.0, "ma": 0.001, "amp": 1.0, "amps": 1.0},
    "output_a": {"a": 1.0, "ma": 0.001, "amp": 1.0, "amps": 1.0},
    "charge_a_max": {"a": 1.0, "ma": 0.001},
    "fuse_a": {"a": 1.0, "ma": 0.001},
    "capacity_mah": {"mah": 1.0, "ah": 1000.0},
    "torque_kg_cm": {"kg·cm": 1.0, "kg-cm": 1.0, "kgcm": 1.0,
                     "n·m": 10.1972, "nm": 10.1972, "n-m": 10.1972,
                     "oz·in": 0.720772, "oz-in": 0.720772},
    "stall_torque_nm": {"n·m": 1.0, "nm": 1.0, "n-m": 1.0,
                        "kg·cm": 0.0980665, "kg-cm": 0.0980665, "kgcm": 0.0980665,
                        "oz·in": 0.00706155, "oz-in": 0.00706155},
    "holding_torque_nm": {"n·m": 1.0, "nm": 1.0, "n-m": 1.0,
                          "kg·cm": 0.0980665, "kg-cm": 0.0980665, "kgcm": 0.0980665},
    "range_m": {"m": 1.0, "cm": 0.01, "mm": 0.001, "ft": 0.3048},
    "depth_range_m": {"m": 1.0, "cm": 0.01, "mm": 0.001, "ft": 0.3048},
    "diameter_m": {"m": 1.0, "cm": 0.01, "mm": 0.001, "in": 0.0254, "inch": 0.0254},
    "width_m": {"m": 1.0, "cm": 0.01, "mm": 0.001, "in": 0.0254, "inch": 0.0254},
    "wheelbase_mm": {"mm": 1.0, "cm": 10.0, "m": 1000.0, "in": 25.4},
    "profile_mm": {"mm": 1.0, "cm": 10.0},
    "mass_g": {"g": 1.0, "kg": 1000.0, "oz": 28.3495, "lb": 453.592},
    "capacity_gb": {"gb": 1.0, "mb": 0.001},
    "print_temp_c": {"°c": 1.0, "c": 1.0, "°f": None, "f": None},  # °F handled specially
}

# Unitless integer fields (unit may be empty).
UNITLESS_FIELDS = {"steps_per_rev", "cells", "channels", "kv", "megapixels", "gauge_awg"}

ALLOWED_FIELDS = set(FIELD_UNITS) | UNITLESS_FIELDS

# Fields whose wrongness can hurt someone or break a fit: these route to the
# individual confirm queue in the proposal .md (§8.1 "Easy").
SAFETY_FIELDS = {
    f for f in ALLOWED_FIELDS
    if f.startswith(("voltage", "input_v", "output_v", "logic_v", "current",
                     "torque", "stall_torque", "holding_torque"))
} | {"diameter_m", "width_m", "wheelbase_mm", "range_m", "depth_range_m", "fuse_a"}


# ---------------------------------------------------------------- helpers

def normalize_ws(text: str) -> str:
    text = text.replace("\u00a0", " ")  # NBSP -> space
    for dash in ("–", "—", "−", "‐"):
        text = text.replace(dash, "-")
    return re.sub(r"\s+", " ", text).strip()


def quote_in_text(quote: str, text: str) -> bool:
    q = normalize_ws(quote)
    if not q:
        return False
    return q in normalize_ws(text)


def _to_number(value) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        cleaned = value.replace(",", "").replace("$", "").strip()
        try:
            return float(cleaned)
        except ValueError:
            return None
    return None


def _convert(field_name: str, value: float, unit: str | None) -> float | None:
    """Value expressed in `unit` -> catalog unit for `field_name`, or None."""
    if field_name in UNITLESS_FIELDS:
        return value
    table = FIELD_UNITS.get(field_name)
    if table is None:
        return None
    if unit is None or unit.strip() == "":
        return None  # a dimensioned field with no unit is not evidence
    key = unit.strip().lower().replace(" ", "")
    if field_name == "print_temp_c" and key in ("°f", "f"):
        return (value - 32.0) * 5.0 / 9.0
    factor = table.get(key)
    if factor is None:
        return None
    return value * factor


# ---------------------------------------------------------------- results

@dataclass
class ValidField:
    field: str
    value: float | list  # scalar, or [min, max] for a range
    unit: str             # unit as stated on the page ("" if unitless)
    quote: str
    source_url: str
    safety_relevant: bool = False


@dataclass
class Rejection:
    item: str       # field name, "price_breaks", or "stock_wording"
    reason: str     # quote_not_found | unit_unparseable | type_mismatch |
                    # field_not_in_schema | value_unparseable
    detail: str = ""


@dataclass
class Validated:
    fields: list = dc_field(default_factory=list)        # list[ValidField]
    price_breaks: list = dc_field(default_factory=list)  # [{qty, unit_price, currency, quote}]
    stock_wording: str | None = None
    stock_quote: str = ""
    rejected: list = dc_field(default_factory=list)      # list[Rejection]


# ---------------------------------------------------------------- main

def validate_extraction(raw: dict, page_text: str, source_url: str) -> Validated:
    out = Validated()
    if not isinstance(raw, dict):
        out.rejected.append(Rejection("*", "type_mismatch", "extraction was not a JSON object"))
        return out

    for item in raw.get("fields", []) or []:
        if not isinstance(item, dict):
            out.rejected.append(Rejection("?", "type_mismatch", "field entry was not an object"))
            continue
        name = item.get("field", "")
        quote = item.get("quote", "")
        if name not in ALLOWED_FIELDS:
            out.rejected.append(Rejection(str(name), "field_not_in_schema"))
            continue
        if not quote_in_text(str(quote), page_text):
            out.rejected.append(Rejection(name, "quote_not_found",
                                          "quote is not a literal substring of the page text"))
            continue
        unit = item.get("unit")
        value = item.get("value")
        if isinstance(value, (list, tuple)):
            if len(value) != 2:
                out.rejected.append(Rejection(name, "type_mismatch", "range must have 2 ends"))
                continue
            ends = [_to_number(v) for v in value]
            if any(v is None for v in ends):
                out.rejected.append(Rejection(name, "value_unparseable", str(value)))
                continue
            conv = [_convert(name, v, unit) for v in ends]
            if any(v is None for v in conv):
                out.rejected.append(Rejection(name, "unit_unparseable", f"unit={unit!r}"))
                continue
            final: float | list = [round(conv[0], 6), round(conv[1], 6)]
        else:
            num = _to_number(value)
            if num is None:
                out.rejected.append(Rejection(name, "value_unparseable", str(value)))
                continue
            conv1 = _convert(name, num, unit)
            if conv1 is None:
                out.rejected.append(Rejection(name, "unit_unparseable", f"unit={unit!r}"))
                continue
            final = round(conv1, 6)
        out.fields.append(ValidField(
            field=name, value=final, unit=str(unit or ""), quote=str(quote),
            source_url=source_url, safety_relevant=name in SAFETY_FIELDS,
        ))

    for pb in raw.get("price_breaks", []) or []:
        if not isinstance(pb, dict):
            out.rejected.append(Rejection("price_breaks", "type_mismatch"))
            continue
        quote = str(pb.get("quote", ""))
        if not quote_in_text(quote, page_text):
            out.rejected.append(Rejection("price_breaks", "quote_not_found",
                                          "price quote is not a literal substring of the page text"))
            continue
        qty = _to_number(pb.get("qty"))
        price = _to_number(pb.get("unit_price"))
        if qty is None or qty < 1 or int(qty) != qty:
            out.rejected.append(Rejection("price_breaks", "value_unparseable",
                                          f"qty={pb.get('qty')!r}"))
            continue
        if price is None or price <= 0:
            out.rejected.append(Rejection("price_breaks", "value_unparseable",
                                          f"unit_price={pb.get('unit_price')!r}"))
            continue
        currency = str(pb.get("currency", "USD")).upper()
        if not re.fullmatch(r"[A-Z]{3}", currency):
            out.rejected.append(Rejection("price_breaks", "type_mismatch",
                                          f"currency={currency!r}"))
            continue
        out.price_breaks.append({"qty": int(qty), "unit_price": round(price, 4),
                                 "currency": currency, "quote": quote})

    stock = raw.get("stock_wording")
    if isinstance(stock, dict) and stock.get("value"):
        quote = str(stock.get("quote", ""))
        if quote_in_text(quote, page_text):
            wording = str(stock["value"]).strip()
            if len(wording) <= 120:
                out.stock_wording = wording
                out.stock_quote = quote
            else:
                out.rejected.append(Rejection("stock_wording", "type_mismatch",
                                              "wording over 120 chars"))
        else:
            out.rejected.append(Rejection("stock_wording", "quote_not_found",
                                          "stock quote is not a literal substring of the page text"))
    return out
