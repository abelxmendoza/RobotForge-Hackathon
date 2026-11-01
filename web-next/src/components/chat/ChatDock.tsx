"use client";
/* Headless assistant for the primary Forge conversation. Recorded answers,
 * live fallback and validated operation proposals share its single composer.
 * No floating launcher or separate chat panel is mounted. */
import {
  useCallback,
  useEffect,
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
import { gateReports, parts, robotSlug, robots, simReadyProps } from "@/lib/data";
import {
  addToBuildList,
  buildConfirmationText,
  buildPaletteItems,
  parseBuildRequest,
  type BuildEntry,
} from "@/lib/palette";
import { BUILD_KEY } from "@/lib/buildList";
import { runWiringCommand } from "@/lib/buildWiring";
import { readBuildWiring, writeBuildWiring } from "@/lib/wiringStore";
import type { Part } from "@/lib/types";
import {
  createWrench,
  isDemoRequest,
  type SourceRef,
  type TurnMemory,
  type Wrench,
} from "./wrench";
import { assetPath } from "@/components/home/asset";
import { parseNavCommand, type NavAction } from "@/lib/nav";
import { MOBILITY_CLASSES } from "@/components/robots/shared";
import { groupSlug } from "@/components/robots/GroupCard";
import { COMPONENTS } from "@/lib/components";
import partsDoc from "@/data/parts.json";
import kindsDoc from "@/data/kinds.json";
import intentsDoc from "@/data/chat-intents.json";
import InventoryProposal from './InventoryProposal';
import {INVENTORY_KEY,parseInventoryCommand,proposeInventory,type InventoryPart,type InventoryOperation} from '@/lib/inventory';
import AssemblyProposal from './AssemblyProposal';
import { ASSEMBLY_KEY, parseAssemblyCommand, previewAssembly, undoAssembly, type Assemblies, type AssemblyOperation } from '@/lib/assembly';
import { FIELD_GROUPS, GARAGE_KEY, fmtValue, type GarageRobot, type Spec } from '@/lib/garage';
import { readStore, writeStore, uid } from '@/lib/store';
import { applyOperation, parseCommand, proposeCommand, undoOperation, type Preview } from '@/lib/operations';
import { forgeValidateSpec } from '@/components/forge/validate';
import { LIVE_ENDPOINT, sessionToken } from "@/components/forge/live";
import { isDemoMode, useDemoMode } from "@/lib/demoMode";


const DEFAULT_CHIPS = [
  "Which robots passed the gate?",
  "List my robots",
  "Operations",
  "Go to wiring",
  "Tell me about Andino",
  "How does RobotForge work?",
];

const SUB_RECORDED =
  "Answers from RobotForge's recorded data (not a live AI) — the Robodex, the parts catalogue and the recorded gate reports.";
const SUB_LIVE =
  "Recorded data first — the Robodex, the parts catalogue and the recorded gate reports. Questions they can’t answer go to a live model, badged LIVE MODEL.";
const SUB_DEMO =
  "Demo mode — answers are recorded from real runs: the Robodex, the parts catalogue and the recorded gate reports. Nothing here calls the live model; sign in for live AI.";

const LIVE_BADGE =
  "LIVE MODEL — not from recorded RobotForge data; check numbers on the Evidence page";

function engineData() {
  const templates =
    (partsDoc as unknown as { templates?: TemplateData[] }).templates || [];
  return {
    robots: robots as unknown as RobotData[],
    parts: parts as unknown as PartData[],
    templates: templates.length,
    templateList: templates,
    kinds: (kindsDoc as { kinds?: KindData[] }).kinds || [],
    reports: { runs: gateReports } as unknown as ReportsData,
    intents: intentsDoc as unknown as IntentsData,
    root: "",
  };
}

function buildEngine(): Engine {
  return createEngine(engineData());
}

function buildWrench(): Wrench {
  return createWrench(engineData());
}

/* The Parts palette's catalogue, for the chat's build commands —
 * the same items and the same deterministic matcher the palette
 * and the BOM wizard use (lib/palette.ts). */
const PALETTE_ITEMS = buildPaletteItems(parts, simReadyProps);
const PARTS_BY_ID = new Map<string, Part>(parts.map((p) => [p.id, p]));

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
  sources?: SourceRef[];
}

