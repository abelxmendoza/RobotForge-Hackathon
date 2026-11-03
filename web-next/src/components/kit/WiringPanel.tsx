'use client';
/* The Wiring panel: the build list's schematic wiring, under the
 * Kit stage. It carries the wiring table (the same rows the chat
 * quotes and the BOM export prints as its harness section), the
 * recorded-data checks, and the honesty notes the feature stands
 * on: ports exist only where the catalogue records them, and the
 * 3D routing is a diagram, not a measurement. Styling rides the
 * kit page's scoped stylesheet (.kitpage in KitViewer). */
import { PART_GROUPS, partGroup } from '@/lib/partTaxonomy';
import type { BuildEntry, PaletteItem } from '@/lib/palette';
import type { Part } from '@/lib/types';
import {
  noPortReason,
  portsByEntry,
  resolveConnections,
  wiringChecks,
  wiringRows,
  type BuildWiring,
} from '@/lib/buildWiring';

const TYPE_DOT: Record<string, string> = {
  power: '#ef4444',
  data: '#38bdf8',
  signal: '#facc15',
};

export default function WiringPanel({
  entries,
  items,
  partsById,
  wiring,
  pendingLabel,
  selectedConn,
  note,
  sceneActive,
  onSelectConn,
  onDeleteConn,
  onCancelPending,
}: {
  entries: BuildEntry[];
  items: PaletteItem[];
  partsById: Map<string, Part>;
  wiring: BuildWiring;
  /** Label of the port waiting for its other end, if any. */
  pendingLabel: string | null;
  selectedConn: string | null;
  note: string | null;
  sceneActive: boolean;
  onSelectConn: (id: string | null) => void;
  onDeleteConn: (id: string) => void;
  onCancelPending: () => void;
}) {
  const byKey = new Map(items.map((i) => [i.key, i]));
  const nameOf = (e: BuildEntry) => {
    const base = byKey.get(`${e.kind}:${e.refId}`)?.name ?? e.refId;
    return e.kind === 'catalog-part' && e.qty > 1 ? `${base} ×${e.qty}` : base;
  };
  const byUid = portsByEntry(entries, partsById);
  const rows = wiringRows(entries, wiring, partsById, nameOf);
  const checks = wiringChecks(entries, wiring, partsById, nameOf);
  const resolved = resolveConnections(entries, wiring, partsById);

  return (
    <div className="box wire-panel" style={{ marginTop: 14 }}>
      <h3 style={{ marginTop: 0 }}>Wiring — your build list</h3>
      <p className="wire-badge">
        <b>Schematic wiring</b> — routing and port positions are
        diagrammatic, not measured. Ports come only from recorded
        catalogue data (interfaces, voltages, supply lines); a part
        with no recorded interface data has no ports, and the checks
        below abstain where the data is silent.
      </p>
      <p className="wire-legend">
        <span><i style={{ background: TYPE_DOT.power }} /> Power</span>
        <span><i style={{ background: TYPE_DOT.data }} /> Data</span>
        <span><i style={{ background: TYPE_DOT.signal }} /> Signal</span>
        <span className="dim">
          {sceneActive
            ? 'Click a port marker in the 3D view, then a compatible port on another device. Click a cable to select it.'
            : 'The 3D stage is not loaded — the table and checks still work, and the chat can wire parts too (“wire the camera to the Orin”).'}
        </span>
      </p>
      {note && <p className="wire-note" role="status">{note}</p>}
      {pendingLabel && (
        <p className="wire-note" role="status">
          Port selected: <b>{pendingLabel}</b> — now click a compatible
          port on another device.{' '}
          <button type="button" onClick={onCancelPending}>Cancel</button>
        </p>
      )}
      {!entries.length && (
        <p>
          Your build list is empty. Add parts from the Parts palette
          (or ask in chat), then wire them here.
        </p>
      )}
      {PART_GROUPS.map((group) => {
        const devices = entries.filter((e) => {
          const item = byKey.get(`${e.kind}:${e.refId}`);
          return partGroup(item?.part?.part_class ?? '', item?.name ?? e.refId) === group.id;
        });
        if (!devices.length) return null;
        return (
          <details key={group.id} open>
            <summary><strong>{group.label} ({devices.length})</strong></summary>
            {devices.map((e) => (
              <p key={e.uid} className="wire-device">
                <b>{nameOf(e)}</b>{' '}
                {(byUid.get(e.uid) ?? []).length ? (
                  <span className="dim">{(byUid.get(e.uid) ?? []).map((p) => p.label).join(' · ')}</span>
                ) : (
                  <span className="dim">no ports: {noPortReason(e, partsById)}</span>
                )}
              </p>
            ))}
          </details>
        );
      })}
      {rows.length > 0 && (
        <table className="wire-table">
          <thead>
            <tr>
              <th>From</th>
              <th>To</th>
              <th>Type</th>
              <th aria-label="actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                className={selectedConn === r.id ? 'sel' : undefined}
                onClick={() => onSelectConn(selectedConn === r.id ? null : r.id)}
              >
                <td>{r.fromName} <span className="dim">[{r.fromPortLabel}]</span></td>
                <td>{r.toName} <span className="dim">[{r.toPortLabel}]</span></td>
                <td>
                  <i className="wire-dot" style={{ background: TYPE_DOT[r.type] }} />{' '}
                  {r.type}
                </td>
                <td>
                  <button
                    type="button"
                    aria-label={`Remove cable ${r.fromName} to ${r.toName}`}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onDeleteConn(r.id);
                    }}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {entries.length > 0 && (
        <div className="wire-checks">
          <h4>
            Checks — {resolved.length} cable{resolved.length === 1 ? '' : 's'}
          </h4>
          {checks.issues.length ? (
            checks.issues.map((i, n) => (
              <p key={n} className="wire-issue">
                ⚠ <b>{i.message}</b> — {i.evidence}.
              </p>
            ))
          ) : (
            <p>No problems found by the recorded-data checks.</p>
          )}
          {checks.abstentions.map((a, n) => (
            <p key={n} className="dim">Not checked: {a}.</p>
          ))}
        </div>
      )}
    </div>
  );
}
