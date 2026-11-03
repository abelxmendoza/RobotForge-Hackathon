'use client';
/* Omega1's digital twin, as a built-in Garage specimen.
 *
 * The honesty rules for this surface (lib/omega1Twin.ts):
 *  - the twin is ProjectSim-generated; its geometry, scale and
 *    physics values are ESTIMATES, labelled wherever they appear;
 *  - facts about the real robot come from its own records only;
 *  - the part models are separate reconstructions — a gallery,
 *    never a fitted assembly — and the one board no record names
 *    was not generated at all. */
import { useState } from 'react';
import { assetPath } from '@/components/home/asset';
import TwinView from './TwinView';
import {
  OMEGA1_CHECK_LINES, OMEGA1_FACTS, TWIN_ESTIMATE_NOTE, TWIN_LABEL, TWIN_NOT_GENERATED,
  omega1Parts, omega1Rover, twinSubjects,
} from '@/lib/omega1Twin';

/* The Workshop's nine tabs, mirrored here: Garage owns the tab state
 * while the twin is open (its tab bar controls this component), and
 * each tab below renders one pane from the twin's records only. */
export type TwinTab = 'overview' | 'build' | 'wiring' | 'specs' | 'simulate' | 'checks' | 'bom' | 'tools' | 'history';

export default function Omega1Twin({ tab = 'overview', garageScans = null, onOpenGarage, onAdopt }: {
  tab?: TwinTab;
  /* Scans attached to the owner's own stored Omega1 in the Garage:
   * null = no stored copy exists yet; otherwise the count (0 or 1,
   * a robot carries one scan). The twin itself stays a fixed,
   * estimated specimen — the stored copy is the one that improves. */
  garageScans?: number | null;
  onOpenGarage?: () => void;
  onAdopt?: () => void;
}) {
  const [subjectId, setSubjectId] = useState(omega1Rover.id);
  const subject = twinSubjects.find((s) => s.id === subjectId) ?? omega1Rover;
  const isRover = subject.id === omega1Rover.id;

  return (
    <section className="twin" aria-label="Omega1 digital twin">
      <div className="twin-head">
        <h2>Omega1 <span className="faint">— digital twin</span></h2>
        <span className="fbadge live">Built-in specimen</span>
        <span className="fbadge planned">{TWIN_LABEL}</span>
      </div>
      <p className="sub">
        Abel’s own rover, reconstructed as a 3D twin by ProjectSim (Kaedim) on 2026-11-01 from a photo of the
        real robot. {TWIN_ESTIMATE_NOTE} The measured record for the real robot is its measuring worksheet
        (docs/omega1/MEASURE.md) — nothing here replaces a tape measure.
      </p>

      {tab === 'overview' && (
      <>
      <div className="twin-garage-link">
        {garageScans !== null ? (
          <>
            <p>
              <strong>Your Omega1 in the Garage</strong> — {garageScans} scan(s) attached. That stored
              copy is yours to make accurate: attach a Scaniverse or RealSense scan there, apply its
              measured size, and keep its wiring map current. This twin stays the estimated specimen.
              The <strong>Improve this twin</strong> card at the top of its Overview walks you through
              the scans, the measurements and the wiring, one step at a time.
            </p>
            <button type="button" className="btn btn-sm" onClick={onOpenGarage}>Open your Omega1</button>
          </>
        ) : (
          <>
            <p>
              <strong>This twin is a built-in specimen</strong> — fixed, and estimated. Add Omega1 to
              your Garage and you get your own stored copy, seeded from its records (DOCUMENTED fields
              only — sizes and mass stay blank until you measure them or apply a scan). On that copy
              you can attach scans and build the real wiring map.
            </p>
            <button type="button" className="btn btn-primary btn-sm" onClick={onAdopt}>Add Omega1 to your Garage</button>
          </>
        )}
      </div>
      <div className="twin-subjects" role="group" aria-label="Twin subjects">
        {twinSubjects.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={s.id === subject.id}
            className="chip"
            onClick={() => setSubjectId(s.id)}
          >
            {s.id === omega1Rover.id ? 'Whole rover' : s.name}
          </button>
        ))}
      </div>

      <TwinView key={subject.id} subject={subject} explode={isRover} />

      <div className="twin-cols">
        <section aria-label="About this subject">
          <h3>{subject.name}</h3>
          <p>{subject.role}</p>
          <p className="faint g-small"><strong>Record basis:</strong> {subject.basis}</p>
          {subject.countNote && <p className="faint g-small">{subject.countNote}</p>}
          <h4>Physics — ProjectSim estimates, not measurements</h4>
          <ul className="twin-physics">
            {subject.physics.map((p) => (
              <li key={p.label}><span className="faint">{p.label}</span> {p.value}</li>
            ))}
          </ul>
          {isRover && (
            <p className="faint g-small">
              The explode slider separates only the rover model’s own links — chassis, sensor head and the
              four wheels. The part models below were reconstructed separately and are not fitted into it.
            </p>
          )}
        </section>

        <section aria-label="The real Omega1, from its records">
          <h3>The real Omega1 — from its records</h3>
          <ul className="twin-physics">
            {OMEGA1_FACTS.map((f) => (
              <li key={f.label}><span className="faint">{f.label}</span> {f.value}</li>
            ))}
          </ul>
          <p className="faint g-small">{TWIN_NOT_GENERATED}</p>
        </section>
      </div>

      <h3>The parts, one by one</h3>
      <p className="faint g-small">
        Each part was generated on its own (from a photo or a text description), so the six models are a
        gallery of separate reconstructions — not pieces of one fitted assembly.
      </p>
      <div className="twin-grid">
        {omega1Parts.map((p) => (
          <button key={p.id} type="button" className="twin-card" onClick={() => setSubjectId(p.id)} aria-pressed={p.id === subject.id}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={assetPath(p.preview)} alt={`Preview render of ${p.name} from the generator`} loading="lazy" />
            <strong>{p.name}</strong>
            <span className="faint g-small">{p.role}</span>
            <span className="fbadge planned">ESTIMATED</span>
          </button>
        ))}
      </div>
      </>
      )}

      {tab === 'build' && (
        <section aria-label="Omega1 build — the twin subjects as a gallery">
          <h3>The parts, as a build gallery</h3>
          <p className="faint g-small">
            Seven separate reconstructions — never a fitted assembly. {TWIN_ESTIMATE_NOTE} Each card is one
            generated model standing for a recorded part; the real robot was assembled from its kit, not
            from these models.
          </p>
          <div className="twin-grid">
            {twinSubjects.map((s) => (
              <article key={s.id} className="twin-card" style={{ cursor: 'default' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={assetPath(s.preview)} alt={`Preview render of ${s.name} from the generator`} loading="lazy" />
                <strong>{s.name}</strong>
                <span className="faint g-small">{s.role}</span>
                <span className="faint g-small"><strong>Record basis:</strong> {s.basis}</span>
                {s.countNote && <span className="faint g-small">{s.countNote}</span>}
                <span className="fbadge planned">ESTIMATED</span>
              </article>
            ))}
          </div>
          <div className="ta-twin-note">
            <h4>Take it apart, put it back</h4>
            <p className="faint g-small">
              The Take apart / Assemble diagram works on your own stored copy of Omega1, along the
              connections its record carries — this twin is a fixed specimen and stays assembled.
              {garageScans === null
                ? ' Adopt Omega1 into your Garage and its Build tab gets the diagram.'
                : ' Your stored copy’s Build tab has the diagram.'}
            </p>
            {garageScans === null ? (
              <button type="button" className="btn btn-sm" onClick={onAdopt}>Add Omega1 to your Garage</button>
            ) : (
              <button type="button" className="btn btn-sm" onClick={onOpenGarage}>Open your Omega1</button>
            )}
          </div>
        </section>
      )}

      {tab === 'wiring' && (
        <section aria-label="Omega1 wiring — the recorded chain in words">
          <h3>Power and signals, as recorded</h3>
          <p className="faint g-small">
            Only the links Omega1&apos;s own records support, written as a list. No wiring diagram is drawn
            and no connector is guessed — where a link rests on a part no record names, the link says so.
          </p>
          <ul className="twin-physics">
            <li>
              <span className="faint">Power</span> 2× 18650 cells in series, 7.4 V nominal → the
              motor-driver / expansion board <span className="fbadge live">Recorded</span>{' '}
              <span className="fbadge planned">Board not recorded</span>
            </li>
            <li>
              <span className="faint">Drive</span> The motor-driver / expansion board → 4× DC gearmotors,
              one per wheel (template motor block) <span className="fbadge live">Motors recorded</span>{' '}
              <span className="fbadge planned">Board not recorded</span>
            </li>
            <li>
              <span className="faint">Sense</span> Raspberry Pi 4B → HC-SR04 ultrasonic, front (kit
              documented) <span className="fbadge live">Recorded</span>
            </li>
            <li>
              <span className="faint">Sense</span> Raspberry Pi 4B → Pi Camera, front (kit documented){' '}
              <span className="fbadge live">Recorded</span>
            </li>
          </ul>
          <p className="faint g-small">{TWIN_NOT_GENERATED}</p>
        </section>
      )}

      {tab === 'specs' && (
        <section aria-label="Omega1 specs — from its records">
          <h3>The real Omega1 — from its records</h3>
          <ul className="twin-physics">
            {OMEGA1_FACTS.map((f) => (
              <li key={f.label}><span className="faint">{f.label}</span> {f.value}</li>
            ))}
          </ul>
          <h4>Twin estimates — ProjectSim, not measurements</h4>
          <p className="faint g-small">{TWIN_ESTIMATE_NOTE}</p>
          <ul className="twin-physics">
            {omega1Rover.physics.map((p) => (
              <li key={p.label}><span className="faint">{p.label}</span> {p.value}</li>
            ))}
          </ul>
        </section>
      )}

      {tab === 'simulate' && (
        <section aria-label="Omega1 simulate — not gated">
          <h3>Simulation</h3>
          <p>
            <span className="fbadge planned">NOT GATED</span> No recorded driving-gate run exists for
            Omega1 — it has never been put through the Workshop&apos;s driving test, and no result is
            claimed for it here.
          </p>
          <p>
            Forge Tests are <strong>NOT_CHECKED</strong> for Omega1: the acceptance tests need recorded
            spec inputs the Workshop does not hold for this robot — measured mass, wheel diameter and
            motor data. Those live in its measuring worksheet (docs/omega1/MEASURE.md) and are not
            loaded as Workshop spec fields.
          </p>
          <h4>Twin physics — ProjectSim estimates, not measurements</h4>
          <ul className="twin-physics">
            {omega1Rover.physics.map((p) => (
              <li key={p.label}><span className="faint">{p.label}</span> {p.value}</li>
            ))}
          </ul>
        </section>
      )}

      {tab === 'checks' && (
        <section aria-label="Omega1 checks — from its records">
          <h3>Checks from the records</h3>
          <p className="faint g-small">
            Only what Omega1&apos;s own records state, in the Workshop&apos;s check-line shape. The gaps
            are named as NOT_CHECKED, and no overall pass is claimed for Omega1 — no gate has run on it.
          </p>
          <ul className="twin-physics">
            {OMEGA1_CHECK_LINES.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </section>
      )}

      {tab === 'bom' && (
        <section aria-label="Omega1 bill of materials — from its records">
          <h3>What the real robot is made of</h3>
          <p className="faint g-small">
            The kit contents Omega1&apos;s records name, each with the record it stands on. No prices are
            shown — none are recorded for these parts.
          </p>
          <ul className="twin-physics">
            {omega1Parts.map((p) => (
              <li key={p.id}>
                <span className="faint">{p.name}</span> {p.basis}
                {p.countNote && <> — {p.countNote}</>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === 'tools' && (
        <section aria-label="Omega1 tools and materials">
          <h3>Tools &amp; materials</h3>
          <p>
            RobotForge holds no tools or materials record for Omega1, so nothing is listed here rather
            than guessed.
          </p>
          <p className="faint g-small">
            Recorded status: {OMEGA1_FACTS.find((f) => f.label === 'Right now')?.value}
          </p>
        </section>
      )}

      {tab === 'history' && (
        <section aria-label="Omega1 history — recorded entries only">
          <h3>History — recorded entries only</h3>
          <ul className="twin-physics">
            <li>
              <span className="faint">2026-11-01</span> Digital twin generated by ProjectSim (Kaedim)
              from a photo of the real robot on its bench.
            </li>
            <li>
              <span className="faint">Measured record</span> The real robot&apos;s measured record lives
              in docs/omega1/ (MEASURE.md) — the twin&apos;s estimates do not replace it.
            </li>
          </ul>
        </section>
      )}
    </section>
  );
}
