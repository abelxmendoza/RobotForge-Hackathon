"use client";
/* Forge Guide widget — the chat UI (React port of assets/js/chat.js).
 *
 * Answering is done by ./engine.ts (the chat-engine.js port) from the
 * site's recorded data, and the local recorded answer is ALWAYS the
 * default: instant, and the only answer whenever no live endpoint is
 * configured.
 *
 * Live-model hook: when a deployment configures the live endpoint
 * (LIVE_ENDPOINT below — empty in the committed site, mirroring
 * assets/js/live-config.js) and /health answers, a question the local
 * engine honestly cannot answer (its `fallback: true` result) is
 * offered to the live model at POST /chat. The reply is rendered
 * escaped and badged "LIVE MODEL — not from recorded RobotForge
 * data". If the endpoint errors or is over budget, the Guide says
 * so plainly and keeps the local answer. No API keys ever live in
 * this file or any page: the endpoint holds them server-side.
 *
 * Data: the vanilla widget fetched catalog/*.json at runtime; here
 * the same JSON is statically imported (see @/lib/data and @/data),
 * so the engine is built synchronously and no fetching happens.
 *
 * Routes: the engine already returns Next routes (/robots/<slug>/,
 * /evidence/, /forge/). Robot/kind/route hits navigate with the Next
 * router; part hits dispatch a window CustomEvent "rf-focus-part"
 * (detail {id}) and land on /robots/?part=<id>#parts.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
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
import { useDispatch, useSelector } from 'react-redux';
import type { RootState } from '@/store/store';
import { setActiveRobot } from '@/store/forgeSlice';
import { saveTable, saveRecord } from '@/store/workspaceSlice';
import { useTables } from '../workspace/useTables';
import { groundedAnswer, makeContext } from './grounded';
import PhotoCapture from '../photo/PhotoCapture';
import { prepareImage } from '../photo/image';
import { postJSON } from '../forge/live';
import type { PhotoDraft, DocDraft, PartialSpec } from '../forge/model';
import { conversationTurn, questionFor, seedRobotFlow, type Flow } from "@/lib/conversation";
import { setFlow, setChatMessages, requestConversation, setPendingPhoto, type ChatMessage } from "@/store/assistantSlice";
import { validRecord, validTable } from "@/lib/workspace";
import { parseCSV } from '@/lib/workspace';
import { robotSpecs } from '@/lib/workspaceData';
import partsDoc from "@/data/parts.json";
import kindsDoc from "@/data/kinds.json";
import intentsDoc from "@/data/chat-intents.json";

/* Deployment live-endpoint config (assets/js/live-config.js in the
 * vanilla site): EMPTY in the committed site — recorded answers
 * only, no network calls, no badges. */
const LIVE_ENDPOINT = "https://robotforge-live.abelxmendoza.workers.dev";

const DEFAULT_CHIPS = [
  "Which robots passed the gate?",
  "What are the gate thresholds?",
  "Tell me about Andino",
  "How does RobotForge work?",
];

const SUB_RECORDED = "Your robot, app records and local calculations first. Model-generated answers are labeled.";
const SUB_LIVE =
  "Recorded data first — the Robodex, the parts catalogue and the recorded gate reports. Questions they can’t answer go to a live model, badged LIVE MODEL.";

const LIVE_BADGE = "MODEL INTERPRETATION — check cited records and supplied context";

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

type Msg = ChatMessage;

let nextId = 1;

