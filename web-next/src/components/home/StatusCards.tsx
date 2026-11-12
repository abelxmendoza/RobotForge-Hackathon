import Link from "next/link";
import WrenchBot from "@/components/chat/WrenchBot";
import type { ReactNode } from "react";

/**
 * Landing "What's live right now" cards (2026-11-03, Abel's direction:
 * a picture on every card so it reads at a glance). Each card is a
 * small drawn scene of the feature, one line of what it does, and a
 * few short facts. The pictures are diagrams, not screenshots, and
 * show only what the feature really does. If a fact stops being true,
 * it comes off the card.
 */

type Card = {
  title: string;
  lede: string;
  facts: string[];
  href?: string;
  go?: string;
  art: ReactNode;
};

/* Shared drawing bits. Colours come from classes in app.css (.sc-*)
 * so the scenes follow the site tokens. */
const Bot = ({ x, y, s = 1 }: { x: number; y: number; s?: number }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <rect className="sc-fill sc-line" x="-14" y="-12" width="28" height="18" rx="4" />
    <circle className="sc-dot" cx="-6" cy="-4" r="2" />
    <circle className="sc-dot" cx="6" cy="-4" r="2" />
    <path className="sc-line" d="M0 -12 V-18" />
    <circle className="sc-accent-fill" cx="0" cy="-19" r="2" />
    <circle className="sc-fill sc-line" cx="-8" cy="9" r="4" />
    <circle className="sc-fill sc-line" cx="8" cy="9" r="4" />
  </g>
);

const WrenchArt = (
  <svg viewBox="0 0 240 120" aria-hidden="true">
    <rect className="sc-panel" x="40" y="14" width="150" height="24" rx="10" />
    <text className="sc-text" x="52" y="30">add a lidar on top</text>
    <WrenchBot pose="head" mood="ready" size={38} x={6} y={46} className="sc-wrench" />
    <rect className="sc-panel sc-accent-line" x="48" y="50" width="176" height="56" rx="10" />
    <text className="sc-text" x="60" y="68">Preview: + RPLIDAR A1, top plate</text>
    <rect className="sc-pass-soft" x="60" y="78" width="70" height="18" rx="9" />
    <text className="sc-pass-text" x="70" y="91">✓ checked</text>
    <rect className="sc-accent-btn" x="140" y="78" width="72" height="18" rx="9" />
    <text className="sc-btn-text" x="156" y="91">Apply</text>
  </svg>
);

const AccountsArt = (
  <svg viewBox="0 0 240 120" aria-hidden="true">
    <rect className="sc-panel" x="50" y="8" width="140" height="104" rx="12" />
    <circle className="sc-fill sc-line" cx="120" cy="30" r="11" />
    <circle className="sc-dot" cx="120" cy="27" r="4" />
    <path className="sc-line" d="M112 38a9 9 0 0 1 16 0" />
    <rect className="sc-field" x="64" y="48" width="112" height="16" rx="5" />
    <text className="sc-faint" x="72" y="60">you@example.com</text>
    <rect className="sc-accent-btn" x="64" y="70" width="112" height="16" rx="5" />
    <text className="sc-btn-text" x="96" y="82">Sign up</text>
    <rect className="sc-field" x="64" y="90" width="112" height="16" rx="5" />
    <text className="sc-text" x="80" y="102">Continue with Meta</text>
  </svg>
);

const RobodexArt = (
  <svg viewBox="0 0 240 120" aria-hidden="true">
    {[0, 1, 2].map((c) =>
      [0, 1].map((r) => {
        const x = 22 + c * 72, y = 8 + r * 56;
        const pass = (c + r) % 3 !== 2;
        return (
          <g key={`${c}${r}`}>
            <rect className="sc-panel" x={x} y={y} width="62" height="48" rx="8" />
            <Bot x={x + 26} y={y + 26} s={0.8} />
            <circle className={pass ? "sc-pass-fill" : "sc-norun-fill"} cx={x + 52} cy={y + 10} r="4" />
          </g>
        );
      }),
    )}
  </svg>
);

const PhysicsArt = (
  <svg viewBox="0 0 240 120" aria-hidden="true">
    <path className="sc-line sc-dash" d="M120 6v22" />
    <path className="sc-line" d="M114 22l6 7 6-7" />
    <Bot x={120} y={62} s={1.6} />
    <circle className="sc-marg-fill" cx="120" cy="60" r="3.5" />
    <path className="sc-marg-line sc-dash" d="M120 60v38" />
    <path className="sc-ground" d="M30 98h180" />
    <path className="sc-pass-line" d="M101 98h38" />
    <text className="sc-faint" x="30" y="114">support</text>
    <rect className="sc-pass-soft" x="160" y="20" width="62" height="18" rx="9" />
    <text className="sc-pass-text" x="168" y="33">✓ stands</text>
    <text className="sc-faint" x="24" y="40">mass audit</text>
    <text className="sc-faint" x="24" y="56">drop test</text>
  </svg>
);

