/* Wrench's face, drawn by WrenchBot (Abel's character design). The
 * names here are the states the chat already uses: avatar (his
 * resting face), ready, analyzing (thinking), pass and fail.
 * Decorative wherever it sits beside his name or his own words, so it
 * carries no alt text of its own. */
import WrenchBot, { type WrenchMood as BotMood } from "./WrenchBot";

export type WrenchAvatarMood = "avatar" | "ready" | "analyzing" | "pass" | "fail";

const TO_BOT: Record<WrenchAvatarMood, BotMood> = {
  avatar: "idle",
  ready: "ready",
  analyzing: "thinking",
  pass: "pass",
  fail: "fail",
};

export default function WrenchAvatar({
  mood = "avatar",
  className = "wrench-head-avatar",
  still = false,
}: {
  mood?: WrenchAvatarMood;
  className?: string;
  still?: boolean;
}) {
  return <WrenchBot pose="head" mood={TO_BOT[mood]} className={className} still={still} />;
}
