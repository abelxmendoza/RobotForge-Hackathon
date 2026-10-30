"use client";
/* Headless assistant for the primary Forge conversation. Recorded answers,
 * live fallback and validated operation proposals share its single composer.
 * No floating launcher or separate chat panel is mounted. */
import {
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  createEngine,
  esc,
  type AnswerResult,
  type Engine,
  type Hit,
  type IntentsData,
  type KindData,
  type PartData,
  type ReportsData,
  type RobotData,
  type TemplateData,
} from "./engine";
import { gateReports, parts, robots } from "@/lib/data";
import partsDoc from "@/data/parts.json";
import kindsDoc from "@/data/kinds.json";
import intentsDoc from "@/data/chat-intents.json";
import InventoryProposal from './InventoryProposal';
import {INVENTORY_KEY,parseInventoryCommand,proposeInventory,type InventoryPart,type InventoryOperation} from '@/lib/inventory';
import AssemblyProposal from './AssemblyProposal';
import { ASSEMBLY_KEY, parseAssemblyCommand, previewAssembly, undoAssembly, type Assemblies, type AssemblyOperation } from '@/lib/assembly';
import { GARAGE_KEY, fmtValue, type GarageRobot } from '@/lib/garage';
import { readStore, writeStore, uid } from '@/lib/store';
import { applyOperation, parseCommand, proposeCommand, undoOperation, type Preview } from '@/lib/operations';
import { forgeValidateSpec } from '@/components/forge/validate';
import { LIVE_ENDPOINT } from "@/components/forge/live";


const DEFAULT_CHIPS = [
  "Which robots passed the gate?",
  "List my robots",
  "Operations",
  "Tell me about Andino",
  "How does RobotForge work?",
];

const SUB_RECORDED =
  "Answers from RobotForge's recorded data (not a live AI) — the Robodex, the parts catalogue and the recorded gate reports.";
const SUB_LIVE =
  "Recorded data first — the Robodex, the parts catalogue and the recorded gate reports. Questions they can’t answer go to a live model, badged LIVE MODEL.";

const LIVE_BADGE =
  "LIVE MODEL — not from recorded RobotForge data; check numbers on the Evidence page";

function buildEngine(): Engine {
  const templates =
    (partsDoc as unknown as { templates?: TemplateData[] }).templates || [];
  return createEngine({
    robots: robots as unknown as RobotData[],
    parts: parts as unknown as PartData[],
    templates: templates.length,
    templateList: templates,
    kinds: (kindsDoc as { kinds?: KindData[] }).kinds || [],
    reports: { runs: gateReports } as unknown as ReportsData,
    intents: intentsDoc as unknown as IntentsData,
    root: "",
  });
}

interface LiveHealth {
  ok?: boolean;
  mode?: string;
  routes?: { chat?: boolean };
  budget?: { exhausted?: boolean };
  [key: string]: unknown;
}

interface Msg {
  id: number;
  who: "bot" | "user";
  html?: string;
  text?: string;
  hits?: Hit[];
}

let nextId = 1;