export function ChatWidget({ docked, embedded = false }: { docked: boolean; embedded?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const engine = useMemo(buildEngine, []);
  const dispatch=useDispatch();
  const savedSpec=useSelector((s:RootState)=>s.forge.activeSpec);
  const activeSource=useSelector((s:RootState)=>s.forge.source);
  const tables=useTables();
  const selected=useSelector((s:RootState)=>s.workspace.selectedTable);
  const table=tables.find(t=>t.id===selected)??tables[0];
  const pageRobot=robots.find(r=>pathname==='/robots/'+(r.slug??r.name.toLowerCase().replace(/[^a-z0-9]+/g,'-'))+'/');
  const activeSpec=pageRobot?robotSpecs[pageRobot.spec_file??'']??null:savedSpec;
  const [capture,setCapture]=useState(false),[photoBusy,setPhotoBusy]=useState(false),[shareSpec,setShareSpec]=useState(false);
  const sheetInput=useRef<HTMLInputElement>(null);

  const messages=useSelector((s:RootState)=>s.assistant.messages);
  const flow=useSelector((s:RootState)=>s.assistant.flow);
  const pendingRequest=useSelector((s:RootState)=>s.assistant.request);
  const pendingPhoto=useSelector((s:RootState)=>s.assistant.photo);
  const records=useSelector((s:RootState)=>s.workspace.records);
  const messagesRef=useRef(messages);
  messagesRef.current=messages;
  const setMessages=useCallback((change:Msg[]|((previous:Msg[])=>Msg[]))=>{
    const next=typeof change==='function'?change(messagesRef.current):change;
    messagesRef.current=next;
    dispatch(setChatMessages(next));
  },[dispatch]);
  const [chips, setChipsState] = useState<string[]>(DEFAULT_CHIPS);
  const [inputValue, setInputValue] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [wide, setWide] = useState(false);
  const [subText, setSubText] = useState(SUB_RECORDED);

  const msgsRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const greetedRef = useRef(false);
  const healthRef = useRef<Promise<LiveHealth | null> | null>(null);

  /* Docked mode (app pages, wide screens): the panel is a fixed
   * left rail and is simply open — there is nothing to toggle. The
   * media query mirrors the one in chat.css / app.css. */
  const dockedWide = docked && wide;
  const open = embedded || (docked ? dockedWide || manualOpen : manualOpen);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1280px)");
    setWide(mq.matches);
    const onChange = (ev: MediaQueryListEvent) => setWide(ev.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const el = msgsRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const setChips = useCallback(
    (list: string[] | undefined | null) => {
      setChipsState(list && list.length ? list : DEFAULT_CHIPS);
    },
    []
  );

  const appendMsg = useCallback((msg: Omit<Msg, "id">): number => {
    nextId=Math.max(nextId,...messagesRef.current.map(m=>m.id+1));
    const id = nextId++;
    setMessages((prev) => [...prev, { ...msg, id }]);
    return id;
  }, [setMessages]);

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
        body: JSON.stringify({message:q,context:makeContext(q,shareSpec?activeSpec:null,table),history:messages.filter(m=>m.text).slice(-4).map(m=>({role:m.who==='user'?'user':'assistant',content:m.text!.slice(0,900)}))}),
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
    [liveBase,activeSpec,table,messages,shareSpec]
  );

  /* ---------------- greeting ---------------- */

  const greet = useCallback(() => {
    if (greetedRef.current) return;
    if(messagesRef.current.length){greetedRef.current=true;setChips(['Create a robot','Edit my robot','Create a spreadsheet','Find robotics clubs']);return;}
    greetedRef.current = true;
    appendMsg({
      who: "bot",
      html: embedded
        ? '<p>Tell me about your robot or what you want to do. I’ll ask one question at a time and fill the records for you. You can say “skip,” correct a detail, or cancel.</p><p>Try “I own a rover called Atlas,” “I spotted a robot,” “create a spreadsheet,” or “find robotics clubs.”</p>'
        : "<p>Hello — I&rsquo;m the <strong>Forge Guide</strong>. I answer " +
        "from RobotForge&rsquo;s robot tables, your current robot, the parts catalogue " +
        "and recorded gate reports. I can also help with photos, spreadsheet calculations, component choices and sourced research.</p>" +
        "<p>Ask about a robot by name or number, a catalogue part, or how the " +
        "gate works — or tap a suggestion.</p>",
    });
    setChips(['Create a robot','Log a robot sighting','Create a spreadsheet','Find robotics clubs']);
  }, [appendMsg, engine, setChips,embedded]);

  useEffect(() => {
    if (!open) return;
    greet();
    void checkLive(); // updates the header disclosure when live is on
    /* Auto-focus only with a fine pointer: on touch devices the
     * keyboard would immediately cover the panel the user just
     * opened. */
    if (!dockedWide && window.matchMedia("(pointer: fine)").matches) {
      inputRef.current?.focus();
    }
  }, [open, dockedWide, greet, checkLive]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape" && open && !dockedWide) setManualOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, dockedWide]);

  /* ---------------- part focus + in-page actions ---------------- */

  const onRobotsPage = Boolean(pathname && pathname.startsWith("/robots"));

  const dispatchFocusPart = useCallback((id: string) => {
    window.dispatchEvent(
      new CustomEvent("rf-focus-part", { detail: { id } })
    );
  }, []);

  /* A part hit: on the Robots page, focus the part there (event +
   * the ?part= deep link the page understands); from anywhere else,
   * navigate to that deep link. */
  const focusPartHit = useCallback(
    (hit: Hit) => {
      if (!hit.id) return;
      dispatchFocusPart(hit.id);
      const url = "/robots/?part=" + encodeURIComponent(hit.id) + "#parts";
      if (onRobotsPage) {
        noteBubble(
          "I highlighted “" + hit.label + "” in the parts catalogue on this page."
        );
        router.replace(url, { scroll: false });
      } else {
        router.push(url);
      }
    },
    [dispatchFocusPart, noteBubble, onRobotsPage, router]
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
        if (partHits.length && onRobotsPage && partHits[0].id) {
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
    [dispatchFocusPart, filterPartsHere, noteBubble, onRobotsPage]
  );

  const analyzePhoto=useCallback(async(image:string,thumbnail:string,mode:'photo'|'document',note:string)=>{
    setPhotoBusy(true);
    try{
      const body=await postJSON<{draft:PhotoDraft|DocDraft}>('/photo',{image_data_url:image,note,mode});
      const spec=body.draft.spec,now=new Date();
      const ctx={records,id:crypto.randomUUID(),now:now.toISOString(),today:now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0')};
      const intake=seedRobotFlow(ctx,spec,thumbnail);
      const inferred=conversationTurn(note,intake,ctx);
      const next=inferred.flow??intake;
      dispatch(setFlow(next));dispatch(setActiveRobot({spec,source:mode==='document'?'DOCUMENT-READ: printed values only':'PHOTO: dimensions ESTIMATED'}));
      appendMsg({who:'bot',text:(mode==='document'?'I transcribed the printed values. Fields not printed remain unknown.':'I drafted the visible robot. Dimensions from its appearance are ESTIMATED, not measured.')+' '+questionFor(next)});
      setChips(next.kind==='robot'&&next.phase==='relationship'?['I own it','Research','Sighting']:['Skip','Cancel']);
    }catch(error){appendMsg({who:'bot',text:'Photo analysis did not complete: '+String(error)+'. We can still create a record from what you tell me; no photo-derived facts were saved.'});}
    finally{setPhotoBusy(false)}
  },[records,dispatch,appendMsg,setChips]);

  /* ---------------- asking ---------------- */

  const ask = useCallback(
    (question: string) => {
      const q = String(question || "").trim();
      if (!q) return;
      appendMsg({ who: "user", text: q });
      setInputValue("");
      if(pendingPhoto){
        if(/^(?:cancel|never mind|nevermind)$/i.test(q)){dispatch(setPendingPhoto(null));appendMsg({who:'bot',text:'Photo attachment discarded. Nothing was sent for analysis.'});return;}
        const mode=/document|spec.*sheet|blueprint|datasheet|printed/i.test(q)?'document':/robot|rover|drone|component|appearance|photo/i.test(q)?'photo':null;
        if(!mode){appendMsg({who:'bot',text:'Is the image a robot/component photo or a printed spec sheet? I’ll use that to choose the right analysis.'});setChips(['Robot photo','Printed spec sheet','Cancel']);return;}
        dispatch(setPendingPhoto(null));void analyzePhoto(pendingPhoto.image,pendingPhoto.thumbnail,mode,q);return;
      }
      const now=new Date();
      const ctx={records,id:crypto.randomUUID(),now:now.toISOString(),today:now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0'),seed:/\bthis (?:robot|draft)\b/i.test(q)?activeSpec:null};
      const action=conversationTurn(q,flow,ctx);
      if(action.handled){
        let nextTable=action.saveTable;
        if(nextTable){try{
          if(action.tableRows){const csv=nextTable.columns.map(c=>'"'+c.replaceAll('"','""')+'"').join(',')+'\n'+action.tableRows.replace(/^(?:add (?:a )?row(?:s)?|rows?)\s*:\s*/i,'');const parsed=parseCSV(csv,nextTable.name);nextTable={...nextTable,rows:parsed.rows};}
          if(!validTable(nextTable))throw Error('Use unique, nonempty column names.');
        }catch(error){appendMsg({who:'bot',text:'I couldn’t read those rows: '+String(error)+'. Send comma-separated values in the requested column order, or say “empty.”'});return;}}
        if(action.saveRobot&&!validRecord(action.saveRobot)){appendMsg({who:'bot',text:'That draft contains invalid data. Please correct the source links or measurements before saving.'});return;}
        dispatch(setFlow(action.flow));
        if(action.saveRobot){dispatch(saveRecord(action.saveRobot));dispatch(setActiveRobot({spec:action.saveRobot.spec,source:'Notebook: '+action.saveRobot.relationship}));}
        if(nextTable)dispatch(saveTable(nextTable));
        appendMsg({who:'bot',text:nextTable?'Created “'+nextTable.name+'” with '+nextTable.rows.length+' rows. The table is selected for chat and saved in this browser.':action.reply});
        setChips(action.chips??(action.flow?['Skip','Cancel']:['Create a robot','Create a spreadsheet','Find robotics clubs']));
        if(action.research){const resultId=appendMsg({who:'bot',text:'Retrieving source-linked results…'});void postJSON<{results:Array<{title?:string;name?:string;url:string;description?:string;license?:string;files?:Array<{path:string;download_url:string}>}>;note:string;source?:string}>(action.research.route,{query:action.research.query}).then(body=>setMessages(previous=>previous.map(m=>m.id===resultId?{...m,text:undefined,html:'<p>'+esc(body.source??'Public source search')+'</p>'+body.results.map(r=>'<p><strong>'+esc(r.title??r.name??'Result')+'</strong></p><p>'+esc(r.description??'')+'</p>'+(/^https:\/\//.test(r.url)?'<p><a href="'+esc(r.url)+'" target="_blank" rel="noreferrer">Open source</a></p>':'')+(r.files??[]).filter(f=>/^https:\/\//.test(f.download_url)).map(f=>'<p><a href="'+esc(f.download_url)+'">'+esc(f.path)+'</a></p>').join('')).join('')+'<p>'+esc(body.note)+'</p>'}:m))).catch(error=>setMessages(previous=>previous.map(m=>m.id===resultId?{...m,text:'Source retrieval is unavailable: '+String(error),html:'<p><a href="https://www.google.com/search?q='+encodeURIComponent(action.research!.query)+'" target="_blank" rel="noreferrer">Search the web for these robotics sources</a></p>'}:m)));}
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
        const priorPart=[...messages].reverse().find(m=>m.hits?.some(h=>h.kind==='part'))?.hits?.find(h=>h.kind==='part');
        const contextualQuestion=/where.*buy.*it|which.*stores.*(?:it|them)|where.*(?:get|buy).*this/i.test(q)&&priorPart?'Where can I buy '+priorPart.label:q;
        const local = groundedAnswer(contextualQuestion,table,activeSpec);
        if(/(?:find|suggest|pull|recommend|show).*(?:3|three|cad|3d).*model|(?:find|pull).*cad/i.test(q)){
          const query=q.replace(/^(find|suggest|pull|recommend|show)(?: me)?\s*/i,'').replace(/\b(?:3|three|models?|cad|3d|for|a|an|the|downloadable)\b/gi,'').trim().slice(0,200);
          void postJSON<{results:Array<{name:string;url:string;license:string;files:Array<{path:string;download_url:string}>}>;note:string}>('/models',{query}).then(body=>done({html:'<p>Downloadable model candidates from public repositories:</p>'+body.results.map(r=>'<p><strong>'+esc(r.name)+'</strong> · license: '+esc(r.license)+'</p>'+r.files.filter(f=>/^https:\/\//.test(f.download_url)).map(f=>'<p><a href="'+esc(f.download_url)+'" target="_blank" rel="noreferrer">'+esc(f.path)+'</a></p>').join('')).join('')+'<p>'+esc(body.note)+'</p>'})).catch(e=>done({html:'<p>'+esc(String(e))+'</p><p>Model search needs the updated live endpoint. <a href="/research/">Open model discovery and direct source searches</a>.</p>'}));
          return;
        }
        const ans = local ?? engine.answer(q);
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
    [appendMsg, autoAction, checkLive, engine, liveBase, liveChat, setChips,table,activeSpec,messages,flow,records,dispatch,setMessages,pendingPhoto,analyzePhoto]
  );

  useEffect(()=>{
    if(!pendingRequest||photoBusy)return;
    dispatch(requestConversation(null));
    setManualOpen(true);
    if(pendingRequest.editId){const record=records.find(r=>r.id===pendingRequest.editId);if(!record)return;const next:Flow={kind:'robot',phase:'edit',draft:{...record,spec:{...record.spec},sources:[...record.sources]},editing:true};dispatch(setFlow(next));appendMsg({who:'bot',text:'I’ve opened '+record.name+'. '+questionFor(next)});setChips(['Cancel']);}
    else if(pendingRequest.message)ask(pendingRequest.message);
  },[pendingRequest,dispatch,records,appendMsg,ask,setChips,photoBusy]);

  const onHitClick = (h: Hit) => {
    if (h.kind === "part") focusPartHit(h);
    else if (h.route) router.push(h.route);
  };

  const toggle = () => {
    if (!dockedWide) setManualOpen((v) => !v);
  };
  const close = () => {
    if (!dockedWide) setManualOpen(false);
  };

  return (
    <div className={embedded ? "forge-chat conversational-chat" : docked ? "forge-chat docked" : "forge-chat"} id="forge-chat">
      <button
        className="fc-launcher"
        id="fc-launcher"
        type="button"
        aria-expanded={open ? "true" : "false"}
        aria-controls="fc-panel"
        onClick={toggle}
        hidden={embedded}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 12a8 8 0 0 1-8 8H4l2.3-2.9A8 8 0 1 1 21 12z" />
          <path d="M8.5 11h.01M12 11h.01M15.5 11h.01" />
        </svg>
        <span>Forge Guide</span>
      </button>
      <section
        className="fc-panel"
        id="fc-panel"
        hidden={!open}
        role="dialog"
        aria-label="Forge Guide chat"
      >
        <header className="fc-head">
          <div>
            <strong>Forge Guide</strong>
            <span className="fc-sub">{subText}</span>
          </div>
          <button
            className="fc-close"
            id="fc-close"
            type="button"
            aria-label="Close chat"
            onClick={close}
            hidden={embedded}
          >
            &times;
          </button>
        </header>
        <div className="fc-context">Robot: {String(activeSpec?.name??'none selected')} · Table: {table.name}<br/>{pageRobot?'Robot page context':activeSource||'Select a robot or attach a photo'}</div>
        {flow&&<div className="fc-task" role="status"><strong>{flow.kind==='robot'?'Robot record':flow.kind==='table'?'Spreadsheet':'Research'} in progress</strong><span>{questionFor(flow)}</span><button type="button" onClick={()=>ask('cancel')}>Cancel draft</button></div>}
        <div className="fc-msgs" id="fc-msgs" role="log" aria-live="polite" ref={msgsRef}>
          {messages.map((m) =>
            m.who === "user" ? (
              <div className="fc-msg user" key={m.id}>
                {m.image&&<img src={m.image} alt="Attached robot photo"/>}{m.text}
              </div>
            ) : (
              <div className="fc-msg bot" key={m.id}>
                <div dangerouslySetInnerHTML={{ __html: m.html || "" }} />
                {m.text ? <p>{m.text}</p> : null}


                {m.hits && m.hits.length ? (
                  <div className="fc-hits">
                    {m.hits.slice(0, 6).map((h, i) => (
                      <button
                        type="button"
                        className="fc-hit"
                        data-kind={h.kind || ""}
                        key={i}
                        onClick={() => onHitClick(h)}
                      >
                        {h.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            )
          )}
        </div>
        <div className="fc-chips" id="fc-chips" aria-label="Suggested questions">
          {chips.slice(0,4).map((q, i) => (
            <button
              type="button"
              className="chip"
              key={i}
              onClick={() => ask(q)}
            >
              {q}
            </button>
          ))}
        </div>
        <div className="fc-tools">
          <button className="btn" type="button" disabled={photoBusy} onClick={()=>setCapture(true)}>{photoBusy?'Analyzing photo…':'Photo / camera'}</button>
          <button className="btn" type="button" onClick={()=>sheetInput.current?.click()}>Attach spreadsheet</button>
          <label><input type="checkbox" checked={shareSpec} onChange={e=>setShareSpec(e.target.checked)}/> Include my current spec in live replies</label><Link className="btn" href="/notebook/">My robots</Link><Link className="btn" href="/data/">Data</Link><Link className="btn" href="/research/">Research / CAD</Link>
          <input hidden ref={sheetInput} type="file" accept=".csv,.xlsx" onChange={async e=>{const file=e.target.files?.[0];if(!file)return;try{if(file.size>2_000_000)throw Error('Use a spreadsheet under 2 MB');let csv=await file.text();if(/\.xlsx$/i.test(file.name)){const {readSheet}=await import('read-excel-file/browser');const rows=await readSheet(file);csv=rows.map(row=>row.map(v=>'"'+String(v instanceof Date?v.toISOString():v??'').replaceAll('"','""')+'"').join(',')).join('\n');}const imported=parseCSV(csv,file.name);dispatch(saveTable(imported));appendMsg({who:'bot',text:'Loaded '+file.name+': '+imported.rows.length+' rows. Data stays in this browser. Ask for statistics or a probability condition; use the Data page to select other worksheets.'});}catch(error){appendMsg({who:'bot',text:String(error)})}e.target.value=''}}/>
        </div>
        {capture&&<PhotoCapture conversationOnly onClose={()=>setCapture(false)} onSelect={async(file)=>{
          const image=await prepareImage(file),thumbnail=await prepareImage(file,480);
          setCapture(false);dispatch(setPendingPhoto({image,thumbnail}));
          appendMsg({who:'user',image,text:'Attached a photo'});
          appendMsg({who:'bot',text:'Is this a robot/component photo, or a printed spec sheet or blueprint? I’ll ask for any other details in chat.'});
          setChips(['Robot photo','Printed spec sheet','Cancel']);
        }}/>}
        <form
          className="fc-form"
          id="fc-form"
          onSubmit={(ev) => {
            ev.preventDefault();
            ask(inputValue);
          }}
        >
          <input
            id="fc-input"
            type="text"
            disabled={photoBusy}
            autoComplete="off"
            placeholder={flow?"Your answer… (“skip” is okay)":"Tell me what you want to create or change…"}
            aria-label="Your question"
            ref={inputRef}
            value={inputValue}
            onChange={(ev) => setInputValue(ev.target.value)}
          />
          <button className="btn btn-primary btn-sm" type="submit" disabled={photoBusy}>
            Send
          </button>
        </form>
      </section>
    </div>
  );
}

/* Docked variant: the same chat as a persistent left rail inside
 * the app shell (site.py chat_widget(docked=True)). At min-width
 * 1280px the panel is simply open; below that it behaves as the
 * toggleable panel, mirroring the vanilla media query. */
export default function ChatDock() {
  return <ChatWidget docked={false} />;
}
