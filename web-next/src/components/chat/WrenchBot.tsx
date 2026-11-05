"use client";
/* Wrench, drawn (Abel's character design, Nov 5, 2026).
 *
 * One vector character, animated with CSS (assets/css/chat.css, the
 * `wb-` rules), in place of the bitmap crops from the character sheet.
 * Same design language as Abel's sheet: a white helmet with an orange
 * stripe, a wrench for a crest, a dark visor with glowing cyan eyes,
 * round ear pods, a gear on the chest — and, at Abel's request, a
 * torque power-wrench for a right hand.
 *
 * mood  — what his face says: idle (blinks, breathes), listening
 *         (eyes on what you type), thinking (wink, "?", the wrench
 *         spins), ready (^ ^ smile), pass (sparkles), fail (droop).
 * pose  — head (chat composer, headers, avatars), full (landing
 *         hero), or one of the working poses from the sheet: design,
 *         simulate, report.
 *
 * Decorative by default (aria-hidden); pass `title` to give it a name
 * where it stands on its own. */
import { useId } from "react";

export type WrenchMood = "idle" | "listening" | "thinking" | "ready" | "pass" | "fail";
export type WrenchPose = "head" | "full" | "design" | "simulate" | "report";

const INK = "#161c2b";
const CYAN = "#5ce1ff";
const ORANGE = "#ff8a1f";
const JOINT = "#2b3243";
const SPARK = "#ffc531";

type Ids = { metal: string; visor: string; glow: string; tool: string };

