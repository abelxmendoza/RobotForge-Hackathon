/* "What RobotForge does": the plain-terms capability list for the
 * landing page (Abel's wording, Nov 4, 2026 — "add to the landing
 * page and make it simple"). One card per capability, one line each;
 * every line is true of the shipped product. Deliberately static:
 * no live badges, no numbers — the honesty note at the end names
 * the two things that are NOT built yet. */

const CAPS: { title: string; body: string }[] = [
  {
    title: "Describe it, it designs it",
    body: "Tell Wrench the robot you want in plain words. It designs a buildable robot: parts, sizes, and a plan.",
  },
  {
    title: "Checked before you build",
    body: "Every design is verified — fit, strength, compatibility — and bad fixes get rejected with the numbers to prove it. You approve everything.",
  },
  {
    title: "A real parts list",
    body: "What to buy or 3D-print, split into what you already have and what you'd still need. Every printable part has its own editable file.",
  },
  {
    title: "Looked up for you",
    body: "It searches the web for real part specs and materials. Anything found online is marked unverified until you confirm it.",
  },
  {
    title: "Wired on paper",
    body: "Every design comes with its wiring plan: what connects to what, and why.",
  },
  {
    title: "Take it apart on screen",
    body: "Pull the 3D model apart piece by piece, right in the browser, and put it back together.",
  },
  {
    title: "A library of robots",
    body: "The Robodex keeps your builds, robots you've spotted and photographed, and researched designs — any of them can move into your Workshop.",
  },
  {
    title: "From photo or scan to 3D",
    body: "A photo becomes a 3D twin (labelled as estimates). A depth-camera scan becomes real measurements.",
  },
  {
    title: "Tested in simulation first",
    body: "Designs are driven in a virtual world before anything physical, and the pass/fail results are saved as proof.",
  },
];

export default function CapabilityCards() {
  return (
    <div className="cap-cards">
      {CAPS.map((c) => (
        <article className="card cap-card" key={c.title}>
          <h3>{c.title}</h3>
          <p>{c.body}</p>
        </article>
      ))}
    </div>
  );
}
