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
 * - The demo Garage holds demo copies of Robodex robots with
 *   their recorded specs: the TurtleBot3 Burger (a saved baseline
 *   plus a PLANNED version — the garage's own planned flag, spec
 *   still the baseline, because a plan is not a build) and the
 *   Pathfinder (a two-version build history whose current version
 *   is the recorded spec, unchanged). Dates, quantities and wear
 *   are sample dressing so the workspace reads as a returning
 *   user's; they live only in the demo twins and every label
 *   still says so.
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
    simFromCatalog('jetson_orin_nano', 'computer', 1, {
      note: ' Earmarked for the demo Burger\u2019s planned version \u2014 not fitted.',
      createdAt: '2026-10-27T11:20:00.000Z',
    }),
    simFromCatalog('rplidar_a1', 'sensor', 1, {
      note: ' Earmarked for the demo Burger\u2019s planned version \u2014 not fitted.',
      createdAt: '2026-10-27T11:20:00.000Z',
    }),
    simFromCatalog('lipo_4s_5200', 'battery', 2, {
      createdAt: '2026-10-19T08:40:00.000Z',
    }),
    simFromCatalog('driver_tb6612fng', 'motor_driver', 1, {
      createdAt: '2026-10-18T10:15:00.000Z',
    }),
    simFromCatalog('gearmotor_12v', 'motor', 2, {
      createdAt: '2026-10-18T10:15:00.000Z',
    }),
    simFromCatalog('wheel_100mm', 'wheel', 4, {
      note: ' Fitted to the demo Pathfinder\u2019s current version (demo sample history).',
      createdAt: '2026-10-25T16:45:00.000Z',
    }),
    /* Parts · real — labeled demo samples. */
    base({
      id: 'demo-sample-pi5', name: 'Raspberry Pi 5 (demo sample)', category: 'computer',
      reality: 'real', quantity: 1, condition: 'used', stock_location: 'Demo shelf',
      createdAt: '2026-10-14T13:05:00.000Z',
      specs: { ...(catalogPart('raspberry_pi_5').specs as Record<string, string | number>) },
      notes: SAMPLE_NOTE + ' Currently running the demo bench rig (demo sample).',
    }),
    base({
      id: 'demo-sample-18650', name: '18650 Li-ion cells (demo sample)', category: 'battery',
      reality: 'real', quantity: 5, condition: 'used', stock_location: 'Demo shelf',
      createdAt: '2026-10-09T09:30:00.000Z',
      specs: { chemistry: 'liion', voltage_v: 3.7 },
      notes: SAMPLE_NOTE + ' One cell retired early (demo sample history).',
    }),
    /* Tools · sim-only + real samples, so both sections show the split. */
    simFromCatalog('lipo_balance_charger', 'tool', 1, {
      createdAt: '2026-10-19T08:40:00.000Z',
    }),
    base({
      id: 'demo-sample-soldering', name: 'Soldering station (demo sample)', category: 'tool',
      reality: 'real', quantity: 1, condition: 'used', stock_location: 'Demo bench',
      createdAt: '2026-09-28T15:10:00.000Z',
      notes: SAMPLE_NOTE,
    }),
    base({
      id: 'demo-sample-calipers', name: 'Digital calipers (demo sample)', category: 'tool',
      reality: 'real', quantity: 1, condition: 'used', stock_location: 'Demo bench',
      createdAt: '2026-10-21T12:00:00.000Z',
      notes: SAMPLE_NOTE,
    }),
    base({
      id: 'demo-sample-gluegun', name: 'Hot glue gun (demo sample)', category: 'tool',
      reality: 'real', quantity: 1, condition: 'used', stock_location: 'Demo bench',
      createdAt: '2026-10-05T17:25:00.000Z',
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

/* Seed every demo twin. The Garage robots are demo copies of
 * Robodex robots with their recorded specs (static assets — no
 * Worker call); a spec that can't load just means that robot
 * isn't seeded. */
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
  const robots: GarageRobot[] = [];

  const burgerSpec = await fetchSpec('turtlebot3-burger.json');
  if (burgerSpec) {
    robots.push({
      id: 'demo-turtlebot3-burger',
      name: 'TurtleBot3 Burger (demo)',
      createdAt: '2026-10-12T09:00:00.000Z',
      versions: [
        {
          id: 'demo-turtlebot3-burger-v1',
          label: 'Baseline',
          note: 'Demo copy of the Robodex catalogue robot, with its recorded spec. Play freely — your real robots are untouched.',
          source: 'robodex',
          createdAt: '2026-10-12T09:00:00.000Z',
          spec: burgerSpec,
        },
        {
          id: 'demo-turtlebot3-burger-v2',
          label: 'Planned — RPLIDAR + Jetson upgrade',
          note: 'PLANNED — not built, and nothing here is fitted. The plan: add the RPLIDAR A1 and swap the controller for a Jetson Orin Nano, both sim-only catalogue parts in the demo inventory. The spec is still the baseline robot, because the upgrade exists only on this list.',
          source: 'edit',
          planned: true,
          createdAt: '2026-10-30T18:30:00.000Z',
          spec: burgerSpec,
        },
      ],
    });
  }

  const pathfinderSpec = await fetchSpec('pathfinder.json');
  if (pathfinderSpec) {
    /* Build history: the first version is the same recorded spec
     * with the one field the story changes — the wheels it was
     * first built on. The current version is the recorded spec
     * itself, untouched. */
    const firstBuildSpec = {
      ...pathfinderSpec,
      wheel: { ...(pathfinderSpec.wheel as Record<string, unknown>), diameter_m: 0.066 },
    };
    robots.push({
      id: 'demo-pathfinder',
      name: 'Pathfinder (demo)',
      createdAt: '2026-10-18T10:15:00.000Z',
      versions: [
        {
          id: 'demo-pathfinder-v1',
          label: 'First build — 66 mm wheels',
          note: 'Demo sample build history: as first put together, on 66 mm wheels.',
          source: 'edit',
          createdAt: '2026-10-18T10:15:00.000Z',
          spec: firstBuildSpec,
        },
        {
          id: 'demo-pathfinder-v2',
          label: '100 mm wheels',
          note: 'Swapped to the 100 mm catalogue wheels — the four sim-only Wheel 100 mm in the demo inventory. This version is the recorded Robodex spec, unchanged.',
          source: 'robodex',
          createdAt: '2026-10-25T16:45:00.000Z',
          spec: pathfinderSpec,
        },
      ],
    });
  }

  writeIfAbsent(garageKey, robots);
}