export function useForgeAssistant() {
  const router = useRouter();
  const pathname = usePathname();
  const engine = useMemo(buildEngine, []);

  const [messages, setMessages] = useState<Msg[]>([]);
  const [chips, setChipsState] = useState<string[]>(DEFAULT_CHIPS);
  const [subText, setSubText] = useState(SUB_RECORDED);

  const [proposal, setProposal] = useState<Preview | null>(null);
  const [inventoryProposal,setInventoryProposal]=useState<InventoryOperation|null>(null);
  const [assemblyProposal, setAssemblyProposal] = useState<AssemblyOperation | null>(null);
  const lastApplied = useRef<{ robotId: string; versionId: string; scope?: 'assembly' } | null>(null);
  const proposalRef = useRef<Preview | null>(null);
  proposalRef.current = proposal;

  const healthRef = useRef<Promise<LiveHealth | null> | null>(null);

  const setChips = useCallback(
    (list: string[] | undefined | null) => {
      setChipsState(list && list.length ? list : DEFAULT_CHIPS);
    },
    []
  );

  const appendMsg = useCallback((msg: Omit<Msg, "id">): number => {
    const id = nextId++;
    setMessages((prev) => [...prev, { ...msg, id }]);
    return id;
  }, []);

  const noteBubble = useCallback(
    (text: string) => {
      appendMsg({ who: "bot", text });
    },
    [appendMsg]
  );

  /* ---------------- live model (deployment-configured) ------------ */

  const liveBase = useCallback((): string => {
    const base = LIVE_ENDPOINT || "";
    return String(base).replace(/\/+$/, "");
  }, []);

  const checkLive = useCallback((): Promise<LiveHealth | null> => {
    /* Cached /health probe: resolves to the health JSON when the
     * endpoint is configured AND answering AND able to run chat;
     * resolves to null otherwise. With no endpoint configured (the
     * shipped site) it resolves null immediately — no network call. */
    if (!liveBase()) return Promise.resolve(null);
    if (!healthRef.current) {
      healthRef.current = fetch(liveBase() + "/health", { cache: "no-cache" })
        .then((r) => (r.ok ? (r.json() as Promise<LiveHealth>) : null))
        .then((h) => {
          if (h && h.ok && h.mode === "live" && h.routes && h.routes.chat) {
            setSubText(SUB_LIVE);
          }
          return h;
        })
        .catch(() => null);
    }
    return healthRef.current;
  }, [liveBase]);

  const liveUsable = (h: LiveHealth | null): boolean =>
    Boolean(
      h && h.ok && h.mode === "live" && h.routes && h.routes.chat &&
        !(h.budget && h.budget.exhausted)
    );

  const liveChat = useCallback(
    (q: string): Promise<string> =>
      fetch(liveBase() + "/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: q }),
      }).then((r) =>
        r
          .json()
          .catch(() => null)
          .then((body: { answer?: unknown; error?: string; code?: string } | null) => {
            if (!r.ok) {
              const e = new Error(
                (body && body.error) || "endpoint -> " + r.status
              ) as Error & { code?: string; status?: number };
              e.code = body ? body.code : undefined;
              e.status = r.status;
              throw e;
            }
            if (!body || typeof body.answer !== "string") {
              throw new Error("endpoint returned no answer");
            }
            return body.answer;
          })
      ),
    [liveBase]
  );

  /* ---------------- part focus + in-page actions ---------------- */

  const onPartsPage = Boolean(pathname && pathname.startsWith("/kit"));

  const dispatchFocusPart = useCallback((id: string) => {
    window.dispatchEvent(
      new CustomEvent("rf-focus-part", { detail: { id } })
    );
  }, []);

  /* A part hit: on the Parts catalogue page, focus the part there (event +
   * the ?part= deep link the page understands); from anywhere else,
   * navigate to that deep link. */
  const focusPartHit = useCallback(
    (hit: Hit) => {
      if (!hit.id) return;
      dispatchFocusPart(hit.id);
      const url = "/kit/?part=" + encodeURIComponent(hit.id) + "#parts";
      if (onPartsPage) {
        noteBubble(
          "I highlighted “" + hit.label + "” in the parts catalogue on this page."
        );
        router.replace(url, { scroll: false });
      } else {
        router.push(url);
      }
    },
    [dispatchFocusPart, noteBubble, onPartsPage, router]
  );

  /* A real in-page action, not just an answer: on a page with the
   * catalogue's own search box, "find lidar" / "show servos" drives
   * that box, so the page itself responds to the conversation. */
  const filterPartsHere = useCallback(
    (q: string) => {
      const ps = document.getElementById("part-search") as HTMLInputElement | null;
      if (!ps) return;
      const m = q.match(/^(?:find|search|show(?: me)?|filter)\s+(.+)$/i);
      if (!m) return;
      ps.value = m[1].trim();
      ps.dispatchEvent(new Event("input", { bubbles: true }));
      noteBubble(
        "I filtered the parts catalogue on this page for “" +
          m[1].trim() +
          "” — it is just below."
      );
      const sec = document.getElementById("parts");
      if (sec) sec.scrollIntoView({ behavior: "smooth" });
    },
    [noteBubble]
  );

  /* After an answer, act on a find/show question: highlight the
   * first part hit in the catalogue when this page has one. Falls
   * back to the original search-box behaviour when there are no
   * structured hits to act on. */
  const autoAction = useCallback(
    (q: string, ans: AnswerResult) => {
      if (/^(find|search|show|filter)\b/i.test(q) && ans.hits) {
        const partHits = ans.hits.filter((h) => h.kind === "part");
        if (partHits.length && onPartsPage && partHits[0].id) {
          dispatchFocusPart(partHits[0].id);
          noteBubble(
            "I highlighted the first match, “" +
              partHits[0].label +
              "”, in the catalogue on this page — tap any result " +
              "button to pop another one up."
          );
          return;
        }
      }
      filterPartsHere(q);
    },
    [dispatchFocusPart, filterPartsHere, noteBubble, onPartsPage]
  );

  /* ---------------- asking ---------------- */

  const ask = useCallback(
    (question: string) => {
      const q = String(question || "").trim();
      if (!q) return;
      appendMsg({ who: "user", text: q });
      setProposal(null);
      setAssemblyProposal(null);
      setInventoryProposal(null);
      const stockCommand=parseInventoryCommand(q);
      if(stockCommand){
        try{
          const stock=readStore<InventoryPart[]>(INVENTORY_KEY,[]);
          const robots=readStore<GarageRobot[]>(GARAGE_KEY,[]);
          if(stockCommand.kind==='list'){
            let shown=stock;
            if(stockCommand.robotName){const match=robots.filter(r=>r.name.toLowerCase()===stockCommand.robotName!.toLowerCase());if(match.length!==1)throw new Error('Use a unique saved robot name.');shown=stock.filter(p=>p.robot_id===match[0].id);}
            noteBubble(shown.length?shown.map(p=>`${p.name}: ×${p.quantity} · ${p.category} · ${robots.find(r=>r.id===p.robot_id)?.name??'shared/unassigned'} · ${p.stock_location||'no shelf location'}`).join('\n'):'No matching parts saved in this browser. Add photos in My parts or attach a part photo in Forge.');
          }else setInventoryProposal(proposeInventory(stock,robots,stockCommand));
        }catch(e){noteBubble((e as Error).message);}
        return;
      }
      try {
        const saved = readStore<GarageRobot[]>(GARAGE_KEY, []);
        const assemblies = readStore<Assemblies>(ASSEMBLY_KEY, {});
        const assembly = parseAssemblyCommand(q, saved, assemblies, uid('part'));
        if (assembly) {
          previewAssembly(saved, assemblies, assembly);
          setAssemblyProposal(assembly);
          noteBubble('Review the assembly action below. Apply saves it as a new assembly version, visible in My robots.');
          return;
        }
      } catch (e) { noteBubble((e as Error).message); return; }
      const command = parseCommand(q);
      if (command) {
        try {
          const saved = readStore<GarageRobot[]>(GARAGE_KEY, []);
          if (command.kind === 'help') {
            noteBubble('Inventory: list my inventory; list my parts for "Omega1"; set inventory "Battery" quantity to 3; assign inventory "Battery" to "Omega1". Operations available now: list my robots; set "Omega1" wheel.diameter_m to 0.12; undo last chat change. Edits use exact saved robot names and spec units (m, kg, V, mAh), preview first, and save a new version. Assembly commands: add a Jetson Orin Nano to "Omega1"; move "Jetson Orin Nano" on "Omega1" to 0 0 70 mm; connect "battery" to "Jetson Orin Nano" on "Omega1"; remove "battery" from "Omega1". Names resolve when unique; use workbench instance IDs for duplicates. Connections are planning-only, NOT_CHECKED. Mount generation and simulation jobs remain planned.');
          } else if (command.kind === 'list') {
            noteBubble(saved.length ? saved.map(r => r.name + ' — ' + r.versions.length + ' versions').join('\n') : 'No robots saved in this browser yet. Add one in My robots.');
          } else if (command.kind === 'undo') {
            const last = lastApplied.current;
            if (!last) throw new Error('No chat change to undo in this session.');
            if (last.scope === 'assembly') {
              const fresh = readStore<Assemblies>(ASSEMBLY_KEY, {});
              const next = undoAssembly(fresh,last.robotId,last.versionId,uid('assembly'),new Date().toISOString());
              const error = writeStore(ASSEMBLY_KEY,next); if(error) throw new Error(error);
              lastApplied.current = null;
              noteBubble('Previous assembly restored as a new version.');
              return;
            }
            const next = undoOperation(saved, last.robotId, last.versionId, uid('v'), new Date().toISOString());
            const error = writeStore(GARAGE_KEY, next);
            if (error) throw new Error(error);
            lastApplied.current = null;
            noteBubble('Restored the previous spec as a new version. History is preserved. Reopen the robot to load it into the editor.');
          } else {
            const preview = proposeCommand(saved, command);
            setProposal(preview);
            noteBubble('Proposed change to the latest saved version. Your unsaved editor draft is separate. Review the preview below.');
          }
        } catch (e) { noteBubble((e as Error).message); }
        return;
      }
      // Unknown operational requests are never sent to an answer-only model
      // that could claim an action happened without executing it.
      if (/^(?:add|remove|delete|move|place|mount|connect|wire|disconnect|generate|export|run|save|set|undo)\b/i.test(q)) {
        noteBubble('That operation is not supported yet. Type “operations” for the commands I can execute. Nothing was changed.');
        return;
      }
      const waitId = appendMsg({
        who: "bot",
        html: '<p class="fc-dim">Checking the recorded data&hellip;</p>',
      });
      const done = (ans: AnswerResult) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === waitId ? { ...m, html: ans.html, hits: ans.hits } : m
          )
        );
        setChips(ans.chips || engine.suggestions);
        autoAction(q, ans);
      };
      /* The vanilla widget answers inside its data-load promise, so
       * the "Checking…" bubble paints first; the data here is a
       * static import, so defer one tick to keep the same rhythm. */
      window.setTimeout(() => {
        const ans = engine.answer(q);
        /* Recorded answers stay the default and stay instant: only
         * the engine's honest fallback may go live. */
        if (!ans.fallback || !liveBase()) {
          done(ans);
          return;
        }
        void checkLive().then((h) => {
          if (!liveUsable(h)) {
            /* Endpoint configured but not usable: say so only when
             * the reason is budget/kill-switch (a plain note under
             * the local answer); a silent endpoint keeps the plain
             * local behavior. */
            if (h && h.ok && (h.mode === "off" || (h.budget && h.budget.exhausted))) {
              done({
                html:
                  ans.html +
                  '<p class="fc-live-note">The live model is ' +
                  (h.mode === "off"
                    ? "switched off at the endpoint"
                    : "out of budget for today") +
                  ", so this answer is from the recorded data only.</p>",
                chips: ans.chips,
              });
            } else {
              done(ans);
            }
            return;
          }
          setMessages((prev) =>
            prev.map((m) =>
              m.id === waitId
                ? {
                    ...m,
                    html:
                      '<p class="fc-dim">The recorded data ' +
                      "doesn&rsquo;t have that &mdash; asking the live model&hellip;</p>",
                  }
                : m
            )
          );
          liveChat(q)
            .then((answer) => {
              done({
                html:
                  '<p><span class="fc-live-badge">' +
                  LIVE_BADGE +
                  "</span></p><p>" +
                  esc(answer).replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br>") +
                  "</p>",
                chips: ans.chips,
              });
            })
            .catch((e: Error & { code?: string }) => {
              const note =
                e && e.code === "budget_exhausted"
                  ? "The live model&rsquo;s budget for today is used up, so " +
                    "this answer is from the recorded data only."
                  : "The live endpoint isn&rsquo;t answering, so this answer " +
                    "is from the recorded data only.";
              done({
                html: ans.html + '<p class="fc-live-note">' + note + "</p>",
                chips: ans.chips,
              });
            });
        });
      }, 0);
    },
    [appendMsg, autoAction, checkLive, engine, liveBase, liveChat, setChips, noteBubble]
  );

  const onHitClick = (h: Hit) => {
    if (h.kind === "part") focusPartHit(h);
    else if (h.route) router.push(h.route);
  };

  return {ask,messages,chips,onHitClick,subText,actions: <div className="main-chat-actions">
        {inventoryProposal&&<InventoryProposal key={JSON.stringify(inventoryProposal)} operation={inventoryProposal} onDone={text=>{setInventoryProposal(null);noteBubble(text);}} onCancel={()=>{setInventoryProposal(null);noteBubble('Cancelled. Inventory unchanged.');}}/>}
        {assemblyProposal && <AssemblyProposal key={JSON.stringify(assemblyProposal)} operation={assemblyProposal}
          onApplied={versionId => { lastApplied.current = {robotId: assemblyProposal.robotId,versionId,scope:'assembly'}; setAssemblyProposal(null); noteBubble('Assembly saved. Open this robot in My robots to see it in 3D. Type “undo” to restore the previous assembly.'); }}
          onCancel={() => {setAssemblyProposal(null); noteBubble('Cancelled. Assembly unchanged.');}}
          onError={text => {setAssemblyProposal(null); noteBubble(text);}} />}
        {proposal && (() => {
          const op = proposal.operation;
          const saved = readStore<GarageRobot[]>(GARAGE_KEY, []);
          let checks: string[] = [];
          try {
            const candidate = applyOperation(saved, op, 'preview', 'preview');
            checks = forgeValidateSpec(candidate.find(r => r.id === op.robotId)!.versions.at(-1)!.spec).lines;
          } catch (e) { checks = [(e as Error).message]; }
          return <div className="fc-msg bot" role="region" aria-label="Operation preview">
            <strong>Change {op.path}</strong>
            <p>{fmtValue(proposal.before)} → {fmtValue(proposal.after)}</p>
            <p>Spec units: m, kg, V, mAh. Creates a saved version; does not replace your open editor draft.</p>
            <details><summary>Browser checks (subset)</summary>{checks.map((line, i) => <p key={i}>{line}</p>)}{!checks.length && <p>No findings in the browser subset.</p>}</details>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => {
              if (proposalRef.current !== proposal) return;
              // Invalidate synchronously so a double click cannot apply twice.
              proposalRef.current = null;
              setProposal(null);
              try {
                const current = readStore<GarageRobot[]>(GARAGE_KEY, []);
                const versionId = uid('v');
                const next = applyOperation(current, op, versionId, new Date().toISOString());
                const error = writeStore(GARAGE_KEY, next);
                if (error) throw new Error(error);
                lastApplied.current = { robotId: op.robotId, versionId };
                noteBubble('Saved as a new robot version. Type “undo” to restore the previous spec. Reopen the robot to load this version into the editor.');
              } catch (e) { noteBubble((e as Error).message); }
            }}>Apply change</button>
            <button type="button" className="btn btn-sm" onClick={() => { proposalRef.current = null; setProposal(null); noteBubble('Cancelled. Nothing changed.'); }}>Cancel</button>
          </div>;
        })()}
  </div>};
}

/* Compatibility exports intentionally render nothing: conversation lives in Forge. */
export function ChatWidget(_props: {docked:boolean}) { return null; }
export default function ChatDock() { return null; }
