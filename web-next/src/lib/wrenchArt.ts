/* Wrench's character art — the single source for his face across the
 * app (Abel's design, adopted 2026-11-04). Every surface that shows
 * Wrench — the landing band, the chat headers, his messages, his
 * thinking state and the pass/fail verdicts — takes its image from
 * here, the same way every surface takes his name from ASSISTANT_NAME.
 * The art is cropped from Abel's character sheet (poster); the files
 * live in assets/img/wrench/ and sync into the app at build time. */
import { assetPath } from "@/components/home/asset";

export const WRENCH_ART = {
  /* His default face: chat headers and his messages. */
  avatar: assetPath("assets/img/wrench/avatar.jpg"),
  /* The little heads from the character sheet, one per state. */
  ready: assetPath("assets/img/wrench/ready.jpg"),
  analyzing: assetPath("assets/img/wrench/analyzing.jpg"),
  pass: assetPath("assets/img/wrench/pass.jpg"),
  fail: assetPath("assets/img/wrench/fail.jpg"),
  /* Full figure and activity poses for the landing band. */
  fullbody: assetPath("assets/img/wrench/fullbody.jpg"),
  design: assetPath("assets/img/wrench/design.jpg"),
  simulate: assetPath("assets/img/wrench/simulate.jpg"),
  report: assetPath("assets/img/wrench/report.jpg"),
  /* Abel's original character sheet, uncut. */
  poster: assetPath("assets/img/wrench/poster.jpg"),
} as const;

export type WrenchMood = keyof typeof WRENCH_ART;
