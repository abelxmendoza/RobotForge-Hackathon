'use client';
/* Demo seed data — what a visitor finds inside demo mode.
 *
 * Fresh and guided (Abel, 2026-11-01): demo mode is the showcase for
 * visitors who won't sign in, so it opens like a first visit, not
 * like someone else's half-used workshop. Every entry resets the
 * demo sandbox and seeds:
 * - two TurtleBots in the Workshop, each a single version straight
 *   from its recorded Robodex spec: the TurtleBot3 Burger (published
 *   spec) and the TurtleBot3 Waffle Pi (a photo draft, so every
 *   dimension is ESTIMATED and its note says so);
 * - a small starter shelf so My parts and the BOM have something to
 *   match: sim-only entries ARE real catalogue parts (datasheet specs,
 *   catalogue id attached), and the few "real" entries are stand-ins
 *   that carry "(demo sample)" in their name and a note saying so.
 * No invented history, wear or dates: the visitor makes the history.
 * Seeds write ONLY the ".demo" storage twins (see demoMode.ts); the
 * visitor's own data is never read or written. */
import { parts } from '@/lib/data';
import type { Part } from '@/lib/types';
import { GARAGE_KEY, type GarageRobot } from '@/lib/garage';
import { INVENTORY_KEY, type InventoryPart } from '@/lib/inventory';
import { OWNERSHIP_KEY } from '@/lib/toolsMaterials';
import { assetPath } from '@/components/home/asset';
import { DEMO_DATA_KEYS } from '@/lib/demoMode';

const SEED_AT = '2026-11-01T00:00:00.000Z';
const SIM_NOTE = 'Demo seed: a catalogue part shown as sim-only — virtual stock, not a shelf item.';
const SAMPLE_NOTE = 'Demo sample data — a stand-in so you can see how a real shelf entry reads. Not your actual parts.';

function catalogPart(id: string): Part {
  const p = parts.find((x) => x.id === id);
  if (!p) throw new Error('demo seed: catalogue part missing: ' + id);
  return p;
}

function base(partial: Partial<InventoryPart> & Pick<InventoryPart, 'id' | 'name' | 'category' | 'reality' | 'quantity'>): InventoryPart {
  return {
    section: partial.category === 'tool' ? 'tools' : 'parts',
    catalog_part_id: null,
    specs: {},
    read_from_label: [],
    condition: 'unknown',
    confidence: 'owner',
    status: 'confirmed',
    question: '',
    photo: null,
    chat: [],
    createdAt: SEED_AT,
    source: 'manual',
    robot_id: null,
    stock_location: '',
    notes: '',
    ...partial,
  };
}

/* A catalogue part as a sim-only inventory entry: name, specs and
 * identity all come from the catalogue record itself. The optional
 * note suffix and date are sample dressing (an earmark, a fitting)
 * — they describe the demo story, never the part. */
function simFromCatalog(
  id: string,
  category: string,
  quantity: number,
  opts?: { note?: string; createdAt?: string },
): InventoryPart {
  const p = catalogPart(id);
  return base({
    id: 'demo-' + id,
    name: p.name,
    category,
    reality: 'sim_only',
    quantity,
    catalog_part_id: p.id,
    specs: { ...(p.specs as Record<string, string | number>) },
    stock_location: 'Catalogue (virtual)',
    notes: SIM_NOTE + (opts?.note ?? ''),
    ...(opts?.createdAt ? { createdAt: opts.createdAt } : {}),
  });
}