const PartsArt = (
  <svg viewBox="0 0 240 120" aria-hidden="true">
    <rect className="sc-panel" x="14" y="12" width="40" height="28" rx="4" />
    <path className="sc-line" d="M20 18h6m4 0h6m4 0h6M20 34h28" />
    <circle className="sc-fill sc-line" cx="34" cy="64" r="12" />
    <circle className="sc-dot" cx="34" cy="64" r="3" />
    <rect className="sc-panel" x="16" y="86" width="36" height="22" rx="4" />
    <path className="sc-line" d="M52 97h6" />
    <path className="sc-accent-line sc-dash" d="M62 26c40 0 50 30 74 34M52 64h82M62 97c40 0 50-24 74-30" />
    <Bot x={162} y={64} s={1.5} />
    <rect className="sc-field" x="196" y="86" width="38" height="20" rx="4" />
    <text className="sc-text" x="200" y="100">BOM</text>
  </svg>
);

const InventoryArt = (
  <svg viewBox="0 0 240 120" aria-hidden="true">
    <path className="sc-ground" d="M20 52h200M20 104h200" />
    <rect className="sc-panel" x="30" y="22" width="40" height="30" rx="3" />
    <rect className="sc-panel" x="76" y="30" width="30" height="22" rx="3" />
    <circle className="sc-fill sc-line" cx="126" cy="40" r="12" />
    <rect className="sc-panel" x="146" y="16" width="26" height="36" rx="3" />
    <rect className="sc-panel" x="30" y="74" width="52" height="30" rx="3" />
    <rect className="sc-panel" x="88" y="84" width="34" height="20" rx="3" />
    <rect className="sc-sim" x="150" y="72" width="62" height="32" rx="3" />
    <text className="sc-faint" x="158" y="92">sim-only</text>
    <circle className="sc-pass-fill" cx="66" cy="28" r="3.5" />
    <circle className="sc-pass-fill" cx="102" cy="36" r="3.5" />
    <circle className="sc-pass-fill" cx="78" cy="80" r="3.5" />
  </svg>
);

const LiveArt = (
  <svg viewBox="0 0 240 120" aria-hidden="true">
    <path className="sc-ground" d="M14 60h212" />
    <path className="sc-accent-line sc-thick" d="M14 60h52l10-28 14 54 12-42 8 16h44" />
    <path className="sc-line sc-dash" d="M154 60h72" />
    <circle className="sc-pass-fill sc-pulse" cx="34" cy="26" r="5" />
    <text className="sc-text" x="46" y="30">answering now</text>
    <rect className="sc-field" x="150" y="84" width="76" height="20" rx="10" />
    <text className="sc-faint" x="160" y="98">RECORDED</text>
    <text className="sc-faint" x="150" y="78">if a route drops</text>
  </svg>
);

const CARDS: Card[] = [
  {
    title: "Wrench, the workshop operator",
    lede: "Tell it what to change. It does the work in the chat.",
    facts: [
      "Drafts a spec from your words with Muse Spark",
      "Every edit is previewed and checked before it lands",
      "Answers cite recorded data; a failed check goes to the fix loop",
    ],
    href: "/garage/",
    go: "Open the Workshop",
    art: WrenchArt,
  },
  {
    title: "Accounts",
    lede: "Sign up with email, or continue with Meta.",
    facts: [
      "Live AI in the app runs on your account",
      "GitHub and Google buttons appear once those are switched on",
    ],
    art: AccountsArt,
  },
  {
    title: "Robodex",
    lede: "11 real robots plus your own sightings, grouped by how they move.",
    facts: ["Gate badges come only from recorded runs, never a model's say-so"],
    href: "/robots/",
    go: "Browse robots",
    art: RobodexArt,
  },
  {
    title: "Physics checks",
    lede: "Does it stand? Your robot's URDF runs in a physics engine in your browser.",
    facts: [
      "Mass audit, stability check, short drop test",
      "No URDF? The page says why instead of faking a result",
    ],
    href: "/robots/",
    go: "Try it on a robot page",
    art: PhysicsArt,
  },
  {
    title: "Build with parts",
    lede: "50 parts with datasheet specs. Drag them on, or add them by chat.",
    facts: [
      "Each robot's BOM exports as CSV",
      "Every kit part is parametric CAD (OpenSCAD)",
      "No prices shown, because none are verified",
    ],
    href: "/kit/",
    go: "Open the kit",
    art: PartsArt,
  },
  {
    title: "Inventory",
    lede: "Your shelf, kept honest: the parts and tools you really own.",
    facts: ["Sim-only entries stay visibly separate"],
    href: "/inventory/",
    go: "Open the Library",
    art: InventoryArt,
  },
  {
    title: "Live endpoint",
    lede: "Muse Spark is answering now: describe, chat, and read photos.",
    facts: ["If a route goes down, answers are labeled RECORDED and replay a real earlier run"],
    art: LiveArt,
  },
];

export default function StatusCards() {
  return (
    <div className="ai-cards status-cards">
      {CARDS.map((c) => (
        <article className="card ai-card status-card" key={c.title}>
          <div className="status-art">{c.art}</div>
          <div className="ai-card-head">
            <h3>{c.title}</h3>
            <span className="fbadge live">LIVE</span>
          </div>
          <p className="status-lede">{c.lede}</p>
          <ul className="status-facts">
            {c.facts.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          {c.href && (
            <Link className="status-go" href={c.href}>
              {c.go} →
            </Link>
          )}
        </article>
      ))}
    </div>
  );
}