function Eyes({ mood, ids }: { mood: WrenchMood; ids: Ids }) {
  const glow = `url(#${ids.glow})`;
  const arc = { fill: "none", stroke: CYAN, strokeWidth: 5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (mood) {
    case "ready":
      return (
        <g className="wb-eyes" filter={glow}>
          <path {...arc} d="M39 76 Q47 64 55 76" />
          <path {...arc} d="M65 76 Q73 64 81 76" />
        </g>
      );
    case "pass":
      return (
        <g className="wb-eyes" filter={glow}>
          <path {...arc} d="M39 77 L47 67 L55 77" />
          <path {...arc} d="M65 77 L73 67 L81 77" />
        </g>
      );
    case "fail":
      return (
        <g className="wb-eyes wb-eyes-sad" filter={glow} fill={CYAN}>
          <path d="M39 75 L55 70 L55 76 Q55 83 47 83 Q39 83 39 77 Z" />
          <path d="M81 75 L65 70 L65 76 Q65 83 73 83 Q81 83 81 77 Z" />
        </g>
      );
    case "thinking":
      return (
        <g className="wb-eyes wb-eyes-think" filter={glow}>
          <rect x="42" y="62" width="10" height="15" rx="5" fill={CYAN} />
          <path {...arc} d="M66 72 Q73 67 80 72" />
        </g>
      );
    default: {
      const dx = mood === "listening" ? 4 : 0;
      return (
        <g className={"wb-eyes wb-blink" + (mood === "listening" ? " wb-eyes-look" : "")} filter={glow} fill={CYAN}>
          <rect x={42 + dx} y="64" width="10" height="16" rx="5" />
          <rect x={68 + dx} y="64" width="10" height="16" rx="5" />
        </g>
      );
    }
  }
}

/* The head, in a 120 × 120 box: crest wrench, helmet, ear pods,
 * visor and eyes, plus the little marks each mood adds. */
function Head({ mood, ids }: { mood: WrenchMood; ids: Ids }) {
  const metal = `url(#${ids.metal})`;
  return (
    <g className="wb-head">
      <g transform="translate(38 46) rotate(-24)">
        <g className="wb-crest">
          <rect x="-7" y="-34" width="14" height="44" rx="4.5" fill={metal} stroke={INK} strokeWidth="3" />
          <path
            d="M7 -55.3 A17 17 0 1 1 -7 -55.3 L-7 -46 A7 7 0 0 0 7 -46 Z"
            fill={metal}
            stroke={INK}
            strokeWidth="3"
            strokeLinejoin="round"
          />
        </g>
      </g>
      <rect x="14" y="30" width="92" height="74" rx="36" fill={metal} stroke={INK} strokeWidth="3" />
      <ellipse cx="40" cy="41" rx="13" ry="4.5" fill="#fff" opacity=".85" transform="rotate(-18 40 41)" />
      <rect x="52" y="33.5" width="16" height="4" rx="2" fill={JOINT} />
      <path d="M70 34 Q88 37 100 52" fill="none" stroke={ORANGE} strokeWidth="5" strokeLinecap="round" />
      <circle cx="14" cy="74" r="13" fill={metal} stroke={INK} strokeWidth="3" />
      <circle cx="14" cy="74" r="6.5" fill="#0b1322" stroke={CYAN} strokeWidth="2.2" className="wb-ear" />
      <circle cx="106" cy="74" r="13" fill={metal} stroke={INK} strokeWidth="3" />
      <circle cx="106" cy="74" r="6.5" fill="#0b1322" stroke={CYAN} strokeWidth="2.2" className="wb-ear" />
      <rect x="24" y="50" width="72" height="44" rx="20" fill={`url(#${ids.visor})`} stroke={INK} strokeWidth="3" />
      <path d="M33 56 Q60 50 87 56" fill="none" stroke="#fff" strokeOpacity=".14" strokeWidth="3" strokeLinecap="round" />
      <Eyes mood={mood} ids={ids} />
      {mood === "thinking" && (
        <g className="wb-mark wb-q">
          <text x="100" y="26" fill={CYAN} fontSize="24" fontWeight="800" fontFamily="system-ui, sans-serif">?</text>
        </g>
      )}
      {(mood === "pass" || mood === "ready") && (
        <g className="wb-mark wb-spark" stroke={SPARK} strokeWidth="4" strokeLinecap="round">
          <path d="M99 30 L103 20" />
          <path d="M107 36 L116 30" />
          {mood === "pass" && <path d="M92 26 L91 15" />}
        </g>
      )}
      {mood === "fail" && (
        <path className="wb-mark wb-drop" d="M104 34 Q110 43 104 47 Q98 43 104 34 Z" fill="#9fdcff" stroke={INK} strokeWidth="1.5" />
      )}
    </g>
  );
}

/* An arm as two strokes: the ink outline under the white plating. */
function Limb({ d, w = 14, ids }: { d: string; w?: number; ids: Ids }) {
  return (
    <g>
      <path d={d} fill="none" stroke={INK} strokeWidth={w + 5} strokeLinecap="round" strokeLinejoin="round" />
      <path d={d} fill="none" stroke={`url(#${ids.metal})`} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

/* The torque power-wrench hand: a pistol-grip body with an orange
 * collar, a cyan torque dial, and a socket that spins. */
function PowerWrench({ ids }: { ids: Ids }) {
  return (
    <g className="wb-tool">
      <rect x="33" y="166" width="24" height="36" rx="9" fill={`url(#${ids.tool})`} stroke={INK} strokeWidth="3" />
      <rect x="33" y="172" width="24" height="6" fill={ORANGE} stroke={INK} strokeWidth="1.5" />
      <circle cx="45" cy="189" r="5" fill="#0b1322" stroke={CYAN} strokeWidth="2" className="wb-dial" />
      <rect x="39" y="200" width="12" height="9" rx="2" fill={JOINT} stroke={INK} strokeWidth="2" />
      <g className="wb-socket">
        <circle cx="45" cy="216" r="8" fill="#aab3c2" stroke={INK} strokeWidth="2.5" />
        <path d="M45 209.5 V222.5 M38.5 216 H51.5" stroke={INK} strokeWidth="2" />
        <circle cx="45" cy="216" r="2.6" fill={JOINT} />
      </g>
      <g className="wb-torque" fill="none" stroke={CYAN} strokeWidth="2" strokeLinecap="round">
        <path d="M32 214 A13 13 0 0 1 39 204" />
        <path d="M58 218 A13 13 0 0 1 51 228" />
      </g>
    </g>
  );
}

/* The full figure in a 200 × 270 box: thumbs-up on his left, the
 * power wrench on his right. */
function Body({ ids }: { ids: Ids }) {
  const metal = `url(#${ids.metal})`;
  return (
    <g className="wb-body">
      {/* legs */}
      <rect x="78" y="176" width="18" height="26" rx="7" fill={metal} stroke={INK} strokeWidth="3" />
      <rect x="104" y="176" width="18" height="26" rx="7" fill={metal} stroke={INK} strokeWidth="3" />
      <circle cx="87" cy="205" r="7" fill={JOINT} stroke={INK} strokeWidth="2" />
      <circle cx="113" cy="205" r="7" fill={JOINT} stroke={INK} strokeWidth="2" />
      <path d="M74 211 H100 L98 244 H76 Z" fill={metal} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
      <path d="M100 211 H126 L124 244 H102 Z" fill={metal} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
      <path d="M79 218 L80 236" stroke={ORANGE} strokeWidth="4" strokeLinecap="round" />
      <path d="M121 218 L120 236" stroke={ORANGE} strokeWidth="4" strokeLinecap="round" />
      <path d="M66 258 Q66 242 80 242 H96 Q102 242 102 250 V258 Z" fill={metal} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
      <path d="M98 258 V250 Q98 242 104 242 H120 Q134 242 134 258 Z" fill={metal} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
      {/* hips and torso */}
      <rect x="76" y="164" width="48" height="16" rx="7" fill={JOINT} stroke={INK} strokeWidth="2.5" />
      <rect x="88" y="98" width="24" height="16" rx="5" fill={JOINT} />
      <path d="M62 116 Q100 102 138 116 L132 166 Q100 178 68 166 Z" fill={metal} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
      <path d="M70 124 L75 158" stroke={ORANGE} strokeWidth="4" strokeLinecap="round" />
      <path d="M130 124 L125 158" stroke={ORANGE} strokeWidth="4" strokeLinecap="round" />
      <g className="wb-gear">
        <circle cx="100" cy="140" r="10" fill="none" stroke="#3a4356" strokeWidth="4.5" strokeDasharray="3.9 3.95" />
        <circle cx="100" cy="140" r="8" fill="#3a4356" />
        <circle cx="100" cy="140" r="3.4" fill="#e9edf3" />
      </g>
      {/* his right arm (viewer's left): the torque power wrench */}
      <Limb d="M62 122 L46 146 L45 166" ids={ids} />
      <circle cx="46" cy="146" r="6" fill={JOINT} />
      <PowerWrench ids={ids} />
      <circle cx="62" cy="121" r="11" fill={metal} stroke={INK} strokeWidth="3" />
      {/* his left arm (viewer's right): thumbs up */}
      <g className="wb-thumb">
        <Limb d="M138 122 L164 142 L174 116" ids={ids} />
        <circle cx="164" cy="142" r="6" fill={JOINT} />
        <rect x="178" y="80" width="10" height="24" rx="5" fill={JOINT} stroke={INK} strokeWidth="2.5" transform="rotate(12 183 102)" />
        <rect x="163" y="96" width="25" height="22" rx="8" fill={JOINT} stroke={INK} strokeWidth="2.5" />
        <path d="M167 104 H181 M167 110 H181" stroke="#465068" strokeWidth="2" strokeLinecap="round" />
      </g>
      <circle cx="138" cy="121" r="11" fill={metal} stroke={INK} strokeWidth="3" />
    </g>
  );
}

function Prop({ pose }: { pose: WrenchPose }) {
  if (pose === "design") {
    return (
      <g className="wb-prop wb-holo">
        <path d="M138 34 L232 24 L232 110 L138 118 Z" fill={CYAN} fillOpacity=".1" stroke={CYAN} strokeWidth="2" strokeLinejoin="round" />
        <g fill="none" stroke={CYAN} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M150 42 H186 M150 50 H172" strokeOpacity=".6" />
          <path d="M158 84 L166 70 H200 L210 84 Z" />
          <rect x="170" y="62" width="16" height="8" rx="2" />
          <circle cx="166" cy="92" r="7" />
          <circle cx="186" cy="92" r="7" />
          <circle cx="206" cy="92" r="7" />
        </g>
        <rect className="wb-scan" x="140" y="34" width="90" height="3" fill={CYAN} fillOpacity=".55" />
      </g>
    );
  }
  if (pose === "simulate") {
    return (
      <g className="wb-prop">
        <path d="M150 34 L226 26 L222 96 L146 102 Z" fill="#1d2536" stroke={INK} strokeWidth="3" strokeLinejoin="round" />
        <path d="M156 40 L220 33 L217 90 L152 95 Z" fill="#0b1322" />
        <g className="wb-sim-gear" fill="none" stroke={CYAN} strokeWidth="3">
          <circle cx="186" cy="60" r="9" strokeDasharray="3.5 3.6" strokeWidth="5" />
          <circle cx="186" cy="60" r="4" />
        </g>
        <rect x="162" y="80" width="48" height="5" rx="2.5" fill="#26324a" />
        <rect className="wb-progress" x="162" y="80" width="48" height="5" rx="2.5" fill={CYAN} />
        <path d="M132 112 L146 102 L222 96 L238 104 Z" fill="#3a4356" stroke={INK} strokeWidth="3" strokeLinejoin="round" />
      </g>
    );
  }
  if (pose === "report") {
    return (
      <g className="wb-prop wb-board">
        <rect x="150" y="30" width="70" height="88" rx="8" fill="#e9edf3" stroke={INK} strokeWidth="3" transform="rotate(8 185 74)" />
        <g transform="rotate(8 185 74)">
          <rect x="172" y="24" width="26" height="12" rx="4" fill="#3a4356" stroke={INK} strokeWidth="2" />
          <path d="M162 50 H206 M162 62 H200 M162 74 H206 M162 86 H190" stroke="#4b7bd8" strokeWidth="4" strokeLinecap="round" />
          <circle cx="204" cy="100" r="10" fill="#22c55e" stroke={INK} strokeWidth="2" />
          <path d="M199 100 L203 104 L210 96" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </g>
    );
  }
  return null;
}

/* Body plus an oversized head (the sheet's chibi proportions), in a
 * 200 × 300 box. */
function Figure({ mood, ids }: { mood: WrenchMood; ids: Ids }) {
  return (
    <>
      <g transform="translate(0 30)">
        <Body ids={ids} />
      </g>
      <g transform="translate(18 -14) scale(1.36)">
        <Head mood={mood} ids={ids} />
      </g>
    </>
  );
}

export default function WrenchBot({
  mood = "idle",
  pose = "head",
  size,
  className = "",
  title,
  still = false,
  x,
  y,
}: {
  mood?: WrenchMood;
  pose?: WrenchPose;
  /* Rendered width in px; the height follows the pose's shape. */
  size?: number;
  className?: string;
  title?: string;
  /* true: no motion (small repeated avatars, e.g. on every message). */
  still?: boolean;
  /* Position when nested inside another SVG. */
  x?: number;
  y?: number;
}) {
  const raw = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const ids: Ids = { metal: `wbm${raw}`, visor: `wbv${raw}`, glow: `wbg${raw}`, tool: `wbt${raw}` };
  const box =
    pose === "head" ? "-4 -24 128 134" : pose === "full" ? "0 -46 206 338" : "0 -28 240 236";
  const [, , bw, bh] = box.split(" ").map(Number);
  const cls = ["wb", `wb-${pose}`, `wb-mood-${mood}`, still ? "wb-still" : "", className].filter(Boolean).join(" ");
  const headMood: WrenchMood =
    pose === "design" || pose === "simulate" ? "listening" : pose === "report" ? "ready" : mood;
  return (
    <svg
      className={cls}
      viewBox={box}
      x={x}
      y={y}
      width={size}
      height={size ? Math.round((size * bh) / bw) : undefined}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      {title && <title>{title}</title>}
      <defs>
        <linearGradient id={ids.metal} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset=".55" stopColor="#eef1f6" />
          <stop offset="1" stopColor="#c3cad6" />
        </linearGradient>
        <linearGradient id={ids.visor} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#14203a" />
          <stop offset="1" stopColor="#060b16" />
        </linearGradient>
        <linearGradient id={ids.tool} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#4a5468" />
          <stop offset=".5" stopColor="#5d6880" />
          <stop offset="1" stopColor="#363e50" />
        </linearGradient>
        <filter id={ids.glow} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="1.8" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {pose === "head" ? (
        <g className="wb-float">
          <Head mood={mood} ids={ids} />
        </g>
      ) : pose === "full" ? (
        <g className="wb-float">
          <Figure mood={mood} ids={ids} />
        </g>
      ) : (
        <>
          <Prop pose={pose} />
          <g transform="translate(-2 4) scale(.7)">
            <g className="wb-float">
              <Figure mood={headMood} ids={ids} />
            </g>
          </g>
        </>
      )}
    </svg>
  );
}