let nextId = 1;

/* One conversation across the app. The bottom bar and the Workspace
 * each mount their own hook, never both at once (the bar is hidden on
 * /forge/), so the state is carried in module memory across client
 * navigation: "Full size" continues the same conversation, pending
 * proposal and undo included. */
type Applied = { robotId: string; versionId: string; scope?: 'assembly' } | null;
const carry: {
  messages: Msg[];
  chips: string[] | null;
  proposal: Preview | null;
  inventoryProposal: InventoryOperation | null;
  assemblyProposal: AssemblyOperation | null;
  lastApplied: Applied;
  memory: TurnMemory;
} = { messages: [], chips: null, proposal: null, inventoryProposal: null, assemblyProposal: null, lastApplied: null, memory: {} };

export function useForgeAssistant() {
  const router = useRouter();
  const pathname = usePathname();
  const engine = useMemo(buildEngine, []);
  const wrench = useMemo(buildWrench, []);
  const memoryRef = useRef<TurnMemory>(carry.memory);
  useEffect(() => () => { carry.memory = memoryRef.current; }, []);

  const [messages, setMessages] = useState<Msg[]>(() => carry.messages);
  const [chips, setChipsState] = useState<string[]>(
    () => carry.chips ?? wrench.contextChips(pathname || "", carry.memory)
  );
  const [subText, setSubText] = useState(SUB_RECORDED);
  /* Demo mode: the subtitle says so, and every live path below
   * short-circuits before any fetch (see checkLive / ask /
   * proposeViaLive). The ref mirrors the state for the callbacks. */
  const demo = useDemoMode();
  const demoRef = useRef(false);
  demoRef.current = demo;
  useEffect(() => {
    if (demo) setSubText(SUB_DEMO);
    else setSubText((prev) => (prev === SUB_DEMO ? SUB_RECORDED : prev));
  }, [demo]);

  const [proposal, setProposal] = useState<Preview | null>(() => carry.proposal);
  const [inventoryProposal,setInventoryProposal]=useState<InventoryOperation|null>(() => carry.inventoryProposal);
  const [assemblyProposal, setAssemblyProposal] = useState<AssemblyOperation | null>(() => carry.assemblyProposal);
  const lastApplied = useRef<Applied>(carry.lastApplied);
  useEffect(() => {
    carry.messages = messages;
    carry.chips = chips;
    carry.proposal = proposal;
    carry.inventoryProposal = inventoryProposal;
    carry.assemblyProposal = assemblyProposal;
  }, [messages, chips, proposal, inventoryProposal, assemblyProposal]);
  /* lastApplied is a ref, so copy it out when this instance unmounts. */
  useEffect(() => () => { carry.lastApplied = lastApplied.current; }, []);
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

  /* Demo thread: the demo opens like a first visit (Abel, 2026-11-01),
   * so Wrench starts with an empty thread and its suggestion chips,
   * not a pre-played conversation. The pre-demo thread is
   * snapshotted on entry and restored on exit, so anything asked
   * inside the demo never leaks into the visitor's real
   * conversation. */
  const demoThreadRef = useRef<{ messages: Msg[]; memory: TurnMemory } | null>(null);
  useEffect(() => {
    if (demo) {
      if (demoThreadRef.current || carry.messages.length > 0) return;
      const snapshot = {
        messages: [...carry.messages],
        memory: { ...memoryRef.current },
      };
      const seeded: Msg[] = [];
      const mem: TurnMemory = {};
      demoThreadRef.current = snapshot;
      memoryRef.current = mem;
      setMessages(seeded);
      setChips(wrench.contextChips(pathname || "", mem));
    } else if (demoThreadRef.current) {
      const snapshot = demoThreadRef.current;
      demoThreadRef.current = null;
      memoryRef.current = snapshot.memory;
      setMessages(snapshot.messages);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo]);

  /* ---------------- live model (deployment-configured) ------------ */

  const liveBase = useCallback((): string => {
    const base = LIVE_ENDPOINT || "";
    return String(base).replace(/\/+$/, "");
  }, []);

  const checkLive = useCallback((): Promise<LiveHealth | null> => {
    /* Cached /health probe: resolves to the health JSON when the
     * endpoint is configured AND answering AND able to run chat;
     * resolves to null otherwise. With no endpoint configured (the
     * shipped site) it resolves null immediately — no network call.
     * Demo mode likewise resolves null immediately: the demo never
     * probes the Worker. */
    if (isDemoMode()) return Promise.resolve(null);
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
        headers: {
          "Content-Type": "application/json",
          /* /chat is account-gated at the Worker (see
           * live/worker.js): carry the session token. Demo mode
           * never calls this — engine answers stay recorded. */
          ...(sessionToken()
            ? { Authorization: "Bearer " + sessionToken() }
            : {}),
        },
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

  /* ---------------- commands ---------------- */

  /* Run the built-in command grammars (inventory, assembly, spec edits).
   * Returns true when the text was a command — handled, or refused with a
   * bubble. Typed commands and live-model proposals share this one path,
   * so a model proposal gets exactly the validation a typed command gets,
   * and nothing applies until the user taps Apply on the preview. */
  const runCommands = (q: string): boolean => {
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
        return true;
      }
      try {
        const saved = readStore<GarageRobot[]>(GARAGE_KEY, []);
        const assemblies = readStore<Assemblies>(ASSEMBLY_KEY, {});
        const assembly = parseAssemblyCommand(q, saved, assemblies, uid('part'));
        if (assembly) {
          previewAssembly(saved, assemblies, assembly);
          setAssemblyProposal(assembly);
          noteBubble('Review the assembly action below. Apply saves it as a new assembly version, visible in My robots.');
          return true;
        }
      } catch (e) { noteBubble((e as Error).message); return true; }
      /* Build-list commands ("add a RealSense camera and two
       * wheels to my build"): resolved deterministically against
       * the palette catalogue — the same matching the BOM wizard's
       * offline step uses — and applied to the shared build list
       * (rf.build.v1) with the same add action the palette's drag
       * and Add button perform. The reply confirms what was added
       * with quantities and names anything that was not found or
       * was ambiguous; a request this grammar cannot resolve at
       * all returns null and falls through to the paths below. */
      const buildReq = parseBuildRequest(q, PALETTE_ITEMS, [
        ...robots.map((r) => r.name),
        ...readStore<GarageRobot[]>(GARAGE_KEY, []).map((r) => r.name),
      ]);
      if (buildReq) {
        try {
          let entries = readStore<BuildEntry[]>(BUILD_KEY, []);
          for (const add of buildReq.adds) {
            entries = addToBuildList(entries, add.item, add.qty, 'chat', () => uid('build'));
          }
          if (buildReq.adds.length) {
            const err = writeStore(BUILD_KEY, entries);
            if (err) throw new Error(err);
          }
          noteBubble(buildConfirmationText(buildReq));
        } catch (e) { noteBubble((e as Error).message); }
        return true;
      }
      /* Wiring commands ("wire the camera to the Orin",
       * "disconnect the lidar", "what is the camera plugged
       * into", "check my wiring"): resolved deterministically
       * against the build list's wiring graph (lib/buildWiring.ts,
       * rf.wiring.v1) — ports from recorded catalogue data only.
       * The reply confirms what changed and names every refusal;
       * shapes this grammar doesn't own (quoted or robot-directed,
       * like the build grammar) return null and fall through. */
      const wiringOutcome = runWiringCommand(
        q,
        readStore<BuildEntry[]>(BUILD_KEY, []),
        readBuildWiring(),
        PARTS_BY_ID,
        PALETTE_ITEMS,
        [
          ...robots.map((r) => r.name),
          ...readStore<GarageRobot[]>(GARAGE_KEY, []).map((r) => r.name),
        ],
        () => uid('wire'),
      );
      if (wiringOutcome) {
        try {
          if (wiringOutcome.wiring) {
            const err = writeBuildWiring(wiringOutcome.wiring);
            if (err) throw new Error(err);
          }
          noteBubble(wiringOutcome.text);
        } catch (e) { noteBubble((e as Error).message); }
        return true;
      }
      const command = parseCommand(q);
      if (command) {
        try {
          const saved = readStore<GarageRobot[]>(GARAGE_KEY, []);
          if (command.kind === 'help') {
            noteBubble('Inventory: list my inventory; list my parts for "Omega1"; set inventory "Battery" quantity to 3; assign inventory "Battery" to "Omega1". Operations available now: list my robots; set "Omega1" wheel.diameter_m to 0.12; undo last chat change. Edits use exact saved robot names and spec units (m, kg, V, mAh), preview first, and save a new version. Assembly commands: add a Jetson Orin Nano to "Omega1"; move "Jetson Orin Nano" on "Omega1" to 0 0 70 mm; connect "battery" to "Jetson Orin Nano" on "Omega1"; remove "battery" from "Omega1". Names resolve when unique; use workbench instance IDs for duplicates. Connections are planning-only, NOT_CHECKED. Navigation: open "TurtleBot3 Burger"; go to wiring; show the legged robots. Free-form operation requests (for example “make Omega1’s wheels bigger”) go to the live model when it is available: it proposes a command in this same grammar, the app validates it, and you still tap Apply. Mount generation and simulation jobs remain planned.');
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
              return true;
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
        return true;
      }
      return false;
  };

  /* ---------------- Tier 0: navigation ---------------- */

  const navContext = () => ({
    saved: readStore<GarageRobot[]>(GARAGE_KEY, []).map((r) => ({ id: r.id, name: r.name })),
    dex: robots.map((r) => ({ name: r.name, slug: robotSlug(r) })),
    groups: MOBILITY_CLASSES.map((cls) => ({ cls, slug: groupSlug(cls) })),
  });

  const goWorkshop = useCallback(
    (hash: string) => {
      if (pathname && pathname.startsWith("/garage")) {
        window.location.hash = hash.slice(1);
      } else {
        router.push("/garage/" + hash);
      }
    },
    [pathname, router]
  );

  const doNav = useCallback(
    (nav: NavAction) => {
      if (nav.kind === 'page') {
        router.push(nav.route);
        noteBubble("Opening " + nav.label + ".");
      } else if (nav.kind === 'dex-robot') {
        router.push("/robots/" + nav.slug + "/");
        noteBubble("Opening “" + nav.name + "” in the Robodex.");
      } else if (nav.kind === 'saved-robot') {
        goWorkshop("#robot=" + nav.id);
        noteBubble("Opening your robot “" + nav.name + "” in the Workshop.");
      } else if (nav.kind === 'tab') {
        goWorkshop("#tab=" + nav.tab);
        noteBubble("Opening the Workshop’s " + nav.tab + " tab.");
      } else if (nav.kind === 'group') {
        if (pathname && pathname.startsWith("/robots")) {
          window.location.hash = "group=" + nav.slug;
        } else {
          router.push("/robots/#group=" + nav.slug);
        }
        noteBubble("Showing the " + nav.cls + " robots in the Robodex.");
      }
    },
    [goWorkshop, noteBubble, pathname, router]
  );

  /* ---------------- Tier 1: model-proposed operations ---------------- */

  const buildOpContext = () => {
    const saved = readStore<GarageRobot[]>(GARAGE_KEY, []);
    const stock = readStore<InventoryPart[]>(INVENTORY_KEY, []);
    return {
      robots: saved.map((r) => r.name),
      fields: FIELD_GROUPS.flatMap((g) => g.fields.map((f) => f.path)),
      components: COMPONENTS.flatMap((c) => [c.name, ...(c.aliases || [])]),
      inventory: stock.map((p) => p.name),
    };
  };

  /* A free-form operation request the grammar missed goes to the live
   * model as a TRANSLATION task: the worker answers with one command in
   * the built-in grammar, which then runs through runCommands — the same
   * validators, preview card and Apply tap as a typed command. The model
   * never touches state itself, and a proposal that fails validation
   * changes nothing. When the live model is unavailable the old honest
   * refusal stands. */
  const proposeViaLive = async (q: string) => {
    const waitId = appendMsg({
      who: "bot",
      html: '<p class="fc-dim">Asking the live model to translate that into a command I can run&hellip;</p>',
    });
    const settle = (text: string) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === waitId ? { ...m, html: undefined, text } : m))
      );
    };
    if (isDemoMode()) {
      settle('Demo mode: free-form operations are translated by the live model, and the demo never calls it — nothing was changed. The built-in commands still run here against the demo robots (type “operations”), or exit the demo and sign in for live AI.');
      return;
    }
    const health = await checkLive();
    if (!liveUsable(health)) {
      settle('That operation is not in my built-in commands, and the live model is not available to translate it, so nothing was changed. Type “operations” for the commands I can execute directly.');
      return;
    }
    try {
      const res = await fetch(liveBase() + "/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(sessionToken()
            ? { Authorization: "Bearer " + sessionToken() }
            : {}),
        },
        body: JSON.stringify({ message: q, op_context: buildOpContext() }),
      });
      const body = (await res.json().catch(() => null)) as
        | { answer?: unknown; command?: unknown }
        | null;
      if (!res.ok || !body) throw new Error("endpoint -> " + res.status);
      const cmd = typeof body.command === "string" ? body.command.trim() : "";
      if (cmd) {
        settle("The live model proposed this command: “" + cmd + "” — it goes through the same checks as a typed command, and nothing is applied until you tap Apply.");
        if (!runCommands(cmd)) {
          noteBubble("That proposed command did not pass the app’s checks, so nothing was changed.");
        }
        return;
      }
      const ans = typeof body.answer === "string" ? body.answer.trim() : "";
      settle(ans
        ? ans + " Nothing was changed — I could not turn that into a supported command."
        : "The live model could not turn that into a supported command, so nothing was changed.");
    } catch {
      settle("The live endpoint isn’t answering, so nothing was changed. Type “operations” for the commands I can execute directly.");
    }
  };

  /* ---------------- asking ---------------- */

  const ask = useCallback(
    (question: string) => {
      const q = String(question || "").trim();
      if (!q) return;
      appendMsg({ who: "user", text: q });
      setProposal(null);
      setAssemblyProposal(null);
      setInventoryProposal(null);
      if (runCommands(q)) return;
      const nav = parseNavCommand(q, navContext());
      if (nav) { doNav(nav); return; }
      /* Operation verbs the grammar missed: never send them to an
       * answer-only path that could claim an action happened. They go to
       * the Tier-1 translator, which can only propose a validated
       * command, or they are refused plainly. */
      if (!isDemoRequest(q) && /^(?:add|remove|delete|move|place|mount|connect|wire|disconnect|generate|export|run|save|set|undo|make|change|increase|decrease|bigger|smaller|heavier|lighter)\b/i.test(q)) {
        void proposeViaLive(q);
        return;
      }
      const waitId = appendMsg({
        who: "bot",
        html: '<p class="fc-dim">Checking the recorded data&hellip;</p>',
      });
      const done = (ans: AnswerResult & { sources?: SourceRef[] }) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === waitId ? { ...m, html: ans.html, hits: ans.hits, sources: ans.sources } : m
          )
        );
        setChips(
          ans.chips && ans.chips.length
            ? ans.chips
            : wrench.contextChips(pathname || "", memoryRef.current)
        );
        autoAction(q, ans);
      };
      /* The vanilla widget answers inside its data-load promise, so
       * the "Checking…" bubble paints first; the data here is a
       * static import, so defer one tick to keep the same rhythm. */
      window.setTimeout(() => {
        const turn = wrench.answerTurn(q, memoryRef.current);
        memoryRef.current = turn.memory || {};
        const ans: AnswerResult & { sources?: SourceRef[] } = turn;
        /* Recorded answers stay the default and stay instant: only
         * the engine's honest fallback may go live. In demo mode the
         * fallback stays recorded too, with the demo note attached —
         * no /health probe, no /chat call. */
        if (!ans.fallback || !liveBase() || demoRef.current) {
          done(
            demoRef.current && ans.fallback
              ? {
                  ...ans,
                  html:
                    ans.html +
                    '<p class="fc-live-note">Demo mode: that answer is from the recorded data only — the demo never calls the live model. Exit the demo and sign in for live AI.</p>',
                }
              : ans
          );
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
                sources: ans.sources,
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
                sources: ans.sources,
              });
            });
        });
      }, 0);
    },
    [appendMsg, autoAction, checkLive, doNav, engine, liveBase, liveChat, pathname, proposeViaLive, runCommands, setChips, wrench, noteBubble]
  );

  /* The fix handoff: a failing robot's recorded spec goes into the
   * Workshop exactly the way its own "From the Robodex" add flow
   * loads it — fetched spec, a Baseline version sourced 'robodex' —
   * and the user lands in the Workshop, where the fix loop and the
   * checks live. Nothing is changed about the robot until the user
   * works on it there. */
  const fixHandoff = useCallback(
    (hit: Hit) => {
      const slug = String(hit.id || "").slice("fix:".length);
      const robot = robots.find((r) => robotSlug(r) === slug);
      if (!robot || !robot.spec_file) {
        noteBubble("I couldn't find that robot's recorded spec file, so nothing was sent to the Workshop.");
        return;
      }
      const specFile: string = robot.spec_file;
      fetch(assetPath(specFile))
        .then((r) => {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.json() as Promise<Spec>;
        })
        .then((spec) => {
          const saved = readStore<GarageRobot[]>(GARAGE_KEY, []);
          if (saved.some((g) => g.name === robot.name)) {
            noteBubble(
              "“" + robot.name + "” is already in your Workshop — opening it there. Its saved versions are unchanged."
            );
          } else {
            const nowIso = new Date().toISOString();
            const entry: GarageRobot = {
              id: uid("robot"),
              name: robot.name,
              createdAt: nowIso,
              versions: [
                {
                  id: uid("v"),
                  label: "Baseline",
                  note: "Started from " + robot.name + " — sent from chat to work on its recorded gate failure",
                  source: "robodex",
                  createdAt: nowIso,
                  spec: spec,
                },
              ],
            };
            const error = writeStore(GARAGE_KEY, [...saved, entry]);
            if (error) throw new Error(error);
            noteBubble(
              "I put “" + robot.name + "” in your Workshop with its recorded spec as the Baseline version. " +
                "Open it there and run the fix loop — the checks decide whether a change holds."
            );
          }
          router.push("/garage/");
        })
        .catch((e: Error) => {
          noteBubble("I couldn't load that spec (" + e.message + "), so nothing was sent to the Workshop.");
        });
    },
    [noteBubble, router]
  );

  const onHitClick = (h: Hit) => {
    if (h.kind === "action") {
      if (h.id && h.id.indexOf("fix:") === 0) {
        fixHandoff(h);
        return;
      }
      if (h.route) {
        router.push(h.route);
        return;
      }
    }
    if (h.kind === "part") focusPartHit(h);
    else if (h.route) router.push(h.route);
  };

  /* Visible reset: clears the conversation, the session memory and
   * any pending proposal. Saved robots and inventory are untouched. */
  const resetConversation = useCallback(() => {
    setMessages([]);
    setProposal(null);
    setAssemblyProposal(null);
    setInventoryProposal(null);
    lastApplied.current = null;
    memoryRef.current = {};
    carry.messages = [];
    carry.proposal = null;
    carry.inventoryProposal = null;
    carry.assemblyProposal = null;
    carry.memory = {};
    setChipsState(wrench.contextChips(pathname || "", {}));
  }, [pathname, wrench]);

  return {ask,messages,chips,onHitClick,subText,resetConversation,actions: <div className="main-chat-actions">
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