function demoInventory(): InventoryPart[] {
  return [
    /* Parts · sim-only — the real catalogue, virtual stock. */
    simFromCatalog('rplidar_a1', 'sensor', 1),
    simFromCatalog('gearmotor_12v', 'motor', 2),
    simFromCatalog('driver_tb6612fng', 'motor_driver', 1),
    simFromCatalog('lipo_4s_5200', 'battery', 1),
    /* One nested example for the Columns view: the USB adapter board
     * an RPLIDAR A1 kit comes with, mounted under the lidar. */
    base({
      id: 'demo-sample-lidar-usb', name: 'USB serial adapter board (demo sample)', category: 'cable',
      reality: 'sim_only', quantity: 1, parent_id: 'demo-rplidar_a1', stock_location: 'Catalogue (virtual)',
      notes: SAMPLE_NOTE,
    }),
    /* Parts · real — one labeled demo sample, so the real-vs-sim
     * split shows. */
    base({
      id: 'demo-sample-pi5', name: 'Raspberry Pi 5 (demo sample)', category: 'computer',
      reality: 'real', quantity: 1, stock_location: 'Demo shelf',
      specs: { ...(catalogPart('raspberry_pi_5').specs as Record<string, string | number>) },
      notes: SAMPLE_NOTE,
    }),
    /* Tools · one sim-only, two real samples. */
    simFromCatalog('lipo_balance_charger', 'tool', 1),
    base({
      id: 'demo-sample-soldering', name: 'Soldering station (demo sample)', category: 'tool',
      reality: 'real', quantity: 1, stock_location: 'Demo bench',
      notes: SAMPLE_NOTE,
    }),
    base({
      id: 'demo-sample-calipers', name: 'Digital calipers (demo sample)', category: 'tool',
      reality: 'real', quantity: 1, stock_location: 'Demo bench',
      notes: SAMPLE_NOTE,
    }),
  ];
}

/* The demo twins a fresh entry clears, plus the once-per-entry
 * welcome flag so the guide shows again. */
function resetDemoSandbox(): void {
  try {
    for (const k of DEMO_DATA_KEYS) window.localStorage.removeItem(k + '.demo');
    window.sessionStorage.removeItem('rf.demo.welcomed');
  } catch {
    /* storage blocked: nothing to reset */
  }
}

function writeIfAbsent(key: string, value: unknown): void {
  try {
    if (window.localStorage.getItem(key) === null) {
      window.localStorage.setItem(key, JSON.stringify(value));
    }
  } catch {
    /* storage blocked: demo still opens, just unseeded */
  }
}

/* One recorded Robodex spec file (a static asset — no Worker
 * call). Null when it can't load: the caller seeds what it can
 * and the demo Garage falls back to the app's honest empty state
 * for the rest. */
async function fetchSpec(file: string): Promise<GarageRobot['versions'][number]['spec'] | null> {
  try {
    const r = await fetch(assetPath('examples/' + file));
    if (r.ok) return (await r.json()) as GarageRobot['versions'][number]['spec'];
  } catch {
    /* spec unavailable */
  }
  return null;
}

/* Reset and seed every demo twin. Each entry into the demo starts
 * fresh. The Garage robots are demo copies of Robodex robots with
 * their recorded specs (static assets — no Worker call); a spec that
 * can't load just means that robot isn't seeded. */
export async function seedDemoStores(): Promise<void> {
  resetDemoSandbox();
  writeIfAbsent(INVENTORY_KEY + '.demo', demoInventory());
  /* Demo ownership state (§11): the demo sandbox shows the Prusa
   * printer as on hand so both badges — and the derived build-plan
   * profile — are visible in the Workshop's Tools & Materials tab.
   * It is demo-twin state only; the catalogue itself records the
   * printer as simulated, and the visitor's own flips are never
   * touched. */
  writeIfAbsent(OWNERSHIP_KEY + '.demo', { printer_prusa_mk4s: 'on_hand' });
  const robots: GarageRobot[] = [];

  const burgerSpec = await fetchSpec('turtlebot3-burger.json');
  if (burgerSpec) {
    robots.push({
      id: 'demo-turtlebot3-burger',
      name: 'TurtleBot3 Burger (demo)',
      createdAt: SEED_AT,
      versions: [{
        id: 'demo-turtlebot3-burger-v1',
        label: 'From the Robodex',
        note: 'Demo copy of the Robodex catalogue robot, with its recorded spec. Change anything — your real robots are untouched.',
        source: 'robodex',
        createdAt: SEED_AT,
        spec: burgerSpec,
      }],
    });
  }

  const waffleSpec = await fetchSpec('photo-turtlebot.json');
  if (waffleSpec) {
    robots.push({
      id: 'demo-turtlebot3-waffle-pi',
      name: 'TurtleBot3 Waffle Pi (demo)',
      createdAt: SEED_AT,
      versions: [{
        id: 'demo-turtlebot3-waffle-pi-v1',
        label: 'Photo draft',
        note: 'Demo copy of the Robodex entry. Its spec is a photo draft, so every dimension is ESTIMATED until measured.',
        source: 'robodex',
        createdAt: SEED_AT,
        spec: waffleSpec,
      }],
    });
  }

  writeIfAbsent(GARAGE_KEY + '.demo', robots);
}
