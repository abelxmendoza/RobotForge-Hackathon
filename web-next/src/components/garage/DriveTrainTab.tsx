'use client';
/* Workshop "Drive train" tab (Abel, 2026-11-10): how the robot's
 * motors turn into motion, for every wheeled robot — the layout seen
 * from above, the wheels and motors, the gearing, and the free speed
 * and pushing force those give. For VEX V5 robots (spec.gearing
 * .platform === 'vex_v5') the cartridge, gear teeth and motor type can
 * be changed to see the speed/torque trade before applying it to the
 * draft, and the drive motors are counted against the V5RC motor
 * power cap. Every number comes from lib/drivetrain.ts on the spec's
 * own fields; missing inputs are named, never guessed. */
import { useEffect, useMemo, useState } from 'react';
import VexModel3D from './VexModel3D';
import type { Spec } from '@/lib/garage';
import {
  applyGearing, ASSUMED_TRACTION_MU, currentVexChoice, driveLayout, driveNumbers, isVexV5, readGearing,
  v5rcBudget, V5_CARTRIDGES, V5_MOTOR_POWERS_W, VEX_GEAR_TEETH, vexGearing, type DriveLayout, type VexChoice,
} from '@/lib/drivetrain';

const fmt = (v: number | null | undefined, digits = 2, unit = '') => (v == null ? '—' : `${Number(v.toFixed(digits))}${unit ? ' ' + unit : ''}`);

function TopView({ layout, spec }: { layout: DriveLayout; spec: Spec }) {
  const L = Number(spec?.length_m) || 0.4, W = Number(spec?.width_m) || 0.3;
  const dia = Number(spec?.wheel?.diameter_m) || 0.08, ww = Number(spec?.wheel?.width_m) || 0.025;
  const scale = 150 / Math.max(L, W);
  const cx = 110, cy = 100;
  return (
    <svg className="dt-top" viewBox="0 0 220 200" role="img" aria-label={`${layout.label}, seen from above. Filled wheels are driven.`}>
      <rect x={cx - (W * scale) / 2} y={cy - (L * scale) / 2} width={W * scale} height={L * scale} rx="6" className="dt-body" />
      <path d={`M${cx} ${cy - (L * scale) / 2 + 10} l-7 12 h14z`} className="dt-front" />
      {layout.wheels.map((w, i) => {
        /* robot +x (forward) is up the page, robot +y (left) is left on the page;
         * each wheel sits just outside its side of the body */
        const wpx = Math.max(4, ww * scale);
        const x = w.side === 'left' ? cx - w.y * scale - wpx - 2 : cx - w.y * scale + 2;
        return <rect key={i} x={x} y={cy - w.x * scale - (dia * scale) / 2} width={wpx} height={dia * scale} rx="2" className={w.driven ? 'dt-wheel driven' : 'dt-wheel'} />;
      })}
      {layout.kind === 'differential' && <circle cx={cx} cy={cy + (L * scale) / 2 - 10} r="5" className="dt-wheel" />}
    </svg>
  );
}

