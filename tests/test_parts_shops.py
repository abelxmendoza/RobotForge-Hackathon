"""Shop links on parts: bigger catalogue, links saved with the part.

Pins (Abel, 2026-11-04): the catalogue grew well past its original
50 records; every record carries shop links and they are all https
urls on plausible vendor domains; links are SEARCH urls (or the
found-page slot) — no record gained a price; a saved web part whose
source page is a store keeps that store's found link, classified by
domain, through the save round-trip."""
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
DOC = json.loads((ROOT / "catalog/parts.json").read_text())
PARTS = DOC["parts"]

VENDOR_DOMAINS = {
    "digikey": "digikey.com", "mouser": "mouser.com",
    "adafruit": "adafruit.com", "sparkfun": "sparkfun.com",
    "pololu": "pololu.com", "robotshop": "robotshop.com",
    "amazon": "amazon.com", "mcmaster": "mcmaster.com",
    "servocity": "servocity.com", "gobilda": "gobilda.com",
}
# The only records that carried a price estimate before this change
# (web-gathered 2026-11-01, with source + fetch time on the record).
PRICED_BEFORE = {"driver_tb6612fng", "pla_filament", "petg_filament"}


def test_catalogue_grew():
    assert len(PARTS) >= 150, len(PARTS)
    assert len({p["id"] for p in PARTS}) == len(PARTS)


def test_every_record_has_shop_links_on_vendor_domains():
    for p in PARTS:
        shops = p.get("shops")
        assert isinstance(shops, list) and len(shops) >= 1, p["id"]
        for link in shops:
            assert set(link) == {"vendor", "url"}, (p["id"], link)
            assert link["vendor"] in VENDOR_DOMAINS, (p["id"], link)
            assert link["url"].startswith("https://"), (p["id"], link)
            host = link["url"].split("/")[2].lower().removeprefix("www.")
            assert host == VENDOR_DOMAINS[link["vendor"]] or \
                host.endswith("." + VENDOR_DOMAINS[link["vendor"]]), \
                (p["id"], link)


def test_found_slot_shape_when_present():
    for p in PARTS:
        if p.get("found_url") is not None:
            assert p["found_url"].startswith("https://"), p["id"]
            assert p.get("found_via"), p["id"]
            assert p.get("found_store"), p["id"]


def test_no_record_gained_a_price():
    priced = {p["id"] for p in PARTS if "price" in p or "price_estimate" in p}
    assert priced == PRICED_BEFORE, priced
    for p in PARTS:
        assert "price" not in json.dumps(p.get("shops", [])), p["id"]


def test_shop_links_survive_save_round_trip(tmp_path):
    lib = ROOT / "web-next/src/lib"
    for name in ["partsLibrary", "inventory", "shopLinks"]:
        (tmp_path / f"{name}.ts").write_text(
            (lib / f"{name}.ts").read_text()
            .replace("from './inventory'", "from './inventory.ts'")
            .replace("from './shopLinks'", "from './shopLinks.ts'"))
    (tmp_path / "package.json").write_text('{"type":"module"}')
    (tmp_path / "run.mjs").write_text("""
import assert from 'node:assert/strict';
import { libraryItems, catalogItems, parseLibraryCommand, changeLibrary } from './partsLibrary.ts';
import { vendorForUrl, webPartShopLinks, cataloguePartLinks, preferredStoresFor } from './shopLinks.ts';

// Vendor classification by domain (scope pin: DigiKey).
assert.equal(vendorForUrl('https://www.digikey.com/en/products/123').id, 'digikey');
assert.equal(vendorForUrl('https://www.mouser.com/c/?q=x').id, 'mouser');
assert.equal(vendorForUrl('https://www.gobilda.com/search?q=x').id, 'gobilda');
assert.equal(vendorForUrl('https://example.test/x'), null);
assert.deepEqual(preferredStoresFor('drivers'), ['pololu', 'digikey', 'adafruit']);

// A web part found on DigiKey: found link first, classified as
// DigiKey, via firecrawl; other preferred stores get search links.
const web = {id:'web1', name:'TB6612FNG dual motor driver', category:'drivers',
  specs:{voltage_v:12},
  provenance:{sourceUrl:'https://www.digikey.com/en/products/detail/toshiba/tb6612fng/123', fetchedAt:'t', sourceKind:'scrape'},
  verification:'WEB-SOURCED — UNVERIFIED'};
const links = webPartShopLinks({name:web.name, category:web.category, sourceUrl:web.provenance.sourceUrl});
assert.equal(links[0].kind, 'found');
assert.equal(links[0].vendor, 'digikey');
assert.equal(links[0].label, 'Digi-Key');
assert.equal(links[0].via, 'firecrawl');
assert.ok(links.slice(1).every(l => l.kind === 'search'));
assert.ok(!links.slice(1).some(l => l.vendor === 'digikey'));

// The library presents the web record with those links, and saving
// it keeps them (the save round-trip).
const presented = libraryItems([], [web]);
assert.equal(presented[0].shops[0].vendor, 'digikey');
assert.equal(presented[0].shops[0].kind, 'found');
const saved = changeLibrary([], [web], [], [],
  parseLibraryCommand('Save "TB6612FNG dual motor driver" to my wishlist'), 't', 'new').parts;
assert.equal(saved.length, 1);
assert.equal(saved[0].shops[0].kind, 'found');
assert.equal(saved[0].shops[0].vendor, 'digikey');
assert.equal(saved[0].shops[0].url, web.provenance.sourceUrl);
assert.ok(saved[0].shops.some(l => l.kind === 'search' && l.vendor === 'pololu'));

// Catalogue items carry their record's links, found page first.
const cat = catalogItems([{id:'m1', name:'Gearmotor', part_class:'actuators',
  specs:{voltage_v:12},
  shops:[{vendor:'pololu', url:'https://www.pololu.com/search?query=Gearmotor'}],
  found_url:'https://www.gobilda.com/some-motor', found_via:'firecrawl', found_store:'goBILDA'}]);
assert.equal(cat[0].shops[0].kind, 'found');
assert.equal(cat[0].shops[0].vendor, 'gobilda');
assert.equal(cat[0].shops[1].vendor, 'pololu');
const savedCat = changeLibrary([], [], cat, [],
  parseLibraryCommand('Save "Gearmotor" to my wishlist'), 't', 'new2').parts;
assert.equal(savedCat[0].shops[0].kind, 'found');
assert.equal(savedCat[0].shops.length, 2);
console.log('shop link pins OK');
""")
    out = subprocess.run(["node", "run.mjs"], cwd=tmp_path,
                         capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stdout + out.stderr
    assert "shop link pins OK" in out.stdout
