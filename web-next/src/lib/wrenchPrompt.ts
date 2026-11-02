/* Ask the Wrench composer to get ready for something: switch its mode,
 * prefill text, focus it, or open the paperclip's file picker. Pages
 * (the Workshop's "Bring a robot in") fire this instead of running
 * their own upload forms, so every way in goes through one chatbox. */
export const WRENCH_PROMPT_EVENT = "rf-wrench-prompt";

export type WrenchPrompt = {
  mode?: "chat" | "design";
  text?: string;
  attach?: boolean;
};

export function promptWrench(p: WrenchPrompt): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(WRENCH_PROMPT_EVENT, { detail: p }));
}
