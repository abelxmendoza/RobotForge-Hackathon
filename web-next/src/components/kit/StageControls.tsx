'use client';
/* Living Build Stage — the shared control row.
 *
 * Play/pause, the Motion / Sensors / Flow layer toggles and the
 * 0.5×/1×/2× speed, all real <button>s with aria-pressed so the
 * whole row is keyboard-operable like the rest of the app. The
 * honesty labels render here, verbatim from lib/stageAnimation,
 * so every surface that mounts the stage carries the same words:
 * the animated-preview label always, and the flow label whenever
 * the Flow toggle is offered. Reduced motion says why the stage
 * started paused.
 *
 * Pure presentation: state lives in useStageAnimation in the
 * parent, and this component makes no network or storage calls. */
import {
  FLOW_LABEL,
  STAGE_HONESTY_LABEL,
  STAGE_SPEEDS,
  type StageControls,
  type StageSpeed,
} from "@/lib/stageAnimation";

export type StageControlPatch = Partial<StageControls>;

export function StageControlsRow({
  controls,
  onChange,
  reducedMotion,
  showFlow = true,
}: {
  controls: StageControls;
  onChange: (patch: StageControlPatch) => void;
  reducedMotion: boolean;
  showFlow?: boolean;
}) {
  const btn = (active: boolean): React.CSSProperties => ({
    border: "1px solid var(--line, #2b3542)",
    background: active ? "var(--accent-dim, #12333a)" : "transparent",
    color: "inherit",
    borderRadius: 8,
    padding: "4px 10px",
    cursor: "pointer",
    font: "inherit",
    fontSize: 13,
  });
  return (
    <div
      className="stage-controls"
      style={{ display: "grid", gap: 6, marginTop: 10 }}
      aria-label="Stage animation controls"
    >
      <div
        style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}
        role="group"
        aria-label="Animation layers and speed"
      >
        <button
          type="button"
          aria-pressed={controls.playing}
          style={btn(controls.playing)}
          onClick={() => onChange({ playing: !controls.playing })}
        >
          {controls.playing ? "⏸ Pause" : "▶ Play"}
        </button>
        <button
          type="button"
          aria-pressed={controls.motion}
          style={btn(controls.motion)}
          onClick={() => onChange({ motion: !controls.motion })}
        >
          Motion
        </button>
        <button
          type="button"
          aria-pressed={controls.sensors}
          style={btn(controls.sensors)}
          onClick={() => onChange({ sensors: !controls.sensors })}
        >
          Sensors
        </button>
        {showFlow && (
          <button
            type="button"
            aria-pressed={controls.flow}
            style={btn(controls.flow)}
            onClick={() => onChange({ flow: !controls.flow })}
          >
            Flow
          </button>
        )}
        <span
          style={{ display: "inline-flex", gap: 4, marginLeft: 4 }}
          role="group"
          aria-label="Animation speed"
        >
          {STAGE_SPEEDS.map((s: StageSpeed) => (
            <button
              key={s}
              type="button"
              aria-pressed={controls.speed === s}
              style={btn(controls.speed === s)}
              onClick={() => onChange({ speed: s })}
            >
              {s}×
            </button>
          ))}
        </span>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>
        {STAGE_HONESTY_LABEL}
      </p>
      {showFlow && (
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          {FLOW_LABEL}
        </p>
      )}
      {reducedMotion && (
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          Started paused because your system prefers reduced motion — press Play
          when you want the motion.
        </p>
      )}
    </div>
  );
}
