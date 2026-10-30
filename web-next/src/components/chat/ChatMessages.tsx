"use client";
/* Shared message list for the Forge Guide conversation — used by the
 * full Chat page and the collapsible rail so both render the
 * assistant's messages (recorded HTML, plain text, hit chips) the
 * exact same way. */
import type { Hit } from "./engine";

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
        </div>
      ))}
    </>
  );
}
