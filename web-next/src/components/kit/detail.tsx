'use client';
/* The take-apart detail panel — the React equivalent of robot.js's
 * taSelect / taElecSection / taSelectNode / taWireInfo content.
 * Everything shown comes from the spec and the recorded wiring:
 * requirements, voltages and ratings are the spec's own fields and
 * the parts catalogue's datasheet specs. */
import type { ReactNode } from 'react';
import { ROOT } from '../forge/model';
import type { RobotSpec, WiringBlock, WiringNode } from '../forge/model';
import type { TaPart } from './takeapart';
import {
  TA_SPOTS,
  elecBad,
  elecConnLabel,
  elecNodeMap,
  elecNodeStatus,
  elecVolts,
} from './takeapart';

export function elecFacts(w: WiringBlock, node: WiringNode) {
  const nodes = elecNodeMap(w);
  const st = elecNodeStatus(w, node.id);
  const feedNodes: ReactNode[] = st.feeds.map((c, i) => (
    <span key={i}>
      {i > 0 && <br />}
      {nodes[c.from] ? nodes[c.from].label : c.from} ·{' '}
      {c.volts != null ? elecVolts(c.volts) : c.label || 'no fixed voltage'}
    </span>
  ));
  let status: ReactNode;
  if (st.state === 'bad') {
    status = (
      <span className="elec-bad">
        Over-voltage — a recorded feed exceeds this part’s rated maximum.
      </span>
    );
  } else if (st.state === 'ok') {
    status = (
      <span className="elec-ok">Within rating on the recorded values.</span>
    );
  } else {
    status = (
      <span className="elec-unchecked">Not checked — {st.reason}.</span>
    );
  }
  return { feed: feedNodes, hasFeed: st.feeds.length > 0, status };
}

export function TaElecSection({
  spec,
  partId,
}: {
  spec: RobotSpec;
  partId: string;
}) {
  const w = spec.wiring;
  if (!w) return null;
  const node = w.nodes.find((n) => n.kit === partId);
  if (!node) {
    return (
      <>
        <dt>Electrical</dt>
        <dd>No electrical requirement — a mechanical part.</dd>
      </>
    );
  }
  const f = elecFacts(w, node);
  return (
    <>
      <dt>Electrical</dt>
      <dd>
        Needs: {node.req_label}
        <br />
        Supplied by: {f.hasFeed ? f.feed : 'nothing recorded'}
        <br />
        Status: {f.status}
      </dd>
    </>
  );
}

export function TaPartDetail({
  spec,
  part,
}: {
  spec: RobotSpec;
  part: TaPart;
}) {
  const p = part;
  return (
    <>
      <span className="qty">
        {p.file
          ? `Qty ${p.qty} · ${p.file}`
          : `Qty ${p.qty} · schematic part — the real robot’s layout, not a kit file`}
      </span>
      <h3>{p.name}</h3>
      {TA_SPOTS.includes(p.id) && (
        <>
          <img
            className="spot"
            src={`${ROOT}assets/img/parts/${p.id}.jpg`}
            alt={`AI illustration of the ${p.name}`}
            loading="lazy"
          />
          <p className="faint" style={{ fontSize: 12, marginTop: 6 }}>
            AI illustration (muse-image-1.0). The printable part itself comes
            from <code>robotforge cad</code>.
          </p>
        </>
      )}
      <dl>
        <dt>What it is</dt>
        <dd>{p.does}</dd>
        <dt>Key dimensions</dt>
        <dd className="m">{p.dims}</dd>
        <dt>Beginner tweak</dt>
        <dd>{p.tweak}</dd>
        <dt>{p.file ? 'Print note' : 'Note'}</dt>
        <dd>{p.print}</dd>
        <TaElecSection spec={spec} partId={p.id} />
      </dl>
      {p.file ? (
        <p
          className="faint"
          style={{ marginTop: 14, fontSize: 'var(--fs-xs)' }}
        >
          This part is one file in the take-apart kit. Open{' '}
          <code>{p.file}</code> in OpenSCAD (or FreeCAD) to edit just this part
          — the assembly picks up your change.
        </p>
      ) : (
        <p
          className="faint"
          style={{ marginTop: 14, fontSize: 'var(--fs-xs)' }}
        >
          A schematic part derived from the spec — this class has no printable
          kit yet, so there is no file to open. The dimensions above are the
          spec’s own numbers.
        </p>
      )}
    </>
  );
}

export function TaNodeDetail({
  spec,
  nodeId,
}: {
  spec: RobotSpec;
  nodeId: string;
}) {
  const w = spec.wiring as WiringBlock;
  const node = elecNodeMap(w)[nodeId];
  if (!node) return null;
  const f = elecFacts(w, node);
  const conns = w.connections
    .map((c, i) => (c.from === nodeId || c.to === nodeId ? elecConnLabel(w, i) : null))
    .filter(Boolean) as string[];
  return (
    <>
      <span className="qty">Electrical component</span>
      <h3>{node.label}</h3>
      <dl>
        <dt>Electrical requirement</dt>
        <dd className="m">{node.req_label}</dd>
        <dt>Supplied by</dt>
        <dd>{f.hasFeed ? f.feed : '— (it is a source)'}</dd>
        <dt>Status</dt>
        <dd>{f.status}</dd>
        <dt>Connections</dt>
        <dd>
          {conns.map((c, i) => (
            <span key={i}>
              {i > 0 && <br />}
              {c}
            </span>
          ))}
        </dd>
      </dl>
      <p className="faint" style={{ marginTop: 14, fontSize: 'var(--fs-xs)' }}>
        Requirements and voltages are the recorded ones — the spec’s own fields
        and the parts catalog’s datasheet specs. “Not specified” means the data
        names none.
      </p>
    </>
  );
}

export function wireInfoText(spec: RobotSpec, i: number): ReactNode {
  const w = spec.wiring as WiringBlock;
  if (!w || !w.connections[i]) return null;
  return (
    <>
      {elecConnLabel(w, i)}
      {elecBad(w).has(i) && (
        <strong className="elec-bad">
          {' '}
          — over-voltage: above the target’s recorded rated maximum.
        </strong>
      )}
    </>
  );
}

export const WIRE_INFO_DEFAULT =
  'Hover or click a connection to read it; click a component chip for its requirement and status.';
