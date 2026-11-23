"use client";

import { promptWrench } from "@/lib/wrenchPrompt";

/* Hands the robot to Wrench: prefills the composer with a question
 * about this robot and focuses it. Nothing is sent until the visitor
 * presses send. */
export default function AskWrenchButton({ name }: { name: string }) {
  return (
    <button
      type="button"
      className="btn"
      onClick={() => promptWrench({ mode: "chat", text: `Tell me about the ${name}: how does it work and what would I need to build one?` })}
    >
      Ask Wrench about it
    </button>
  );
}
