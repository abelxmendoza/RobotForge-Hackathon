"use client";
/* Message list for Wrench's bottom bar: recorded HTML, plain text and
 * hit chips, with a copy button on each response. */
import type { Hit } from "./engine";
import CopyButton from "./CopyButton";
import { msgText } from "@/lib/copytext";

export interface ChatMsg {
  id: number;
  who: "bot" | "user";
  html?: string;
  text?: string;
  hits?: Hit[];
}

export default function ChatMessages({
  messages,
  onHitClick,
}: {
  messages: ChatMsg[];
  onHitClick: (h: Hit) => void;
}) {
  return (
    <>
      {messages.length === 0 && (
        <div className="fc-msg bot">
          <p>
            Ask me about the robots in the Robodex, the parts catalogue, or
            the recorded gate evidence — or tell me to change something:
            try &ldquo;Operations&rdquo; to see what I can do to your saved
            robots and parts. Answers come from RobotForge&rsquo;s recorded
            data first; anything a live model adds is badged.
          </p>
        </div>
      )}
      {messages.map((m) => (
        <div key={m.id} className={"fc-msg " + m.who}>
          {m.html && <div dangerouslySetInnerHTML={{ __html: m.html }} />}
          {m.text && <p style={{ whiteSpace: "pre-wrap" }}>{m.text}</p>}
          {m.hits && m.hits.length > 0 && (
            <div className="fc-hits">
              {m.hits.map((hit, i) => (
                <button
                  type="button"
                  className="fc-hit"
                  data-kind={hit.kind}
                  key={i}
                  onClick={() => onHitClick(hit)}
                >
                  {hit.label}
                </button>
              ))}
            </div>
          )}
          {m.who === "bot" && msgText(m) && <CopyButton getText={() => msgText(m)} />}
        </div>
      ))}
    </>
  );
}