export default function DriveTrainTab({ spec, onApply }: { spec: Spec; onApply: (next: Spec) => void }) {
  const layout = useMemo(() => driveLayout(spec), [spec]);
  const nums = useMemo(() => driveNumbers(spec), [spec]);
  const vex = isVexV5(spec);
  const gearing = readGearing(spec);
  const [choice, setChoice] = useState<VexChoice>(() => currentVexChoice(spec));
  /* The Garage can mount this tab before the selected robot's draft
   * arrives, and the draft can change under it (Apply, a version load,
   * an edit elsewhere). Whenever the recorded setup changes, the
   * controls start again from it, so one robot's choice never shows
   * as pending changes on another. */
  const recordedKey = JSON.stringify(currentVexChoice(spec));
  useEffect(() => { setChoice(JSON.parse(recordedKey) as VexChoice); }, [recordedKey]);
  const [otherW, setOtherW] = useState(0);
  const whatIf = useMemo(() => vexGearing(choice), [choice]);
  const after = useMemo(() => driveNumbers(spec, whatIf), [spec, whatIf]);
  const budget = v5rcBudget(spec, otherW, vex ? { motorPowerW: choice.motorPowerW } : undefined);
  const now = currentVexChoice(spec);
  const changed = vex && JSON.stringify(now) !== JSON.stringify(choice);

  if (!layout) {
    return (
      <section className="dt-tab" aria-labelledby="dt-title">
        <h3 id="dt-title">Drive train</h3>
        <p>This robot has no wheeled drive train in its spec ({String(spec?.drivetrain ?? 'no drivetrain').replace(/_/g, ' ')}{spec?.wheel?.count ? '' : ', no wheels recorded'}). Drive train numbers are for wheeled and tracked robots.</p>
      </section>
    );
  }

  const motorCount = Number(spec?.motor?.count) || 0;
  const row = (label: string, value: string, next?: string) => (
    <tr><th scope="row">{label}</th><td>{value}</td>{vex && <td className={next && next !== value ? 'dt-changed' : ''}>{next ?? value}</td>}</tr>
  );

  return (
    <section className="dt-tab" aria-labelledby="dt-title">
      <div className="dt-head">
        <div>
          <span className="eyebrow">Drive train</span>
          <h3 id="dt-title">{layout.label}{vex && <span className="fbadge dt-vex">VEX V5</span>}</h3>
          <p className="faint">{layout.steering}</p>
        </div>
      </div>

      {vex && <VexModel3D spec={changed ? applyGearing(spec, whatIf) : spec} label={String(spec?.name ?? 'VEX robot')} height={260} caption={changed ? '3D 360° with your changes · drag to turn · drawn from the spec’s numbers, not CAD' : '3D 360° · drag to turn · drawn from the spec’s numbers, not CAD'} />}

      <div className="dt-grid">
        <figure className="dt-figure">
          <TopView layout={layout} spec={spec} />
          <figcaption className="faint g-small">Seen from above, front at the top. Filled wheels are driven ({Math.min(motorCount, layout.wheels.length)} of {layout.wheels.length}).</figcaption>
        </figure>

        <div>
          <table className="dt-table">
            {vex && <thead><tr><th /><th scope="col">Now</th><th scope="col">With your changes</th></tr></thead>}
            <tbody>
              {row('Wheels', `${layout.wheels.length} × ${fmt((Number(spec?.wheel?.diameter_m) || 0) * 1000, 0, 'mm')}`)}
              {row('Drive motors', vex ? `${motorCount} × V5 ${now.motorPowerW} W` : `${motorCount || '—'}${spec?.motor?.kind ? ' × ' + String(spec.motor.kind).replace(/_/g, ' ') : ''}`, vex ? `${motorCount} × V5 ${choice.motorPowerW} W` : undefined)}
              {row('Gearing (motor : wheel)', gearing ? `${gearing.drivingTeeth}:${gearing.drivenTeeth}` : 'direct (not recorded)', vex ? `${choice.drivingTeeth}:${choice.drivenTeeth}` : undefined)}
              {row('Wheel speed, no load', fmt(nums.wheelRpm, 0, 'rpm'), vex ? fmt(after.wheelRpm, 0, 'rpm') : undefined)}
              {row('Top speed, no load', fmt(nums.freeSpeedMps, 2, 'm/s'), vex ? fmt(after.freeSpeedMps, 2, 'm/s') : undefined)}
              {row('Torque per motor at the wheel', fmt(nums.wheelStallNm, 3, 'N·m'), vex ? fmt(after.wheelStallNm, 3, 'N·m') : undefined)}
              {row('Push at stall (all motors)', fmt(nums.stallPushN, 1, 'N'), vex ? fmt(after.stallPushN, 1, 'N') : undefined)}
              {row('Push before the wheels slip', fmt(nums.tractionPushN, 1, 'N'), vex ? fmt(after.tractionPushN, 1, 'N') : undefined)}
            </tbody>
          </table>
          {nums.pushLimitedBy && (
            <p className="g-small">{nums.pushLimitedBy === 'traction'
              ? 'The wheels slip before the motors stall: in a pushing match, more torque will not help; more weight on the driven wheels or grippier wheels will.'
              : 'The motors stall before the wheels slip: gearing down (or more motors) gives more pushing force, at the cost of speed.'}</p>
          )}
          {nums.torqueMismatch && (
            <p className="g-small" role="alert"><span className="fbadge planned">Check</span> The gearing gives {fmt(nums.torqueMismatch.fromGearing, 3, 'N·m')} at the wheel, but the spec records {fmt(nums.torqueMismatch.recorded, 3, 'N·m')}. The Test tab's torque checks use the recorded number.</p>
          )}
          {nums.missing.length > 0 && <p className="faint g-small">Not recorded, so not computed: {nums.missing.join(', ')}.</p>}
          {layout.twinWheelNote && <p className="faint g-small">{layout.twinWheelNote}</p>}
          <p className="faint g-small">Free speed is with no load; a robot under load is slower. Pushing force uses the stall torque, and the slip limit assumes floor grip μ = {ASSUMED_TRACTION_MU} with weight spread evenly over the wheels. These are estimates from the spec, not measurements.</p>
        </div>
      </div>

      {vex && (
        <div className="dt-vex-panel">
          <h4>Try a different VEX setup</h4>
          <div className="dt-controls">
            <label>Motor
              <select value={choice.motorPowerW} onChange={(e) => setChoice({ ...choice, motorPowerW: Number(e.target.value) })}>
                {V5_MOTOR_POWERS_W.map((w) => <option key={w} value={w}>V5 Smart Motor {w} W</option>)}
              </select>
            </label>
            <label>Cartridge
              <select value={choice.cartridgeId} disabled={choice.motorPowerW === 5.5} onChange={(e) => setChoice({ ...choice, cartridgeId: e.target.value })}>
                {V5_CARTRIDGES.map((c) => <option key={c.id} value={c.id}>{c.label}: {c.freeRpm} rpm, {c.ratio}</option>)}
              </select>
            </label>
            <label>Gear on the motor
              <select value={choice.drivingTeeth} onChange={(e) => setChoice({ ...choice, drivingTeeth: Number(e.target.value) })}>
                {[1, ...VEX_GEAR_TEETH].map((t) => <option key={t} value={t}>{t === 1 ? 'Direct drive' : `${t} teeth`}</option>)}
              </select>
            </label>
            <label>Gear on the wheel
              <select value={choice.drivenTeeth} onChange={(e) => setChoice({ ...choice, drivenTeeth: Number(e.target.value) })}>
                {[1, ...VEX_GEAR_TEETH].map((t) => <option key={t} value={t}>{t === 1 ? 'Direct drive' : `${t} teeth`}</option>)}
              </select>
            </label>
          </div>
          {choice.motorPowerW === 5.5 && <p className="faint g-small">The 5.5 W motor has a fixed 200 rpm output; its torque here is estimated as half the 11 W motor&apos;s green-cartridge rating.</p>}
          {(choice.drivingTeeth === 1) !== (choice.drivenTeeth === 1) && <p className="g-small" role="alert"><span className="fbadge planned">Check</span> Pick a gear on both the motor and the wheel, or direct drive for both.</p>}
          <div className="dt-actions">
            <button type="button" className="btn btn-primary btn-sm" disabled={!changed || (choice.drivingTeeth === 1) !== (choice.drivenTeeth === 1)} onClick={() => onApply(applyGearing(spec, whatIf))}>Use this setup in the draft</button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={!changed} onClick={() => setChoice(now)}>Reset</button>
          </div>

          {budget && (
            <div className="dt-budget">
              <h4>V5RC motor power</h4>
              <p className="g-small">Competition robots may use up to {budget.capW} W of motor power in total (V5RC rule since 2024-25; check the current game manual).</p>
              <label className="g-small">Other motors on the robot (intake, lift and so on)
                <select value={otherW} onChange={(e) => setOtherW(Number(e.target.value))}>
                  {[0, 5.5, 11, 16.5, 22, 27.5, 33, 38.5, 44].map((w) => <option key={w} value={w}>{w} W</option>)}
                </select>
              </label>
              <div className="dt-meter" role="meter" aria-valuemin={0} aria-valuemax={budget.capW} aria-valuenow={budget.usedW} aria-label="Motor power used">
                <span className="dt-meter-drive" style={{ width: `${Math.min(100, (budget.driveW / budget.capW) * 100)}%` }} />
                <span className="dt-meter-other" style={{ width: `${Math.min(100 - Math.min(100, (budget.driveW / budget.capW) * 100), (budget.otherW / budget.capW) * 100)}%` }} />
              </div>
              <p className={'g-small ' + (budget.ok ? '' : 'g-error')}>
                Drive {budget.driveW} W + other {budget.otherW} W = {budget.usedW} W of {budget.capW} W.{' '}
                {budget.ok ? `${budget.leftW} W left (${Math.floor(budget.leftW / 11)} more 11 W motor${Math.floor(budget.leftW / 11) === 1 ? '' : 's'}, or ${Math.floor(budget.leftW / 5.5)} × 5.5 W).` : `Over the cap by ${-budget.leftW} W: this robot would not pass inspection.`}
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
