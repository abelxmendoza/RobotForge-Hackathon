"use client";
/* Message list for Wrench's bottom bar: recorded HTML, plain text and
 * hit chips, with a copy button on each response. */
import type { Hit } from "./engine";
import type { SourceRef } from "./wrench";
import CopyButton from "./CopyButton";
import { WebFindCards, WebPics } from "./WebFinds";
import type { WebFind } from "@/lib/webParts";
import { msgText } from "@/lib/copytext";

export interface ChatMsg {
  id: number;
  who: "bot" | "user";
  html?: string;
  text?: string;
  hits?: Hit[];
  sources?: SourceRef[];
  /* Live answers grounded in a Workshop snapshot only (set in
   * ChatDock at ask time). Recorded answers never carry this. */
  grounding?: { caption: string; failing: boolean; note?: { robotId: string; robotName: string; text: string; source: string } };
  /* Local Create-panel action results only (ComposerCreate): a
   * FORGE ENGINE / FORGE TESTS pill and an Open-in-Workshop action.
   * Never set on recorded or live answers, and never combined with
   * a grounding caption. */
  pill?: string;
  openAction?: { robotId: string; tab?: string; label: string };
  images?: string[];
  finds?: WebFind[];
}

export default function ChatMessages({
  messages,
  onHitClick,
  onFixClick,
  onOpenRobot,
  onSaveNote,
  onAsk,
}: {
  messages: ChatMsg[];
  onHitClick: (h: Hit) => void;
  onFixClick?: () => void;
  onOpenRobot?: (a: { robotId: string; tab?: string; label: string }) => void;
  onSaveNote?: (note: { robotId: string; robotName: string; text: string; source: string }) => void;
  onAsk?: (text: string) => void;
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
          {m.pill && (
            <p><span className="fbadge local">{m.pill}</span></p>
          )}
          {m.html && <div dangerouslySetInnerHTML={{ __html: m.html }} />}
          {m.text && <p style={{ whiteSpace: "pre-wrap" }}>{m.text}</p>}
          {m.images && <WebPics images={m.images} />}
          {m.finds && <WebFindCards finds={m.finds} onAsk={onAsk} />}
          {m.openAction && onOpenRobot && (
            <p>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => onOpenRobot(m.openAction!)}
              >
                {m.openAction.label}
              </button>
            </p>
          )}
          {m.grounding && (
            <p className="fc-grounding">{m.grounding.caption}</p>
          )}
          {m.grounding?.note && onSaveNote && (
            <button type="button" className="btn btn-sm fc-note-btn" onClick={() => onSaveNote(m.grounding!.note!)}>
              Save to {m.grounding.note.robotName}&apos;s notes
            </button>
          )}
          {m.grounding && m.grounding.failing && onFixClick && (
            <button type="button" className="fc-fix-btn" onClick={onFixClick}>
              Fix this
            </button>
          )}
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
          {m.sources && m.sources.length > 0 && (
            <div className="fc-sources" aria-label="Sources for this answer">
              <span className="fc-sources-label">From the record:</span>
              {m.sources.map((s, i) => (
                <button
                  type="button"
                  className="fc-source"
                  key={i}
                  onClick={() =>
                    onHitClick({ kind: "source", label: s.label, route: s.route })
                  }
                >
                  {s.label}
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
