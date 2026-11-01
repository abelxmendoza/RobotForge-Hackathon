'use client';
/* Demo seed data — what a visitor finds inside demo mode.
 *
 * Honesty rules (the repo's, applied to seeds):
 * - Sim-only entries ARE real catalogue parts, copied from
 *   catalog/parts.json with their datasheet specs and their
 *   catalog id attached. Sim-only is the truth for them: they are
 *   in the catalogue, not on anybody's shelf.
 * - "Real" entries are stand-ins so the real-vs-sim split reads
 *   properly; every one carries "(demo sample)" in its name and a
 *   note saying it is sample data, never a claim about a real
 *   shelf.
 * - The demo Garage robot is a copy of the Robodex's recorded
 *   TurtleBot3 Burger spec — the same file the chat's own fix
 *   handoff loads — labeled as a demo copy.
 * Seeds write ONLY the ".demo" storage twins (see demoMode.ts)
 * and only when a twin is absent, so a returning visitor's demo
 * sandbox is never reset under them. */
import { parts } from '@/lib/data';
import type { Part } from '@/lib/types';
import { GARAGE_KEY, type GarageRobot } from '@/lib/garage';
import { INVENTORY_KEY, type InventoryPart } from '@/lib/inventory';
import { assetPath } from '@/components/home/asset';

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
 * identity all come from the catalogue record itself. */
function simFromCatalog(id: string, category: string, quantity: number): InventoryPart {
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
    notes: SIM_NOTE,
  });
}

function demoInventory(): InventoryPart[] {
  return [
    /* Parts · sim-only — the real catalogue, virtual stock. */
    simFromCatalog('jetson_orin_nano', 'computer', 1),
    simFromCatalog('rplidar_a1', 'sensor', 1),
    simFromCatalog('lipo_4s_5200', 'battery', 2),
    simFromCatalog('driver_tb6612fng', 'motor_driver', 1),
    simFromCatalog('gearmotor_12v', 'motor', 2),
    simFromCatalog('wheel_100mm', 'wheel', 4),
    /* Parts · real — labeled demo samples. */
    base({
      id: 'demo-sample-pi5', name: 'Raspberry Pi 5 (demo sample)', category: 'computer',
      reality: 'real', quantity: 1, condition: 'new', stock_location: 'Demo shelf',
      specs: { ...(catalogPart('raspberry_pi_5').specs as Record<string, string | number>) },
      notes: SAMPLE_NOTE,
    }),
    base({
      id: 'demo-sample-18650', name: '18650 Li-ion cells (demo sample)', category: 'battery',
      reality: 'real', quantity: 6, condition: 'new', stock_location: 'Demo shelf',
      specs: { chemistry: 'liion', voltage_v: 3.7 },
      notes: SAMPLE_NOTE,
    }),
    /* Tools · sim-only + real samples, so both sections show the split. */
    simFromCatalog('lipo_balance_charger', 'tool', 1),
    base({
      id: 'demo-sample-soldering', name: 'Soldering station (demo sample)', category: 'tool',
      reality: 'real', quantity: 1, condition: 'used', stock_location: 'Demo bench',
      notes: SAMPLE_NOTE,
    }),
    base({
      id: 'demo-sample-calipers', name: 'Digital calipers (demo sample)', category: 'tool',
      reality: 'real', quantity: 1, condition: 'used', stock_location: 'Demo bench',
      notes: SAMPLE_NOTE,
    }),
  ];
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

/* Seed every demo twin. The Garage robot's spec is the Robodex's
 * own recorded Burger spec file (a static asset — no Worker call);
 * if it can't load, the demo Garage simply starts empty, which is
 * the app's honest empty state. */
export async function seedDemoStores(): Promise<void> {
  writeIfAbsent(INVENTORY_KEY + '.demo', demoInventory());
  const garageKey = GARAGE_KEY + '.demo';
  let garageAbsent = false;
  try {
    garageAbsent = window.localStorage.getItem(garageKey) === null;
  } catch {
    return;
  }
  if (!garageAbsent) return;
  let robots: GarageRobot[] = [];
  try {
    const r = await fetch(assetPath('examples/turtlebot3-burger.json'));
    if (r.ok) {
      const spec = (await r.json()) as GarageRobot['versions'][number]['spec'];
      robots = [
        {
          id: 'demo-turtlebot3-burger',
          name: 'TurtleBot3 Burger (demo)',
          createdAt: SEED_AT,
          versions: [
            {
              id: 'demo-turtlebot3-burger-v1',
              label: 'Baseline',
              note: 'Demo copy of the Robodex catalogue robot, with its recorded spec. Play freely — your real robots are untouched.',
              source: 'robodex',
              createdAt: SEED_AT,
              spec,
            },
          ],
        },
      ];
    }
  } catch {
    /* spec unavailable: the demo Garage starts empty */
  }
  writeIfAbsent(garageKey, robots);
}
