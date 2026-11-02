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
  OMEGA1_FACTS, TWIN_ESTIMATE_NOTE, TWIN_LABEL, TWIN_NOT_GENERATED,
  omega1Parts, omega1Rover, twinSubjects,
} from '@/lib/omega1Twin';

export default function Omega1Twin() {
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
    </section>
  );
}
