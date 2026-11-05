/* Wrench's face, rendered from the single source in lib/wrenchArt.
 * Decorative wherever it sits beside his name or his own words, so it
 * carries no alt text of its own. */
import { WRENCH_ART, type WrenchMood } from "@/lib/wrenchArt";

export default function WrenchAvatar({
  mood = "avatar",
  className = "wrench-head-avatar",
}: {
  mood?: WrenchMood;
  className?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={className}
      src={WRENCH_ART[mood]}
      alt=""
      aria-hidden="true"
      loading="lazy"
    />
  );
}
