"use client";

import type { Spec } from "@/lib/garage";
import { simulationIssues, type Scenario } from "@/lib/simulation";
import {
  ASSUMED_ACCEL_MPS2, ASSUMED_ROLLING_RESISTANCE, SIM_TYRE_FRICTION,
  SIM_USABLE_STALL_FRACTION, driveAnalysis, stepAssessment,
  type DriveSpec, type TorqueBand,
} from "@/lib/driveMath";

/* The prediction half of the drive sandbox: what the spec's own
 * numbers say a manoeuvre costs, computed before — and independently
 * of — the Rapier run above it. A computation on declared figures
 * (mass, wheel size, motor count, stall torque), not a measurement
 * and not a gate verdict. The sandbox's two hard limits (tyre
 * friction, usable torque as a fraction of stall) are the same
 * constants the sandbox itself imports, so this panel can never
 * quietly drift away from the simulation it describes. */

const BAND_TEXT: Record<TorqueBand, string> = {
  "within-usable": "within the sandbox's usable torque",
  "above-usable":
    "past the sandbox's usable cap — under stall, but the simulated motors will not apply it, and a real motor near stall barely turns",
  "beyond-stall": "beyond stall torque — no state of these motors produces it",
};

export default function DriveAnalysis({ spec, scenario }: { spec: Spec; scenario: Scenario }) {
  if (simulationIssues(spec).length) return null;
  const d: DriveSpec = {
    massKg: spec.mass_kg,
    wheelRadiusM: spec.wheel.diameter_m / 2,
    wheelCount: spec.wheel.count,
    motorCount: spec.motor.count,
    stallTorqueNm: spec.motor.stall_torque_nm,
  };
  const a = driveAnalysis(d);
  const step = scenario === "obstacle" ? stepAssessment(d.wheelRadiusM, 0.03) : null;
  return (
    <section className="sim-physics" aria-label="Drive analysis">
      <div className="sim-physics-head">
        <div>
          <h4>Drive analysis</h4>
          <p className="faint g-small">
            Computed from the spec&apos;s declared numbers — the demand each
            manoeuvre places on the motors, before the simulation runs.
          </p>
        </div>
        <span className="fbadge local">LOCAL</span>
      </div>
      <div className="table-scroll" style={{ marginTop: 8 }}>
        <table className="data">
          <thead>
            <tr>
              <th>Manoeuvre</th>
              <th>Torque needed per motor</th>
              <th>Of stall</th>
              <th>Verdict</th>
            </tr>
          </thead>
          <tbody>
            {a.cases.map((c) => (
              <tr key={c.id}>
                <td>{c.label}</td>
                <td className="num">{c.torquePerMotorNm.toFixed(3)} N·m</td>
                <td className="num">{c.pctOfStall.toFixed(0)}%</td>
                <td>{BAND_TEXT[c.band]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ marginTop: 8 }}>
        Traction, accelerating up the ramp: the driven wheels must find a
        friction coefficient of <strong>{a.traction.requiredMu.toFixed(2)}</strong>{" "}
        against the sandbox floor&apos;s <strong>{SIM_TYRE_FRICTION}</strong> —{" "}
        {a.traction.ok ? (
          <>the tyres hold.</>
        ) : (
          <><strong>the tyres slip first</strong>: the wheels spin before the
          motors reach their torque limit.</>
        )}
      </p>
      {step ? (
        <p style={{ marginTop: 8 }}>
          The obstacle is a {(step.stepM * 1000).toFixed(0)} mm step against a{" "}
          {(d.wheelRadiusM * 1000).toFixed(0)} mm wheel radius —{" "}
          <strong>{(step.ratioToRadius * 100).toFixed(0)}% of the radius</strong>.{" "}
          {step.rollsQuasiStatically ? (
            <>Geometry allows a wheel to roll over a step below its own radius,
            though the torque it takes climbs steeply as the step approaches
            the radius.</>
          ) : (
            <>At or above the wheel&apos;s radius no finite torque rolls a wheel
            up a step quasi-statically — crossing it would take momentum,
            which this analysis does not model.</>
          )}
        </p>
      ) : null}
      <p className="prov" style={{ marginTop: 8 }}>
        <span>
          Assumptions, printed rather than buried: acceleration demand{" "}
          {ASSUMED_ACCEL_MPS2} m/s²; rolling resistance{" "}
          {ASSUMED_ROLLING_RESISTANCE}; weight spread evenly over the wheels,
          so the {d.motorCount} driven wheel{d.motorCount > 1 ? "s" : ""} carry{" "}
          {Math.round(a.traction.drivenWeightFraction * 100)}% of it and the
          load splits evenly between motors; the sandbox caps its motors at{" "}
          {Math.round(SIM_USABLE_STALL_FRACTION * 100)}% of the recorded stall
          torque ({d.stallTorqueNm} N·m), which is the cap the verdicts above
          are read against.
        </span>
      </p>
    </section>
  );
}
