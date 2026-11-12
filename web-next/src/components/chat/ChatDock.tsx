"use client";
import { parseRoverKitCommand, requestRoverKit } from '@/lib/roverKit';
import {UNITY_ASYNC_EVENT} from '@/lib/unityProtocol';
import type {UnityRequest} from '@/components/unity/UnityWorkshop';
import {parseHumanoidCommand,requestHumanoid} from '@/lib/humanoid';
import { parseBenchCommand, requestBench } from '@/lib/workshopBench';
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
import { conversationMessage, spawnDesignPrompt, contextualWebIntent } from "@/lib/museConversation";
import { promptWrench } from "@/lib/wrenchPrompt";
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
import { gateReports, parts, robotSlug, robots, simReadyProps, toolMaterialItems } from "@/lib/data";
import { OWNERSHIP_KEY, chatSnapshot, type OwnershipMap } from "@/lib/toolsMaterials";
import { DEFAULT_PROFILE, PROFILE_KEY, type ConstraintsProfile } from "@/lib/buildPlan";
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
import DexMoveProposal from './DexMoveProposal';
import RobotDeleteProposal from './RobotDeleteProposal';
import {classifyRobot,deleteRefusal,isCurrentRobotName,ownedRobotsText,ownershipAnswer,parseOwnershipAsk} from '@/lib/robotOwnership';
import {buildDexEntities,DEX_TAB_LABEL,normalizeDexName,parseDexMove,planDexMove,resolveDexEntity,type DexMovePlan} from '@/lib/dexCategorize';
import {DEX_OVERRIDES_KEY,type DexOverrides} from '@/lib/dexOverrides';
import {isPhotoDraft} from '@/lib/robotSource';
import {allDexSightings} from '@/components/robots/DexSources';
import {buildOmega1SeedEntry,OMEGA1_ROBOT_ID} from '@/lib/omega1Garage';
import { buildWsContext, groundingCaption, isWorkshopRobotQuestion, parseReassembleCommand, parseWorkshopAction, snapshotAnswer, readWorkshopContext, requestReassemble, requestWorkshopAction, requestWorkshopFix, workingOnLabel, workshopSnapshotFailing, workshopTabChips, WORKSHOP_CONTEXT_EVENT, type WorkshopChatContext } from "@/lib/workshopContext";
import { addRobotNote, cleanNoteText, parseRememberCommand } from "@/lib/robotNotes";
import AssemblyProposal from './AssemblyProposal';
import UpgradeProposal, { type UpgradeRequest } from './UpgradeProposal';
import { VexBuildsCard, VexEditCard, type VexEditPlan } from './VexBuilds';
import { PartEditCard, PartLookCard, type PartEditRequest, type PartLookRequest } from './PartEditCard';
import { applyPartEdit, describeChanges, parseLookEdit, parsePartEdit, pickRobot } from '@/lib/partEdit';
import { partMeshAvailable, readLookFiles, saveLookFile, type MeshJob } from '@/lib/partMesh';
import { taBuildParts } from '@/components/kit/takeapart';
import type { RobotSpec } from '@/components/forge/model';
import { editVexSpec, parseVexEdit, parseVexSuggest, suggestVexBuilds, vexParamsOf, type VexBuild } from '@/lib/vexBuilds';
import { parseUpgradeRequest, parseUpgradeFacts } from '@/lib/upgradeRequest';
import { ASSEMBLY_KEY, currentAssembly, effectiveAssemblies, parseAssemblyCommand, previewAssembly, undoVersionedAssembly, type Assemblies, type AssemblyOperation } from '@/lib/assembly';
import { FIELD_GROUPS, GARAGE_KEY, fmtValue, getPath, partToChanges, setPath, type GarageRobot, type Spec } from '@/lib/garage';
import { downloadText, readStore, writeStore, uid } from '@/lib/store';
import { runEngineChecks, syncPlannedPart, type CataloguePart } from "@/lib/forgeEngine";
import {
  addWebRecord, buildWebProposal, classifyProposalReply, detectWebAddIntent,
  formatProposalText, formatSavedText, isShortReply, mergeCatalogue,
  proposalToRecord, recordWebAddition, toCataloguePart, WEB_PARTS_KEY,
  extractImagesFromText, webFindsFromSearch, type WebFind,
  type ProposalFieldChange, type WebPartProposal, type WebPartRecord,
} from "@/lib/webParts";
import {catalogItems,changeLibrary,parseLibraryCommand,saveCadDesign,mergeLibraryExport,type LibraryCommand} from '@/lib/partsLibrary';
import {parseSimCommand,SIM_COMMAND_EVENT} from '@/lib/simulation';
import { cadFromText } from "@/lib/cadGen";
import { activeRecords } from '@/lib/lifecycle';
import { readActiveRobots } from '@/lib/robotLifecycleRepository';
import { REPO_IMPORT_EVENT, repoLinkIn } from '@/lib/repoLink';
import { SAMPLE_CHIP, SAMPLE_PROMPT, isSampleAsk, sampleAnswerHtml } from '@/lib/sampleRobot';
import { applyOperation, parseCommand, proposeCommand, undoOperation, type Preview } from '@/lib/operations';
import { appendFreshBaseline, buildDexEntry, copyAsNew, isOmega1Name, parseSaveChoice, parseSaveCommand, planSave, recordAddedPart, resolveCataloguePart, resolveSaveTarget, uniqueCopyName, type DexRobotRef } from '@/lib/saveRobot';
import { forgeValidateSpec } from '@/components/forge/validate';
import { LIVE_ENDPOINT, sessionToken } from "@/components/forge/live";
import { isDemoMode, useDemoMode } from "@/lib/demoMode";
import { buildWebGrounding, detectWebIntent, extractFirstUrl, webSourceCaption, type WebFetchResult } from "@/lib/webIntent";


const DEFAULT_CHIPS = [
  "Which robots passed the gate?",
  "List my robots",
  "Operations",
  "Go to wiring",
  "Tell me about Andino",
  "How does RobotForge work?",
];

/* Wrench is a live AI for signed-in users: the recorded data answers
 * first (instant, cited) and the live model takes the rest. The
 * subtitle says "live" only once /health confirms the model can chat,
 * and says plainly when it can't (owner, 2026-11-04). */
const SUB_CHECKING =
  "Live AI, grounded in RobotForge\u2019s data. Connecting to the live model\u2026";
const SUB_LIVE =
  "Live AI, grounded in RobotForge\u2019s data: Muse handles conversation with recent context; explicit app commands still use checked previews. Live replies are badged LIVE MODEL.";
const SUB_OFF =
  "The live AI is switched off or out of budget for today, so answers come from RobotForge\u2019s recorded data: the Robodex, the parts catalogue and the recorded gate reports.";
const SUB_RECORDED =
  "The live AI isn\u2019t reachable right now, so answers come from RobotForge\u2019s recorded data: the Robodex, the parts catalogue and the recorded gate reports.";
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
    /* §11 tools & materials: resolved at ANSWER time through the
     * store layer (demo mode reads the ".demo" twins), so a flip
     * in the Workshop's Tools & Materials tab is visible to the
     * very next answer. All state rules live in
     * lib/toolsMaterials.ts; the engine renders the snapshot. */
    toolsMaterials: () => chatSnapshot(
      toolMaterialItems,
      readStore<OwnershipMap>(OWNERSHIP_KEY, {}),
      readStore<ConstraintsProfile>(PROFILE_KEY, DEFAULT_PROFILE),
      new Date().toISOString(),
    ),
    /* Your robots = the active robots in your Workshop, read at answer
     * time (the same list the Robodex's My robots tab shows). */
    myRobots: myRobotNames,
  };
}

function myRobotNames(): string[] {
  return readActiveRobots(() => readStore<GarageRobot[]>(GARAGE_KEY, [])).map((r) => r.name);
}

/* The live model gets the same line Wrench answers from: which robots
 * are the user's own (their Workshop), so it never calls a Robodex
 * robot "yours". Appended to the message, inside the Worker's 2,000
 * character cap; dropped when it would not fit. */
const LIVE_MESSAGE_CAP = 2000;
function withOwnership(q: string): string {
  const names = myRobotNames().slice(0, 20).map((n) => n.slice(0, 60));
  const line = "\n\n(App context, not typed by the user: the user's own robots are exactly the ones in their RobotForge Workshop" +
    (names.length ? ": " + names.join(", ") + "." : ", which is empty right now.") +
    " Every other robot, including Robodex and catalogue robots, is a reference robot, not theirs.)";
  return q.length + line.length <= LIVE_MESSAGE_CAP ? q + line : q;
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
  routes?: { chat?: boolean; web?: boolean };
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
  /* Set ONLY on a live answer that was grounded in the Workshop
   * snapshot actually sent with that question (captured in liveChat
   * at ask time, never re-read at render). Recorded answers — and
   * live attempts that fell back to one — carry no grounding, so
   * they never show a caption or a Fix button they did not earn. */
  grounding?: { caption: string; failing: boolean; note?: GroundedNote };
  /* Set ONLY on a local Create-panel action result (ComposerCreate:
   * Forge Engine generation / modification, Forge Tests): the pill
   * names the deterministic engine that ran, and openAction routes
   * to the robot in the Workshop. These messages never go through
   * the recorded/live answer pipeline and never carry grounding. */
  pill?: string;
  openAction?: { robotId: string; tab?: string; label: string };
  /* Pictures a fetched page states, and shoppable search finds
   * (lib/webParts). Only ever set from a real /web fetch. */
  images?: string[];
  finds?: WebFind[];
}

/* A web-sourced answer about a Workshop robot that can be kept in that
 * robot's notes (lib/robotNotes) with one tap. */
export type GroundedNote = { robotId: string; robotName: string; text: string; source: string };

let nextId = 1;

/* One conversation across the app. The bottom bar and the Workspace
 * each mount their own hook, never both at once (the bar is hidden on
 * /forge/), so the state is carried in module memory across client
 * navigation: "Full size" continues the same conversation, pending
 * proposal and undo included. */
type Applied = { robotId: string; versionId: string; scope?: 'assembly' } | null;

/* A pending web-knowledge proposal (lib/webParts): a record
 * extracted from a fetched page, presented in chat, waiting for
 * the visitor's yes. It lives only in the conversation — nothing
 * is written anywhere until landWebProposal runs on an explicit
 * affirmative. Robot-directed proposals carry the field changes
 * (or the addition-only flag) computed at proposal time; the save
 * re-reads the store before writing, like every other path here. */
interface PendingWebProposal {
  proposal: WebPartProposal;
  targetRobotId?: string;
  targetRobotName?: string;
  changes?: ProposalFieldChange[];
  additionOnly?: boolean;
  reasked: boolean;
}

/* Which Garage field family a web part can drive through
 * lib/garage.partToChanges: wheels and motors map directly; a
 * power part maps to the battery fields only when the page stated
 * a capacity (the field family's anchor value). Anything else is
 * recorded on the robot as a planned addition instead. */
function webFieldCategory(p: WebPartProposal): 'battery' | 'motor' | 'wheel' | null {
  if (p.category === 'wheels') return 'wheel';
  if (p.category === 'actuators') return 'motor';
  if (p.category === 'power' && 'capacity_mah' in p.specs) return 'battery';
  return null;
}
const carry: {
  messages: Msg[];
  chips: string[] | null;
  proposal: Preview | null;
  inventoryProposal: InventoryOperation | null;
  dexMoveProposal: DexMovePlan | null;
  robotDeleteProposal: GarageRobot | null;
  assemblyProposal: AssemblyOperation | null;
  upgradeProposal: UpgradeRequest | null;
  vexBuilds: VexBuild[] | null;
  vexEditPlan: VexEditPlan | null;
  lastApplied: Applied;
  memory: TurnMemory;
} = { messages: [], chips: null, proposal: null, inventoryProposal: null, dexMoveProposal: null, robotDeleteProposal: null, assemblyProposal: null, upgradeProposal: null, vexBuilds: null, vexEditPlan: null, lastApplied: null, memory: {} };

export function useForgeAssistant() {
  const router = useRouter();
  const pathname = usePathname();
  const engine = useMemo(buildEngine, []);
  const wrench = useMemo(buildWrench, []);
  /* On the Workshop, the suggestion chips follow the robot on screen
   * and its open tab (lib/workshopContext) instead of the recorded
   * engine's page defaults — the questions they ask ride out with
   * that snapshot attached (see liveChat). The wrench layer itself
   * stays free of app state: it is compiled standalone by its eval
   * harness, so the Workshop branch lives here, not in contextChips. */
  const chipsFor = (mem: TurnMemory): string[] => {
    if ((pathname || "").startsWith("/garage")) {
      const ws = readWorkshopContext();
      if (ws) return workshopTabChips(ws);
    }
    const { contextChips } = wrench;
    const base = contextChips(pathname || "", mem);
    /* The first sample robot (lib/sampleRobot.ts): while the
     * current store has no robots of its own — a demo first visit
     * before seeding lands, or a new account's empty Garage — the
     * FIRST chip offers the Omega1 sample. Tapping it sends
     * SAMPLE_PROMPT (see ask), whose repo link opens the importer. */
    try {
      const mine = readActiveRobots(() => readStore<GarageRobot[]>(GARAGE_KEY, []));
      if (mine.length === 0 && !base.includes(SAMPLE_CHIP)) {
        return [SAMPLE_CHIP, ...base];
      }
    } catch {
      /* storage unreadable: fall back to the plain suggestions */
    }
    return base;
  };
  const memoryRef = useRef<TurnMemory>(carry.memory);
  useEffect(() => () => { carry.memory = memoryRef.current; }, []);

  /* Garage republishes its snapshot on every change; only a robot or
   * tab switch refreshes the chips, so editing a spec field does not
   * churn the suggestion row under a half-typed question. */
  const wsChipKey = useRef("");
  /* "Working on: Omega1 · Build" while a Workshop robot is open. */
  const [workingOn, setWorkingOn] = useState(() => ((pathname || "").startsWith("/garage") ? workingOnLabel(readWorkshopContext()) : ""));
  useEffect(() => {
    const onWs = () => {
      if (!(pathname || "").startsWith("/garage")) { setWorkingOn(""); return; }
      const ws = readWorkshopContext();
      setWorkingOn(workingOnLabel(ws));
      const key = ws ? ws.robotName + "|" + ws.tab : "";
      if (key === wsChipKey.current) return;
      wsChipKey.current = key;
      setChipsState(chipsFor(memoryRef.current));
    };
    window.addEventListener(WORKSHOP_CONTEXT_EVENT, onWs);
    return () => window.removeEventListener(WORKSHOP_CONTEXT_EVENT, onWs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, wrench]);

  const [messages, setMessages] = useState<Msg[]>(() => carry.messages);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const [chips, setChipsState] = useState<string[]>(
    () => carry.chips ?? chipsFor(carry.memory)
  );
  const [subText, setSubText] = useState(LIVE_ENDPOINT ? SUB_CHECKING : SUB_RECORDED);
  /* Demo mode: the subtitle says so, and every live path below
   * short-circuits before any fetch (see checkLive / ask /
   * proposeViaLive). The ref mirrors the state for the callbacks. */
  const demo = useDemoMode();
  const demoRef = useRef(false);
  demoRef.current = demo;

  const [proposal, setProposal] = useState<Preview | null>(() => carry.proposal);
  const [inventoryProposal,setInventoryProposal]=useState<InventoryOperation|null>(() => carry.inventoryProposal);
  const [dexMoveProposal,setDexMoveProposal]=useState<DexMovePlan|null>(() => carry.dexMoveProposal);
  const [robotDeleteProposal,setRobotDeleteProposal]=useState<GarageRobot|null>(() => carry.robotDeleteProposal);
  const [assemblyProposal, setAssemblyProposal] = useState<AssemblyOperation | null>(() => carry.assemblyProposal);
  const [upgradeProposal, setUpgradeProposal] = useState<UpgradeRequest | null>(() => carry.upgradeProposal);
  const [vexBuilds, setVexBuilds] = useState<VexBuild[] | null>(() => carry.vexBuilds);
  const [vexEditPlan, setVexEditPlan] = useState<VexEditPlan | null>(() => carry.vexEditPlan);
  /* One-part edits (lib/partEdit.ts): a size change waiting for
   * Apply, or a look being generated / waiting for Keep. */
  const [partEditReq, setPartEditReq] = useState<PartEditRequest | null>(null);
  const [partLookReq, setPartLookReq] = useState<PartLookRequest | null>(null);
  const lastApplied = useRef<Applied>(carry.lastApplied);
  useEffect(() => {
    carry.messages = messages;
    carry.chips = chips;
    carry.proposal = proposal;
    carry.inventoryProposal = inventoryProposal;
    carry.dexMoveProposal = dexMoveProposal;
    carry.robotDeleteProposal = robotDeleteProposal;
    carry.assemblyProposal = assemblyProposal;
    carry.upgradeProposal = upgradeProposal;
    carry.vexBuilds = vexBuilds;
    carry.vexEditPlan = vexEditPlan;
  }, [messages, chips, proposal, inventoryProposal, dexMoveProposal, robotDeleteProposal, assemblyProposal, upgradeProposal, vexBuilds, vexEditPlan]);
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

  /* Create-panel results (components/chat/ComposerCreate): local,
   * deterministic engine actions posted as their own message kind —
   * pill + text + an optional Open-in-Workshop action — outside the
   * recorded/live answer pipeline entirely. */
  const postCreateResult = useCallback(
    (r: { pill: string; text: string; openAction?: { robotId: string; tab?: string; label: string } }) => {
      appendMsg({ who: "bot", text: r.text, pill: r.pill, openAction: r.openAction });
    },
    [appendMsg]
  );

  /* Open a saved robot in the Workshop, optionally on a named tab.
   * On /garage the Garage is already mounted and reads the combined
   * #robot=<id>&tab=<tab> hash; from anywhere else the router lands
   * on the same hash. */
  const openRobot = useCallback(
    (robotId: string, tab?: string) => {
      const hash = "robot=" + robotId + (tab ? "&tab=" + tab : "");
      if ((pathname || "").startsWith("/garage")) {
        window.location.hash = hash;
      } else {
        router.push("/garage/#" + hash);
      }
    },
    [pathname, router]
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
      setChips(chipsFor(mem));
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

  /* Probe the live model as soon as Wrench opens (not on the first
   * question that misses the recorded data), so the subtitle tells
   * the truth from the start. Demo mode never probes. */
  useEffect(() => {
    if (demo) { setSubText(SUB_DEMO); return; }
    if (!liveBase()) { setSubText(SUB_RECORDED); return; }
    setSubText((prev) => (prev === SUB_DEMO ? SUB_CHECKING : prev));
    let live = true;
    void checkLive().then((h) => {
      if (!live) return;
      if (liveUsable(h)) setSubText(SUB_LIVE);
      else if (h && h.ok && (h.mode === "off" || (h.budget && h.budget.exhausted))) setSubText(SUB_OFF);
      else setSubText(SUB_RECORDED);
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo, checkLive]);

  /* The one /web fetch (Firecrawl via the Worker's /web route),
   * shared by web grounding and the web knowledge loop's proposal
   * path. When the question carries an explicit web intent
   * (lib/webIntent.ts — a pasted URL, or an opening "search the web
   * for …"), fetch the page/search and return the raw result.
   * Every failure resolves null: no intent, route off (health
   * reports routes.web false — which includes the
   * not-yet-configured 501 state), fetch failure or an empty body.
   * Demo mode never reaches here: callers only run this on the
   * live path, after checkLive, and checkLive itself refuses in
   * demo. */
  const fetchWebResult = useCallback(
    async (q: string): Promise<WebFetchResult | null> => {
      const intent = contextualWebIntent(q, messagesRef.current, detectWebIntent(q));
      if (!intent) return null;
      const h = await checkLive();
      if (!h || !h.routes || !h.routes.web) return null;
      try {
        const r = await fetch(liveBase() + "/web", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(sessionToken()
              ? { Authorization: "Bearer " + sessionToken() }
              : {}),
          },
          body: JSON.stringify(
            intent.kind === "scrape"
              ? { mode: "scrape", url: intent.url }
              : { mode: "search", query: intent.query, limit: 5 }
          ),
        });
        if (!r.ok) return null;
        const body = (await r.json().catch(() => null)) as
          | WebFetchResult
          | null;
        return body;
      } catch {
        return null;
      }
    },
    [checkLive, liveBase]
  );

  /* Web grounding: hand the formatted, source-labelled block from
   * a successful fetch to liveChat as web_context. A fetch that
   * produced no content or no source earns no grounding and no
   * caption — the live answer then proceeds with NO web claim. */
  const fetchWebGrounding = useCallback(
    async (
      q: string
    ): Promise<{ context: string; caption: string; finds: WebFind[]; images: string[] } | null> => {
      const body = await fetchWebResult(q);
      if (!body) return null;
      const context = buildWebGrounding(body);
      const caption = webSourceCaption(body);
      if (!context || !caption) return null;
      return {
        context, caption,
        finds: webFindsFromSearch(body as Parameters<typeof webFindsFromSearch>[0]),
        images: body.mode === 'scrape' ? extractImagesFromText(String(body.markdown || '')) : [],
      };
    },
    [fetchWebResult]
  );

  const liveChat = useCallback(
    (
      q: string,
      web?: { context: string; caption: string } | null
    ): Promise<{
      answer: string;
      ws: WorkshopChatContext | null;
      webCaption: string | null;
    }> => {
      /* On the Workshop, the question carries the published snapshot
       * of the robot on screen (see lib/workshopContext), so the live
       * answer is about that robot. Anywhere else the snapshot is
       * empty and the call is exactly what it was before. The snapshot
       * is captured HERE, at ask time, and returned with the answer:
       * the grounding caption on the rendered answer names the robot
       * that was actually sent, not whatever is on screen later. */
      const ws = readWorkshopContext();
      return fetch(liveBase() + "/chat", {
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
        body: JSON.stringify({
          message: conversationMessage(withOwnership(q), messagesRef.current),
          ...(ws
            ? {
                ws_context: buildWsContext(
                  ws,
                  readStore<InventoryPart[]>(INVENTORY_KEY, []).map((p) => p.name)
                ),
              }
            : {}),
          /* Optional and backward-compatible: present only when a
           * /web fetch actually succeeded for this question. */
          ...(web ? { web_context: web.context } : {}),
        }),
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
            return { answer: body.answer, ws, webCaption: web ? web.caption : null };
          })
      );
    },
    [liveBase]
  );

  /* ---------------- web knowledge loop ---------------- */

  /* A proposal extracted from a fetched page, waiting for the
   * visitor's yes (see PendingWebProposal above). A ref, like the
   * save-collision choice below: it is conversation state, not
   * app state, and reset clears it. */
  const pendingWebProposal = useRef<PendingWebProposal | null>(null);
  const pendingLibraryImport=useRef<{doc:unknown;stock:string;web:string}|null>(null);
  const pendingLibrary = useRef<{command:LibraryCommand;expected:string;webExpected:string;robotsExpected:string;id:string}|null>(null);

  const prepareLibraryImport=(doc:unknown)=>{
    try{
      const current=readStore<InventoryPart[]>(INVENTORY_KEY,[]),web=readStore<WebPartRecord[]>(WEB_PARTS_KEY,[]);
      const preview=mergeLibraryExport(doc,current,web);
      pendingLibrary.current=null;pendingWebProposal.current=null;
      pendingLibraryImport.current={doc,stock:JSON.stringify(current),web:JSON.stringify(web)};
      noteBubble(`This export adds ${preview.added} record${preview.added===1?'':'s'} to your Library. Existing IDs stay unchanged. Photos restore as thumbnails. Reply “yes” to import or “no” to cancel.`);
    }catch(e){noteBubble('Library not imported: '+(e as Error).message);}
  };

  /* Propose: an add/update ask carrying a page URL fetches the
   * page (the same gated /web route as grounding), extracts a
   * structured record deterministically (lib/webParts), and
   * presents it in chat. A robot-directed ask resolves its robot
   * first and computes the field changes against the robot's
   * latest version, so the proposal shows old → new before
   * anything is saved. Refusals are posted plainly; a question
   * (no add intent) never reaches here. */
  const proposeFromWeb = async (q: string) => {
    const body = await fetchWebResult(q);
    if (!body || body.mode !== 'scrape') {
      noteBubble("I couldn't fetch that page — the web route didn't answer with it — so nothing was proposed and nothing was saved.");
      return;
    }
    const proposal = buildWebProposal(body, new Date().toISOString());
    if (!proposal) {
      noteBubble("That page didn't yield a record I can stand behind — no usable name, or no specs I could tie to the page text — so I proposed nothing and saved nothing.");
      return;
    }
    const intent = detectWebAddIntent(q);
    if (intent && intent.kind === 'robot') {
      const saved = activeRecords(readStore<GarageRobot[]>(GARAGE_KEY, []));
      const matches = saved.filter((r) => r.name.toLowerCase() === intent.robotName.toLowerCase());
      if (matches.length !== 1) {
        noteBubble("I don't have exactly one saved robot called “" + intent.robotName + "”, so I didn't aim that proposal at any robot. Nothing was saved. To keep the part on its own instead, paste the link with just “add this”.");
        return;
      }
      const robot = matches[0];
      const latest = robot.versions.at(-1);
      const specVals: Record<string, unknown> = {};
      for (const [k, e] of Object.entries(proposal.specs)) specVals[k] = e.value;
      const fc = webFieldCategory(proposal);
      const changes: ProposalFieldChange[] = (fc ? partToChanges({ category: fc, specs: specVals, quantity: 1 }) : [])
        .map((c) => ({ path: c.path, before: getPath(latest?.spec, c.path), after: c.value }))
        .filter((c) => JSON.stringify(c.before) !== JSON.stringify(c.after));
      pendingWebProposal.current = {
        proposal,
        targetRobotId: robot.id,
        targetRobotName: robot.name,
        changes,
        additionOnly: changes.length === 0,
        reasked: false,
      };
      appendMsg({ who: "bot", text: formatProposalText(proposal, { robotName: robot.name, changes, additionOnly: changes.length === 0 }), images: proposal.images });
      return;
    }
    pendingWebProposal.current = { proposal, reasked: false };
    appendMsg({ who: "bot", text: formatProposalText(proposal), images: proposal.images });
  };

  /* Land: the ONLY writer in the loop, run by ask() on an explicit
   * affirmative. The record always lands in the web parts store;
   * a robot-directed proposal then applies to the robot as a NEW
   * version (history kept, planned flag set — the figures are
   * unverified), and when the robot carries Forge Engine data its
   * checks re-run against the merged catalogue and any verdict
   * change is reported in the confirmation. */
  const landWebProposal = (pending: PendingWebProposal) => {
    const nowIso = new Date().toISOString();
    const record = proposalToRecord(pending.proposal, nowIso);
    const records = addWebRecord(readStore<WebPartRecord[]>(WEB_PARTS_KEY, []), record);
    const listErr = writeStore(WEB_PARTS_KEY, records);
    if (listErr) { noteBubble("I couldn't save (" + listErr + "). Nothing was saved."); return; }
    if (!pending.targetRobotId) { noteBubble(formatSavedText(record)); return; }
    const all = readStore<GarageRobot[]>(GARAGE_KEY, []);
    const robot = activeRecords(all).find((r) => r.id === pending.targetRobotId);
    if (!robot) {
      noteBubble("Saved “" + record.name + "” to your web parts list, but “" + (pending.targetRobotName || "that robot") + "” is no longer in your Garage, so no robot was changed.");
      return;
    }
    const latest = robot.versions.at(-1);
    let newSpec: Spec = latest?.spec;
    let label: string;
    let note: string;
    if (pending.changes && pending.changes.length) {
      for (const c of pending.changes) newSpec = setPath(newSpec, c.path, c.after);
      label = "Web-sourced update";
      note = "Web-sourced spec update from " + record.provenance.sourceUrl + " (fetched " + record.provenance.fetchedAt.slice(0, 10) + ") — " + record.verification + ". Fields set: " + pending.changes.map((c) => c.path).join(", ") + ". Confirmed in chat; the figures are unverified until checked against the real part.";
    } else {
      const added = recordWebAddition(latest?.spec, record);
      if (added.already) {
        noteBubble("“" + record.name + "” is already recorded on “" + robot.name + "”, so the robot is unchanged. The part itself is in your web parts list.");
        return;
      }
      newSpec = added.spec;
      label = "Added " + record.name + " (web)";
      note = "Web-sourced planned addition from " + record.provenance.sourceUrl + " (fetched " + record.provenance.fetchedAt.slice(0, 10) + ") — " + record.verification + ". Planned, not built or installed.";
    }
    let checksLine = "";
    if (latest?.spec?.forge?.bom?.length) {
      const catalogue = mergeCatalogue(parts as unknown as CataloguePart[], records) as unknown as CataloguePart[];
      const before = runEngineChecks(latest.spec, catalogue);
      const role = pending.changes?.some((c) => c.path.startsWith('battery.')) ? 'battery'
        : pending.changes?.some((c) => c.path.startsWith('motor.')) ? 'motor'
        : pending.changes?.some((c) => c.path.startsWith('wheel.')) ? 'wheel' : undefined;
      newSpec = syncPlannedPart(newSpec,toCataloguePart(record),catalogue,role);
      const after = runEngineChecks(newSpec, catalogue);
      const beforeById = new Map(before.map((c) => [c.id, c.verdict]));
      const diffs: string[] = [];
      for (const c of after) {
        const was = beforeById.get(c.id);
        if (was === undefined) diffs.push(c.id + ": new " + c.verdict);
        else if (was !== c.verdict) diffs.push(c.id + ": " + was + " → " + c.verdict);
      }
      checksLine = diffs.length
        ? " Forge Engine checks re-run — verdict changes: " + diffs.join("; ") + "."
        : " Forge Engine checks re-run — no verdict changed.";
    } else {
      checksLine = " This robot has no Forge Engine checks recorded, so there were no verdicts to re-run.";
    }
    const versionId = uid("v");
    const version = {
      id: versionId,
      label,
      note,
      source: "edit" as const,
      createdAt: nowIso,
      spec: newSpec,
      planned: true,
    };
    const err = writeStore(GARAGE_KEY, all.map((r) => (r.id === robot.id ? { ...r, versions: [...r.versions, version] } : r)));
    if (err) { noteBubble("The part is in your web parts list, but the robot update failed (" + err + ")."); return; }
    lastApplied.current = { robotId: robot.id, versionId };
    noteBubble(formatSavedText(record, robot.name) + " Saved as a new version (“" + label + "”); the previous version is unchanged. Type “undo” to restore it." + checksLine);
  };

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

  /* ---------------- save a robot (addendum, 2026-11-01) ---------------- */

  /* A pending collision choice: a Robodex robot whose name a
   * saved robot already holds. The next short reply (update /
   * save as new / cancel) completes it; any other message
   * retires the question and falls through to the normal paths.
   * All resolution and record construction is lib/saveRobot.ts;
   * this layer only fetches recorded specs and writes the store,
   * and never announces a save before the write confirms. */
  const pendingSave = useRef<{ robot: DexRobotRef; existingId: string } | null>(null);

  const fetchDexSpec = (robot: DexRobotRef): Promise<Spec> =>
    fetch(assetPath(robot.specFile!)).then((r) => {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json() as Promise<Spec>;
    });

  const saveDexEntry = (robot: DexRobotRef) => {
    if (!robot.specFile) {
      noteBubble(`“${robot.name}” has no recorded spec file in the Robodex, so there is nothing I can save faithfully. Nothing was saved.`);
      return;
    }
    fetchDexSpec(robot)
      .then((spec) => {
        const nowIso = new Date().toISOString();
        const entry = buildDexEntry(robot, spec, nowIso, { robot: uid("robot"), version: uid("v") });
        const saved = readStore<GarageRobot[]>(GARAGE_KEY, []);
        const error = writeStore(GARAGE_KEY, [...saved, entry]);
        if (error) throw new Error(error);
        noteBubble(`Saved “${entry.name}” to your Garage: a Baseline version from its recorded Robodex spec (${robot.specFile}). It is in My robots now — edits there save as new versions, and the catalogue record itself is unchanged.`);
      })
      .catch((e: Error) => noteBubble(`I couldn't save “${robot.name}” (${e.message}). Nothing was saved.`));
  };

  const runSaveCommand = (q: string): boolean => {
    if (pendingSave.current) {
      const choice = parseSaveChoice(q);
      if (choice) {
        const pending = pendingSave.current;
        pendingSave.current = null;
        if (choice === "cancel") { noteBubble("Cancelled. Nothing was saved or changed."); return true; }
        const savedNow = readStore<GarageRobot[]>(GARAGE_KEY, []);
        const existing = savedNow.find((r) => r.id === pending.existingId);
        if (!existing) { noteBubble("That saved robot is no longer there, so I stopped. Nothing changed."); return true; }
        if (choice === "new") {
          const copy = copyAsNew(existing, uniqueCopyName(existing.name, savedNow), new Date().toISOString(), uid("robot"));
          const error = writeStore(GARAGE_KEY, [...savedNow, copy]);
          if (error) { noteBubble(`I couldn't save the copy (${error}). Nothing changed.`); return true; }
          noteBubble(`Saved a new robot “${copy.name}”, copied from your saved “${existing.name}” — its ${existing.versions.length} version${existing.versions.length === 1 ? "" : "s"} carried over, provenance notes included. The original is unchanged.`);
          return true;
        }
        if (!pending.robot.specFile) {
          noteBubble(`“${pending.robot.name}” has no recorded spec file in the Robodex, so I can't refresh its Baseline. Nothing changed.`);
          return true;
        }
        fetchDexSpec(pending.robot)
          .then((spec) => {
            const current = readStore<GarageRobot[]>(GARAGE_KEY, []);
            const target = current.find((r) => r.id === pending.existingId);
            if (!target) { noteBubble("That saved robot is no longer there, so I stopped. Nothing changed."); return; }
            const updated = appendFreshBaseline(target, spec, new Date().toISOString(), uid("v"));
            const error = writeStore(GARAGE_KEY, current.map((r) => (r.id === target.id ? updated : r)));
            if (error) throw new Error(error);
            noteBubble(`Updated “${target.name}”: appended a fresh Baseline version from the recorded Robodex spec — now ${updated.versions.length} versions. Earlier versions are unchanged.`);
          })
          .catch((e: Error) => noteBubble(`I couldn't update “${existing.name}” (${e.message}). Nothing changed.`));
        return true;
      }
      pendingSave.current = null;
    }
    const req = parseSaveCommand(q);
    if (!req) return false;
    const saved = readStore<GarageRobot[]>(GARAGE_KEY, []);
    /* Page context: a Robodex page names its robot in the route;
     * the Garage names its selected robot in the hash. */
    let pageName: string | undefined;
    const pm = (pathname || "").match(/^\/robots\/([^/]+)\/?$/);
    if (pm) pageName = robots.find((r) => robotSlug(r) === pm[1])?.name;
    if (!pageName && (pathname || "").startsWith("/garage")) {
      const h = window.location.hash.match(/^#robot=([A-Za-z0-9_-]+)$/);
      if (h) pageName = saved.find((r) => r.id === h[1])?.name;
    }
    /* Omega1 comes from its own records, with the same record the
     * Workshop writes, and "it" is the robot we were just talking about. */
    if (req.kind === "save" && !req.importRef && isOmega1Name(req.nameText ?? (pageName ? undefined : memoryRef.current.robotName))) {
      const all = readStore<GarageRobot[]>(GARAGE_KEY, []);
      const existing = all.find((r) => r.id === OMEGA1_ROBOT_ID);
      if (existing) {
        noteBubble(existing.archivedAt
          ? "Your Omega1 copy is in Archived robots. Restore it there, or delete it forever there to start fresh from its records."
          : "Omega1 is already in your Workshop, so I didn't add a second copy.");
        return true;
      }
      const error = writeStore(GARAGE_KEY, [...all, buildOmega1SeedEntry(new Date().toISOString(), uid("v"))]);
      noteBubble(error
        ? `I couldn't save Omega1 (${error}), so nothing was added.`
        : "Omega1 is in your Workshop now, from its records, and it shows under My robots. Its real size and weight still need measuring.");
      return true;
    }
    const target = resolveSaveTarget(req, {
      dex: robots.map((r) => ({ name: r.name, slug: robotSlug(r), specFile: r.spec_file })),
      saved,
      pageName,
      memoryName: memoryRef.current.robotName,
    });
    if (target.status === "ambiguous") {
      noteBubble(`I don't want to guess which robot you mean — ${target.candidates.map((c) => "“" + c + "”").join(" and ")} are both in play. Say save "<name>" with the one you want, and I'll do exactly that.`);
      return true;
    }
    if (target.status === "none") {
      noteBubble(target.reason === "no-import"
        ? "I don't see a saved import to save — an import lands in your Garage when you press “Save to my Garage” on the import page, and I can only see it from there. Import a repo there (or paste its link here) first."
        : target.reason === "unknown-name"
          ? `I don't have a robot called “${target.nameText}” in the Robodex or your Garage, so nothing was saved. “list my robots” shows your saved robots.`
          : "Which robot should I save? I'm not looking at one and we haven't discussed one yet — name it, like save \"TurtleBot3 Burger\", and I'll save exactly that one.");
      return true;
    }
    if (req.kind === "add-and-save") {
      const resolvedPart = resolveCataloguePart(req.partText, parts.map((p) => ({ id: p.id, name: p.name, partClass: p.part_class })));
      if (resolvedPart.status !== "unique") {
        noteBubble(resolvedPart.status === "ambiguous"
          ? `“${req.partText}” matches more than one catalogue part (${resolvedPart.candidates.join(", ")}), so I saved nothing. Name the exact part and I'll record that one.`
          : `I can't find “${req.partText}” in the parts catalogue, so I saved nothing — I only record parts the catalogue actually holds.`);
        return true;
      }
      const part = resolvedPart.part;
      const finish = (robot: GarageRobot, wasCreated: boolean) => {
        const { robot: updated, already } = recordAddedPart(robot, part, new Date().toISOString(), uid("v"));
        const current = readStore<GarageRobot[]>(GARAGE_KEY, []);
        const next = wasCreated ? [...current, updated] : current.map((r) => (r.id === updated.id ? updated : r));
        const error = writeStore(GARAGE_KEY, next);
        if (error) { noteBubble(`I couldn't save (${error}). Nothing was saved.`); return; }
        noteBubble(already
          ? `“${part.name}” is already recorded on your saved “${updated.name}”, so I left it as is — no duplicate version.`
          : `Saved. “${updated.name}” ${wasCreated ? "is now in your Garage with its recorded Robodex Baseline, and it " : ""}gained a PLANNED version recording the ${part.name} (parts catalogue: ${part.id}) as an addition to fit — planned, not built: recorded from the catalogue, not measured or installed.`);
      };
      if (target.status === "saved" || target.status === "import") { finish(target.robot, false); return true; }
      const dexRobot = target.robot;
      if (!dexRobot.specFile) {
        noteBubble(`“${dexRobot.name}” has no recorded spec file in the Robodex, so I can't save it faithfully. Nothing was saved.`);
        return true;
      }
      fetchDexSpec(dexRobot)
        .then((spec) => {
          const entry = buildDexEntry(dexRobot, spec, new Date().toISOString(), { robot: uid("robot"), version: uid("v") });
          finish(entry, true);
        })
        .catch((e: Error) => noteBubble(`I couldn't load the recorded spec for “${dexRobot.name}” (${e.message}), so nothing was saved.`));
      return true;
    }
    const plan = planSave(target, saved);
    if (!plan) {
      noteBubble("I couldn't resolve that save unambiguously, so nothing was saved. Name the robot exactly and I'll do it.");
      return true;
    }
    if (plan.action === "already-saved") {
      const r = plan.robot;
      noteBubble(plan.viaImport
        ? `“${r.name}” is already in your Garage — it's the robot you imported from ${r.repoImport!.provenance.repoUrl} @ ${r.repoImport!.provenance.commitSha.slice(0, 7)}, saved with its specimen record and provenance. Nothing changed.`
        : `“${r.name}” is already in your Garage (${r.versions.length} version${r.versions.length === 1 ? "" : "s"}, latest “${r.versions.at(-1)?.label}”). Nothing changed — edits to it save as new versions.`);
      return true;
    }
    if (plan.action === "choice") {
      pendingSave.current = { robot: plan.robot, existingId: plan.existing.id };
      noteBubble(`You already have a saved robot called “${plan.existing.name}” (${plan.existing.versions.length} version${plan.existing.versions.length === 1 ? "" : "s"}). I won't overwrite it silently. Reply “update” to append a fresh Baseline version from the recorded Robodex spec (history kept), “save as new” to save a separate “${plan.existing.name} copy”, or “cancel”.`);
      return true;
    }
    saveDexEntry(plan.robot);
    return true;
  };

  /* ---------------- commands ---------------- */

  /* Run the built-in command grammars (inventory, assembly, spec edits).
   * Returns true when the text was a command — handled, or refused with a
   * bubble. Typed commands and live-model proposals share this one path,
   * so a model proposal gets exactly the validation a typed command gets,
   * and nothing applies until the user taps Apply on the preview. */
  /* VEX V5 build ideas and word edits (lib/vexBuilds.ts). Suggestions
   * live only in the chat until "Add #N to Workshop"; an edit to a VEX
   * robot in the Workshop is a preview until "Apply as a new version". */
  const runVexCommand = (q: string): boolean => {
    const suggest = parseVexSuggest(q);
    if (suggest) {
      const builds = suggestVexBuilds(suggest.count, suggest.focus);
      setVexBuilds(builds);
      setVexEditPlan(null);
      noteBubble(`Here ${builds.length === 1 ? 'is 1 VEX V5 build idea' : `are ${builds.length} different VEX V5 build ideas`}, side by side below. They differ in how many motors drive the wheels, the wheel type and the gearing, which trades top speed for pushing force. Change one with words, like “make #2 faster”, then add the one you like to the Workshop.`);
      return true;
    }
    const edit = parseVexEdit(q);
    if (!edit) return false;
    const editBuild = (index: number) => {
      const builds = vexBuilds ?? [];
      const b = builds[index];
      const result = editVexSpec(b.spec, edit.ops);
      if (result.changes.length) setVexBuilds(builds.map((x, i) => (i === index ? { ...x, spec: result.spec } : x)));
      noteBubble((result.changes.length ? `Changed #${index + 1}: ${result.changes.join('; ')}. The numbers on its card are updated; nothing is saved until you add it.` : `#${index + 1} is unchanged.`) + (result.problems.length ? ' ' + result.problems.join(' ') : ''));
      return true;
    };
    if (edit.target != null) {
      if (!vexBuilds?.length) { noteBubble('There are no VEX build ideas on screen. Ask “suggest 3 VEX builds” first.'); return true; }
      if (edit.target < 1 || edit.target > vexBuilds.length) { noteBubble(`There ${vexBuilds.length === 1 ? 'is only #1' : `are only #1 to #${vexBuilds.length}`} on screen.`); return true; }
      return editBuild(edit.target - 1);
    }
    const ws = (pathname || '').startsWith('/garage') ? readWorkshopContext() : null;
    const robot = ws?.robotId ? readActiveRobots(() => readStore<GarageRobot[]>(GARAGE_KEY, [])).find((r) => r.id === ws.robotId) : undefined;
    const latest = robot?.versions.at(-1);
    if (robot && latest && vexParamsOf(latest.spec)) {
      const result = editVexSpec(latest.spec, edit.ops);
      setVexEditPlan({ robotId: robot.id, robotName: robot.name, baseVersionId: latest.id, phrase: q, before: latest.spec, after: result.spec, changes: result.changes, problems: result.problems });
      noteBubble(result.changes.length ? `Review the change to ${robot.name} below. Apply saves it as a new version; the current one stays in History.` : `That would not change ${robot.name}.` + (result.problems.length ? ' ' + result.problems.join(' ') : ''));
      return true;
    }
    if (vexBuilds?.length === 1) return editBuild(0);
    if (vexBuilds?.length) { noteBubble(`Which one? Say the number, like “make #1 ${q.toLowerCase().replace(/^(make|give|switch|use|change)\s+(it\s+)?/, '').replace(/[.!?]+$/, '')}”.`); return true; }
    return false;
  };

  const addVexBuild = (b: VexBuild, index: number) => {
    const nowIso = new Date().toISOString();
    const all = readStore<GarageRobot[]>(GARAGE_KEY, []);
    const taken = new Set(activeRecords(all).map((r) => r.name.toLowerCase()));
    let name = String(b.spec.name);
    for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${b.spec.name} ${i}`;
    const robot: GarageRobot = {
      id: uid('robot'), name, createdAt: nowIso,
      versions: [{ id: uid('v'), label: 'Baseline', note: `VEX V5 build idea #${index + 1} from Wrench: ${b.why} Planned, not built.`, source: 'starter', createdAt: nowIso, spec: { ...b.spec, name }, planned: true }],
    };
    const err = writeStore(GARAGE_KEY, [...all, robot]);
    if (err) { noteBubble(`I couldn't save it (${err}). Nothing was saved.`); return; }
    noteBubble(`Added “${robot.name}” to your Workshop as a planned robot and opened its Drive train tab. Ask me to change it with words while it's open, like “make it faster”.`);
    openRobot(robot.id, 'drivetrain');
  };

  const applyVexEdit = (plan: VexEditPlan) => {
    const all = readStore<GarageRobot[]>(GARAGE_KEY, []);
    const robot = activeRecords(all).find((r) => r.id === plan.robotId);
    if (!robot) { setVexEditPlan(null); noteBubble(`${plan.robotName} is no longer in your Workshop, so nothing changed.`); return; }
    if (robot.versions.at(-1)?.id !== plan.baseVersionId) { setVexEditPlan(null); noteBubble(`${plan.robotName} changed since this preview, so nothing was applied. Ask again to see the change against its current version.`); return; }
    const versionId = uid('v');
    const version = { id: versionId, label: 'Wrench: ' + plan.phrase.slice(0, 60), note: 'Drive change from Wrench: ' + plan.changes.join('; ') + '.', source: 'edit' as const, createdAt: new Date().toISOString(), spec: plan.after, planned: true };
    const err = writeStore(GARAGE_KEY, all.map((r) => (r.id === robot.id ? { ...r, versions: [...r.versions, version] } : r)));
    setVexEditPlan(null);
    if (err) { noteBubble(`I couldn't save it (${err}). ${plan.robotName} is unchanged.`); return; }
    lastApplied.current = { robotId: robot.id, versionId };
    noteBubble(`Saved as a new version of ${plan.robotName}. The previous version is unchanged in History; type “undo” to go back to it.`);
  };

  /* One-part edits: "make the wheels bigger" (size, from the spec's
   * own fields, no AI) or "make the wheels look like …" (a new 3D
   * shape for that part from the Worker's /part-mesh). The robot is
   * the one named in the words, else the one open in the Workshop.
   * Nothing is saved until Apply / Keep. */
  const runPartEditCommand = (q: string): boolean => {
    const robots = readActiveRobots(() => readStore<GarageRobot[]>(GARAGE_KEY, []));
    const openId = (pathname || '').startsWith('/garage') ? readWorkshopContext()?.robotId : undefined;
    const robot = pickRobot(q, robots, openId ?? undefined);
    const latest = robot?.versions.at(-1);
    if (!robot || !latest) {
      /* Only claim the phrase if it really is a one-part edit. */
      const probe = { length_m: 0.3, width_m: 0.2, height_m: 0.15, ground_clearance_m: 0.02, wheel: { diameter_m: 0.065, width_m: 0.026, count: 4 }, rotors: { count: 4, prop_diameter_m: 0.127 } };
      let shaped = false;
      try { shaped = Boolean(parsePartEdit(q, probe) || parseLookEdit(q, ['wheel', 'rotor', 'camera', 'lidar', 'ultrasonic', 'caster', 'mount', 'plate', 'frame', 'body', 'battery', 'fc', 'arm', 'leg', 'head', 'gripper'])); } catch { shaped = true; }
      if (!shaped) return false;
      noteBubble('Which robot? Open one in the Workshop, or name it, like “make Omega1’s wheels bigger”.');
      return true;
    }
    const spec = latest.spec;
    let present: string[] = [];
    try { present = taBuildParts(spec as RobotSpec).parts.map((p) => p.id); } catch { present = []; }
    let look: ReturnType<typeof parseLookEdit> = null;
    let size: ReturnType<typeof parsePartEdit> = null;
    try {
      look = parseLookEdit(q, present);
      if (!look) size = parsePartEdit(q, spec);
    } catch (e) {
      noteBubble((e as Error).message + ' Nothing changed.');
      return true;
    }
    if (!look && !size) return false;
    setPartEditReq(null);
    setPartLookReq(null);
    void (async () => {
      const looks = await readLookFiles(robot.id, robot.partLooks).catch(() => ({}));
      if (size) {
        const after = applyPartEdit(spec, size);
        const lines = (s: unknown) => { try { return forgeValidateSpec(s as RobotSpec).lines.filter((l: string) => /^\[(ERROR|WARN)\]/.test(l)); } catch { return []; } };
        const had = new Set(lines(spec));
        setPartEditReq({ robotId: robot.id, robotName: robot.name, baseVersionId: latest.id, before: spec, after, plan: size, newChecks: lines(after).filter((l) => !had.has(l)), looks });
        noteBubble(`Here is ${size.partLabel} on ${robot.name} before and after: ${describeChanges(size)}. Nothing else changes. Apply saves it as a new version.`);
        return;
      }
      if (!look) return;
      if (isDemoMode()) { noteBubble('Making a new 3D look for a part uses the live 3D service, which is off in demo mode. Size changes like “make the wheels bigger” work here. Nothing changed.'); return; }
      if (!(await partMeshAvailable())) {
        noteBubble('Making a new 3D look for a part needs the 3D service on the live endpoint, and it is not switched on yet. Size changes like “make the wheels bigger” work now. Nothing changed.');
        return;
      }
      setPartLookReq({ robotId: robot.id, robotName: robot.name, spec, plan: look, looks });
      noteBubble(`Making a new 3D look for ${look.partLabel} on ${robot.name}. Only that part is regenerated; the rest of the model and the spec stay as they are.`);
    })();
    return true;
  };

  const applyPartEditReq = (req: PartEditRequest) => {
    const all = readStore<GarageRobot[]>(GARAGE_KEY, []);
    const robot = activeRecords(all).find((r) => r.id === req.robotId);
    setPartEditReq(null);
    if (!robot) { noteBubble(`${req.robotName} is no longer in your Workshop, so nothing changed.`); return; }
    const base = robot.versions.at(-1);
    if (base?.id !== req.baseVersionId) { noteBubble(`${req.robotName} changed since this preview, so nothing was applied. Ask again to see the change against its current version.`); return; }
    const versionId = uid('v');
    const changed = req.plan.changes.map((c) => c.path);
    const version = {
      id: versionId, createdAt: new Date().toISOString(), source: 'edit' as const,
      label: 'Wrench: ' + req.plan.phrase.slice(0, 60),
      note: `One-part change from Wrench (${req.plan.partLabel} only): ${describeChanges(req.plan)}. Browser checks are a subset, not hardware validation.`,
      spec: req.after,
      ...(base.planned ? { planned: true } : {}),
      ...(base.estimatedPaths ? { estimatedPaths: base.estimatedPaths.filter((p) => !changed.includes(p)) } : {}),
    };
    const err = writeStore(GARAGE_KEY, all.map((r) => (r.id === robot.id ? { ...r, versions: [...r.versions, version] } : r)));
    if (err) { noteBubble(`I couldn't save it (${err}). ${req.robotName} is unchanged.`); return; }
    lastApplied.current = { robotId: robot.id, versionId };
    noteBubble(`Saved as a new version of ${req.robotName}: ${describeChanges(req.plan)}. The previous version is unchanged in History; type “undo” to go back to it.`);
  };

  const keepPartLook = async (req: PartLookRequest, data: ArrayBuffer, job: MeshJob) => {
    setPartLookReq(null);
    try {
      await saveLookFile(req.robotId, req.plan.viewId, data);
    } catch (e) {
      noteBubble(`I couldn't keep it (${(e as Error).message}). Nothing changed.`);
      return;
    }
    const all = readStore<GarageRobot[]>(GARAGE_KEY, []);
    const robot = activeRecords(all).find((r) => r.id === req.robotId);
    if (!robot) { noteBubble(`${req.robotName} is no longer in your Workshop, so nothing changed.`); return; }
    const entry = { viewId: req.plan.viewId, partLabel: req.plan.partLabel, description: req.plan.description, provider: 'meshy' as const, jobId: job.id, createdAt: new Date().toISOString(), bytes: data.byteLength };
    const err = writeStore(GARAGE_KEY, all.map((r) => (r.id === robot.id ? { ...r, partLooks: [...(r.partLooks ?? []).filter((l) => l.viewId !== entry.viewId), entry] } : r)));
    if (err) { noteBubble(`I couldn't keep it (${err}). Nothing changed.`); return; }
    noteBubble(`Kept the new look for ${req.plan.partLabel} on ${req.robotName}. It shows on the Workshop Overview in this browser. The spec did not change. Say “remove the new look for ${req.plan.partLabel}” to go back to the plain part.`);
  };

  /* "remove the new look for the wheels": back to the plain part. */
  const runRemoveLook = (q: string): boolean => {
    const m = q.trim().replace(/[.!?]+$/, '').match(/^(?:remove|undo|reset|drop|clear)\s+(?:the\s+)?(?:new\s+|generated\s+)?(?:3d\s+)?looks?\s+(?:for|of|on)\s+(.+)$/i);
    if (!m) return false;
    const robots = readActiveRobots(() => readStore<GarageRobot[]>(GARAGE_KEY, []));
    const openId = (pathname || '').startsWith('/garage') ? readWorkshopContext()?.robotId : undefined;
    const robot = pickRobot(q, robots, openId ?? undefined);
    if (!robot) { noteBubble('Which robot? Open one in the Workshop first.'); return true; }
    let look: ReturnType<typeof parseLookEdit> = null;
    try { look = parseLookEdit(`make ${m[1]} look like x`, (robot.partLooks ?? []).map((l) => l.viewId)); } catch { look = null; }
    if (!look) { noteBubble(`${robot.name} has no generated look for that part.`); return true; }
    const viewId = look.viewId;
    const all = readStore<GarageRobot[]>(GARAGE_KEY, []);
    const err = writeStore(GARAGE_KEY, all.map((r) => (r.id === robot.id ? { ...r, partLooks: (r.partLooks ?? []).filter((l) => l.viewId !== viewId) } : r)));
    if (err) { noteBubble(`I couldn't change it (${err}).`); return true; }
    void import('@/lib/partMesh').then((pm) => pm.removeLookFile(robot.id, viewId)).catch(() => {});
    noteBubble(`Removed the generated look. ${look.partLabel[0].toUpperCase() + look.partLabel.slice(1)} on ${robot.name} are drawn from the spec again.`);
    return true;
  };

  const runCommands = (q: string): boolean => {
      const humanoidCommand=parseHumanoidCommand(q);
      if(humanoidCommand){
        const command=humanoidCommand;
        const operation=command.kind==='explode'?'setExplode':command.kind==='reset'?'resetView':command.kind==='next'?'nextLink':command.kind==='select'?'selectLink':command.kind==='pose'?'setJointPose':command.kind==='explain'?'explainLink':null;
        if(operation){const payload=command.kind==='explode'?{amount:1}:command.kind==='select'?{link:command.link}:command.kind==='pose'?{joint:command.joint,radians:command.degrees*Math.PI/180}:{};const request:UnityRequest={operation,payload,handled:false,complete:message=>noteBubble(message)};window.dispatchEvent(new CustomEvent(UNITY_ASYNC_EVENT,{detail:request}));if(request.handled)return true;}
        const result=requestHumanoid(humanoidCommand);noteBubble(result.handled?result.message:'Open a G1 humanoid in Workshop → Build first.');return true;}
      const benchCommand = parseBenchCommand(q);
      if (benchCommand) {
        const result = requestBench(benchCommand);
        noteBubble(result.handled ? result.message : 'Open this robot’s Build workbench in Workshop, then ask again.');
        return true;
      }
      const kitCommand = parseRoverKitCommand(q);
      if (kitCommand) {
        const result = requestRoverKit(kitCommand);
        noteBubble(result.handled ? result.message : 'Open a rover in the Workshop first, then ask again.');
        return true;
      }
      if (runVexCommand(q)) return true;
      if (runRemoveLook(q)) return true;
      if (runPartEditCommand(q)) return true;
      /* "remember that …": a note on the Workshop robot on screen. */
      const remember=parseRememberCommand(q);
      if(remember){
        const ws=readWorkshopContext();
        if(!ws?.robotId){noteBubble('Open one of your robots in the Workshop first, then tell me what to remember about it.');return true;}
        const err=addRobotNote(ws.robotId,remember);
        noteBubble(err??`Saved to ${ws.robotName}’s notes: “${cleanNoteText(remember)}”. I’ll use it when you ask about ${ws.robotName}, and you can delete it on its Overview.`);
        return true;
      }
      /* One-tap Workshop actions: the RealSense camera window, a tab. */
      const wsAction=parseWorkshopAction(q);
      if(wsAction&&(wsAction.kind==='realsense'||(pathname||'').startsWith('/garage'))){
        const handled=requestWorkshopAction(wsAction);
        const ws=readWorkshopContext();
        noteBubble(!handled?'Open one of your robots in the Workshop first, then ask me again.'
          :wsAction.kind==='realsense'?`Opened the RealSense camera window for ${ws?.robotName??'this robot'}. Start the bridge on your computer if it isn’t running (the window shows how), then Record a slow walk-around.`
          :`Opened the ${ws?.tabLabel??'requested'} tab.`);
        return true;
      }
      /* "Reassemble" / "put it back together": the Workshop's 3D
       * take-apart view answers with what it actually did. */
      if(parseReassembleCommand(q)){
        const result=requestReassemble();
        noteBubble(result.handled?result.message:'Open the robot’s Overview in the Workshop first, so its 3D model is on screen — then I can put its parts back.');
        return true;
      }
      const simCommand=parseSimCommand(q);
      if(simCommand){const detail={command:simCommand,handled:false,message:''};window.dispatchEvent(new CustomEvent(SIM_COMMAND_EVENT,{detail}));noteBubble(detail.handled?detail.message:'Open the selected robot’s Simulate tab first, then ask me to run or change its scenario.');return true;}
      const libraryCommand=parseLibraryCommand(q);
      if(libraryCommand){
        try{
          const current=readStore<InventoryPart[]>(INVENTORY_KEY,[]),web=readStore<WebPartRecord[]>(WEB_PARTS_KEY,[]);
          const robotRecords=readStore<GarageRobot[]>(GARAGE_KEY,[]);
          const id=uid('part');
          const result=changeLibrary(current,web,catalogItems(parts),activeRecords(robotRecords),libraryCommand,new Date().toISOString(),id);
          pendingLibrary.current={command:libraryCommand,expected:JSON.stringify(current),webExpected:JSON.stringify(web),robotsExpected:JSON.stringify(robotRecords),id};
          pendingWebProposal.current=null;
          noteBubble(result.description+'. Reply “yes” to save or “no” to cancel. This does not change robot geometry or consume stock.');
        }catch(e){noteBubble((e as Error).message);}
        return true;
      }
      if (runSaveCommand(q)) return true;
      /* Whose robot is it, and delete: only a robot in the Workshop is
       * yours (lib/robotOwnership). A bare "remove X" that names no known
       * robot falls through, so "remove the battery" stays an edit. */
      const ownershipAsk=parseOwnershipAsk(q);
      if(ownershipAsk){
        const allRobots=readStore<GarageRobot[]>(GARAGE_KEY,[]);
        const active=activeRecords(allRobots);
        const archived=allRobots.filter(r=>!active.includes(r));
        /* "this robot" is the robot open in the Workshop, found by its id:
         * the published name can be an unsaved draft rename. */
        const ctx=isCurrentRobotName(ownershipAsk.name)?readWorkshopContext():null;
        const currentRobot=ctx?.robotId?allRobots.find(r=>r.id===ctx.robotId)??null:null;
        /* A saved robot whose exact name is the whole phrase ("My Rover")
         * wins before "my"/"the"/"robot" are read as command words. */
        const norm=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
        const fullMatch=ownershipAsk.kind==='delete'&&ownershipAsk.fullName
          ?allRobots.filter(r=>norm(r.name)===norm(ownershipAsk.fullName!)):[];
        if(isCurrentRobotName(ownershipAsk.name)&&!currentRobot){
          if(ownershipAsk.kind==='whose'||ownershipAsk.explicit){noteBubble('Which robot? Open it in the Workshop, or name it.');return true;}
        }else if(ownershipAsk.kind==='delete'&&(currentRobot||fullMatch.length===1)){
          setRobotDeleteProposal((currentRobot??fullMatch[0])!);
          noteBubble('Review the delete below. Nothing is deleted until you confirm.');
          return true;
        }else if(isCurrentRobotName(ownershipAsk.name)&&currentRobot){
          noteBubble(ownershipAnswer(currentRobot.name,{kind:active.includes(currentRobot)?'mine':'archived',robots:[currentRobot]}));
          return true;
        }else{
          const name=ownershipAsk.name;
          const overrides=readStore<DexOverrides>(DEX_OVERRIDES_KEY,{});
          const records=buildDexEntities({catalog:robots,isPhotoDraft,sightings:allDexSightings(),garage:[],overrides}).map(e=>({name:e.name,tab:DEX_TAB_LABEL[e.currentTab]}));
          const ownership=classifyRobot(name,{active,archived,records,match:ownershipAsk.kind==='whose'?'loose':ownershipAsk.match});
          if(ownershipAsk.kind==='whose'){noteBubble(ownershipAnswer(name,ownership));return true;}
          if(ownership.kind!=='unknown'||ownershipAsk.explicit){
            const refusal=deleteRefusal(name,ownership);
            if(refusal)noteBubble(refusal);
            else if(ownership.kind==='mine'||ownership.kind==='archived'){
              setRobotDeleteProposal(ownership.robots[0]);
              noteBubble('Review the delete below. Nothing is deleted until you confirm.');
            }
            return true;
          }
        }
      }
      /* Robodex filing commands ("move "Spot" to sighted",
       * lib/dexCategorize): parsed BEFORE the assembly grammar —
       * the filing grammar requires a category destination word,
       * so an assembly phrase like "move X on Y to 0 0 70" (a
       * numeric destination) can never match it, and a filing
       * phrase can never be an assembly op (no "on <robot>"). */
      const dexMove=parseDexMove(q);
      if(dexMove){
        try{
          const overrides=readStore<DexOverrides>(DEX_OVERRIDES_KEY,{});
          const garage=readActiveRobots(()=>readStore<GarageRobot[]>(GARAGE_KEY,[]));
          const entities=buildDexEntities({catalog:robots,isPhotoDraft,sightings:allDexSightings(),garage,overrides});
          const matches=resolveDexEntity(dexMove.name,entities);
          if(!matches.length){
            if(normalizeDexName(dexMove.name)==='omega1'&&!garage.some(r=>r.id===OMEGA1_ROBOT_ID)){
              noteBubble('Omega1 has no copy in your Workshop yet, so I cannot file it there. Open the Workshop and it is added to your robots from its records — then I can file it like any other robot.');
            }else{
              noteBubble(`I couldn't find “${dexMove.name}” in the Robodex, the sightings or your Workshop, so nothing was filed. Names resolve against the catalog, the dex sightings and your saved robots.`);
            }
            return true;
          }
          let entity=matches[0];
          if(matches.length>1){
            const sameName=matches.every(m=>normalizeDexName(m.name)===normalizeDexName(matches[0].name));
            if(!sameName){noteBubble(`“${dexMove.name}” matches more than one robot: ${matches.map(m=>m.name).join('; ')}. Use a fuller name and I'll file exactly one.`);return true;}
            /* Same robot, several records (a catalog entry and its
             * sighting): the sighting is the record the filing
             * tabs group, then the Workshop entry, then catalog. */
            entity=matches.find(m=>m.kind==='sighting')??matches.find(m=>m.kind==='garage')??matches[0];
          }
          setDexMoveProposal(planDexMove(entity,dexMove.dest));
          noteBubble('Review the Robodex filing change below. Apply saves it; the Robodex tabs, counts and card badges all read the same filing.');
        }catch(e){noteBubble((e as Error).message);}
        return true;
      }
      const stockCommand=parseInventoryCommand(q);
      if(stockCommand){
        try{
          const stock=readStore<InventoryPart[]>(INVENTORY_KEY,[]).filter(p=>!p.archivedAt);
          const robots=readActiveRobots(()=>readStore<GarageRobot[]>(GARAGE_KEY,[]));
          if(stockCommand.kind==='list'){
            let shown=stock;
            if(stockCommand.robotName){const match=robots.filter(r=>r.name.toLowerCase()===stockCommand.robotName!.toLowerCase());if(match.length!==1)throw new Error('Use a unique saved robot name.');shown=stock.filter(p=>p.robot_id===match[0].id);}
            noteBubble(shown.length?shown.map(p=>`${p.name}: ×${p.quantity} · ${p.category} · ${robots.find(r=>r.id===p.robot_id)?.name??'shared/unassigned'} · ${p.stock_location||'no shelf location'}`).join('\n'):'No matching parts saved in this browser. Add photos in My parts or attach a part photo in Forge.');
          }else setInventoryProposal(proposeInventory(stock,robots,stockCommand));
        }catch(e){noteBubble((e as Error).message);}
        return true;
      }
      try {
        const saved = readActiveRobots(() => readStore<GarageRobot[]>(GARAGE_KEY, []));
        const assemblies = effectiveAssemblies(saved, readStore<Assemblies>(ASSEMBLY_KEY, {}));
        const upgrade = parseUpgradeRequest(q, saved, (pathname || '').startsWith('/garage') ? readWorkshopContext()?.robotId : undefined);
        if (upgrade) {
          const target = saved.find(r => r.id === upgrade.robotId)!;
          setUpgradeProposal({robotId:target.id,expectedRobotVersionId:target.versions.at(-1)!.id,expectedAssemblyRevision:currentAssembly(assemblies,target.id).id||null,boardId:upgrade.boardId});
          noteBubble('Review the coordinated upgrade below. Wrench uses saved facts and the same deterministic electrical checks as the workbench. Missing evidence stays visible; nothing changes until you approve.');
          return true;
        }
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
        ...readActiveRobots(() => readStore<GarageRobot[]>(GARAGE_KEY, [])).map((r) => r.name),
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
          ...readActiveRobots(() => readStore<GarageRobot[]>(GARAGE_KEY, [])).map((r) => r.name),
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
      /* CAD generation (lib/cadGen): "make a mounting plate 80x60,
       * 3mm thick, M3 holes" generates a parametric OpenSCAD part
       * from the chat-stated dimensions — deterministic and local.
       * The .scad downloads through the store's blob pattern and
       * the full source rides in a collapsible block in the reply;
       * generated geometry is ESTIMATED/PLANNED and says so. CAD designs are saved locally, including in the isolated demo store. */
      { // Local CAD is safe in the isolated demo inventory as well.
        const revision=q.match(/^revise custom part "([^"\n]+)":\s*(.+)$/i);
        let cad: ReturnType<typeof cadFromText>;
        try { cad = cadFromText(revision?revision[2]:q); }
        catch (e) { noteBubble('The CAD design could not be generated: ' + (e as Error).message); return true; }
        if (cad) {
          try {
            const current=readStore<InventoryPart[]>(INVENTORY_KEY,[]);
            const matches=revision?current.filter(p=>p.origin==='custom'&&(p.id===revision[1]||p.name.toLowerCase()===revision[1].toLowerCase())):[];
            if(revision&&matches.length!==1)throw new Error('Use a unique saved custom part name or ID to revise it.');
            const next=saveCadDesign(current,cad,q,new Date().toISOString(),uid('part'),matches[0]?.id);
            const error=writeStore(INVENTORY_KEY,next);
            if(error)throw new Error(error);
          }catch(e){noteBubble('The custom design was not saved: '+(e as Error).message);return true;}
          downloadText(cad.filename, cad.source);
          appendMsg({
            who: "bot",
            html: "<p>" + esc(cad.summary) + " Saved in your Library as a Custom wishlist design.</p>" +
              "<details><summary>OpenSCAD source — " + esc(cad.filename) + "</summary><pre>" + esc(cad.source) + "</pre></details>",
          });
          return true;
        }
      }
      const command = parseCommand(q);
      if (command) {
        try {
          const allSaved = readStore<GarageRobot[]>(GARAGE_KEY, []);
          const saved = activeRecords(allSaved);
          if (command.kind === 'help') {
            noteBubble('Submit a robot: paste its GitHub repo link (https://github.com/owner/repo) and I open the repo importer with it, or attach a photo, parts list or spec file with the paperclip. Inventory: list my inventory; list my parts for "Omega1"; set inventory "Battery" quantity to 3; assign inventory "Battery" to "Omega1". Operations available now: list my robots; set "Omega1" wheel.diameter_m to 0.12; undo last chat change. Robodex filing: move "Spot" to sighted; put "Andino" under from photos; recategorize "TurtleBot3 Waffle Pi" as researched; reset categorization for "Spot". Filing only changes where the Robodex shows a robot — except moving one to my robots, which brings it into your Workshop from its recorded spec first. Edits use exact saved robot names and spec units (m, kg, V, mAh), preview first, and save a new version. Assembly commands: add a Jetson Orin Nano to "Omega1"; move "Jetson Orin Nano" on "Omega1" to 0 0 70 mm; connect "battery" to "Jetson Orin Nano" on "Omega1"; remove "battery" from "Omega1". Names resolve when unique; use workbench instance IDs for duplicates. Connections are planning-only, NOT_CHECKED. Navigation: open "TurtleBot3 Burger"; go to wiring; show the legged robots. Free-form operation requests (for example “make Omega1’s wheels bigger”) go to the live model when it is available: it proposes a command in this same grammar, the app validates it, and you still tap Apply. Coordinated upgrades: add a Raspberry Pi 5 or a Raspberry Pi 4B to this rover, or plan a Raspberry Pi 4B upgrade for "Omega1". The proposal combines planned power, wiring and printable designs; missing evidence stays explicit. Mount and enclosure generation is available in Build; simulation remains a simplified model.');
          } else if (command.kind === 'list') {
            noteBubble(ownedRobotsText(saved));
          } else if (command.kind === 'undo') {
            const last = lastApplied.current;
            if (!last) throw new Error('No chat change to undo in this session.');
            if (last.scope === 'assembly') {
              if (!saved.some((robot) => robot.id === last.robotId)) throw new Error('That robot is archived or no longer exists.');
              const fresh = readStore<Assemblies>(ASSEMBLY_KEY, {});
              const revision = currentAssembly(effectiveAssemblies(allSaved,fresh),last.robotId).id || null;
              const next = undoVersionedAssembly(allSaved,fresh,last.robotId,last.versionId,revision,uid('v'),new Date().toISOString());
              const error = writeStore(GARAGE_KEY,next); if(error) throw new Error(error);
              lastApplied.current = null;
              noteBubble('Previous assembly restored as a new version.');
              return true;
            }
            if (!saved.some((robot) => robot.id === last.robotId)) throw new Error('That robot is archived or no longer exists.');
            const next = undoOperation(allSaved, last.robotId, last.versionId, uid('v'), new Date().toISOString());
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
    saved: readActiveRobots(() => readStore<GarageRobot[]>(GARAGE_KEY, [])).map((r) => ({ id: r.id, name: r.name })),
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
    const saved = readActiveRobots(() => readStore<GarageRobot[]>(GARAGE_KEY, []));
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
        body: JSON.stringify({ message: conversationMessage(q, messagesRef.current), op_context: buildOpContext() }),
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
    (question: string, displayText?: string) => {
      let q = String(question || "").trim();
      if (!q) return;
      appendMsg({ who: "user", text: displayText || q });
      /* The sample chip's label carries no link; the message it
       * sends does (lib/sampleRobot.ts), so the repo-link detection
       * below fires and the importer opens. The bubble keeps the
       * chip's own wording. */
      if (q === SAMPLE_CHIP) q = SAMPLE_PROMPT;
      if (upgradeProposal) {
        const facts = parseUpgradeFacts(q);
        if (facts) {
          setUpgradeProposal({...upgradeProposal,inputs:{...upgradeProposal.inputs,...facts}});
          noteBubble('Updated the open upgrade with your stated facts, marked user-entered and unverified. Review the recomputed checks below; nothing has been applied.');
          return;
        }
      }
      setProposal(null);
      setAssemblyProposal(null);
      setUpgradeProposal(null);
      setInventoryProposal(null);
      setVexEditPlan(null);
      setPartEditReq(null);
      if(pendingLibraryImport.current){
        const pending=pendingLibraryImport.current;pendingLibraryImport.current=null;
        const verdict=classifyProposalReply(q);
        if(verdict==='discard'){noteBubble('Import cancelled.');return;}
        if(verdict==='confirm'){
          try{
            const current=readStore<InventoryPart[]>(INVENTORY_KEY,[]),web=readStore<WebPartRecord[]>(WEB_PARTS_KEY,[]);
            if(JSON.stringify(current)!==pending.stock||JSON.stringify(web)!==pending.web)throw new Error('Your library changed. Attach the export again for a fresh preview.');
            const result=mergeLibraryExport(pending.doc,current,web);
            const first=writeStore(INVENTORY_KEY,result.parts);if(first)throw new Error(first);
            const second=writeStore(WEB_PARTS_KEY,result.web);
            if(second){const rollback=writeStore(INVENTORY_KEY,current);throw new Error(second+(rollback?' Inventory was saved but rollback failed; export your current library.':' The inventory change was rolled back.'));}
            noteBubble(`Imported ${result.added} record${result.added===1?'':'s'} into your Library.`);
          }catch(e){noteBubble('Import did not finish: '+(e as Error).message);}
          return;
        }
      }
      if(pendingLibrary.current){
        const pending=pendingLibrary.current;pendingLibrary.current=null;
        const verdict=classifyProposalReply(q);
        if(verdict==='discard'){noteBubble('Cancelled. Your library is unchanged.');return;}
        if(verdict==='confirm'){
          try{
            const current=readStore<InventoryPart[]>(INVENTORY_KEY,[]),web=readStore<WebPartRecord[]>(WEB_PARTS_KEY,[]);
            if(JSON.stringify(current)!==pending.expected||JSON.stringify(web)!==pending.webExpected||JSON.stringify(readStore<GarageRobot[]>(GARAGE_KEY,[]))!==pending.robotsExpected)throw new Error('Your library changed. Ask for a fresh preview.');
            const result=changeLibrary(current,web,catalogItems(parts),activeRecords(readStore<GarageRobot[]>(GARAGE_KEY,[])),pending.command,new Date().toISOString(),pending.id);
            const error=writeStore(INVENTORY_KEY,result.parts);if(error)throw new Error(error);
            noteBubble('Saved: '+result.description+'.');
          }catch(e){noteBubble((e as Error).message);}
          return;
        }
      }
      /* A pending web proposal owns the next reply: an affirmative
       * lands it (deterministic code, never the model), a negative
       * discards it, a short ambiguity re-asks ONCE, and anything
       * else — a new topic, another link — retires it silently and
       * falls through to the normal paths below. */
      if (pendingWebProposal.current) {
        const pending = pendingWebProposal.current;
        const verdict = classifyProposalReply(q);
        if (verdict === "confirm") {
          pendingWebProposal.current = null;
          landWebProposal(pending);
          return;
        }
        if (verdict === "discard") {
          pendingWebProposal.current = null;
          noteBubble("Discarded — nothing was saved.");
          return;
        }
        if (!extractFirstUrl(q) && isShortReply(q) && !pending.reasked) {
          pending.reasked = true;
          noteBubble("I still have that web proposal waiting — reply “yes” to save it or “no” to discard it. Nothing is saved until you say yes.");
          return;
        }
        pendingWebProposal.current = null;
      }
      /* Submit a robot through chat: a GitHub repo link anywhere in
       * the message opens the repo importer with that repo, and the
       * import starts there (same pipeline as /import/'s own form). */
      const libraryWeb=detectWebAddIntent(q)&&extractFirstUrl(q)&&(/\b(part|tool|model|wishlist|stl|obj|glb|scad)\b/i.test(q)||pathname.startsWith('/inventory'));
      const repo = libraryWeb ? null : repoLinkIn(q);
      if (repo) {
        noteBubble(`Importing ${repo.owner}/${repo.repo}. I'm opening the repo importer: it reads the README, parts list, model files and pictures, then you can save it to your Workshop.`);
        const slug = repo.owner + '/' + repo.repo;
        if ((pathname || '').replace(/\/$/, '') === '/import') {
          router.replace('/import/?repo=' + encodeURIComponent(slug));
          window.dispatchEvent(new CustomEvent(REPO_IMPORT_EVENT, { detail: slug }));
        } else {
          router.push('/import/?repo=' + encodeURIComponent(slug));
        }
        return;
      }
      /* Sample / example / first-robot asks: the recorded Omega1
       * sample card (lib/sampleRobot.ts), served before every live
       * path — deterministic, so it answers in demo mode too. (The
       * engine/wrench modules are import-locked by their eval
       * harnesses, so the card lives in the lib, not the engine.) */
      if (isSampleAsk(q)) {
        appendMsg({ who: "bot", html: sampleAnswerHtml() });
        return;
      }
      const designPrompt = spawnDesignPrompt(q, messagesRef.current);
      if (designPrompt) {
        noteBubble('I carried the robot and parts you described into Design a robot. Review the description and send it to generate a new concept, then review and save the result. Nothing has been added to your Workshop yet.');
        // The submit handler clears its input and busy flag before this handoff.
        window.setTimeout(() => promptWrench({mode:'design',text:designPrompt}), 0);
        return;
      }
      if (runCommands(q)) return;
      const nav = parseNavCommand(q, navContext());
      if (nav) { doNav(nav); return; }
      /* Web knowledge loop: an add/update ask carrying a page URL
       * becomes a proposal, presented in chat for confirmation —
       * never a silent write. Live path only: in demo mode this
       * branch is skipped entirely, so the demo proposes nothing,
       * saves nothing and makes no /web call. */
      if (!demoRef.current && detectWebAddIntent(q) && detectWebIntent(q)?.kind === 'scrape') {
        void proposeFromWeb(q);
        return;
      }
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
        html: '<p class="fc-dim">Thinking&hellip;</p>',
      });
      const done = (ans: AnswerResult & { sources?: SourceRef[]; grounding?: Msg["grounding"]; finds?: WebFind[]; images?: string[] }) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === waitId ? { ...m, html: ans.html, hits: ans.hits, sources: ans.sources, grounding: ans.grounding, finds: ans.finds, images: ans.images } : m
          )
        );
        setChips(
          ans.chips && ans.chips.length
            ? ans.chips
            : chipsFor(memoryRef.current)
        );
        autoAction(q, ans);
      };
      /* The vanilla widget answers inside its data-load promise, so
       * the "Checking…" bubble paints first; the data here is a
       * static import, so defer one tick to keep the same rhythm. */
      window.setTimeout(() => {
        const turn = wrench.answerTurn(q, memoryRef.current);
        memoryRef.current = turn.memory || {};
        let ans: AnswerResult & { sources?: SourceRef[] } = turn;
        // Ordinary signed-in conversation is Muse-first. Recorded fuzzy matches
        // cannot answer a different question or replace a failed live request.
        if (!demoRef.current && !isDemoRequest(q)) ans = {
          html: '<p>The live model is unavailable for this conversation. Nothing was changed. Try again, or use the recorded demo.</p>',
          fallback: true,
        };
        /* A question about the Workshop robot on screen: the recorded
         * catalogue can't answer it (its fuzzy match can land on an
         * unrelated part), so it goes live with the snapshot, and the
         * local answer is what the Workshop has on record. */
        const wsNow = (pathname || "").startsWith("/garage") ? readWorkshopContext() : null;
        /* An explicit web ask always goes live with the fetch: a recorded
         * fuzzy match must not swallow "search the web for …". */
        if (detectWebIntent(q) && !ans.fallback) ans = { ...ans, fallback: true };
        if (wsNow?.robotId && isWorkshopRobotQuestion(q, wsNow) && !detectWebIntent(q)) {
          ans = {
            html: snapshotAnswer(wsNow).map((para) => "<p>" + esc(para).replace(/\n/g, "<br>") + "</p>").join(""),
            fallback: true,
          };
        }
        /* Demo answers stay recorded; ordinary account conversation
         * uses the live model before fuzzy catalogue matches. In demo mode the
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
          /* The fetch's pictures and shoppable finds ride along with
           * the live answer (lib/webParts). */
          let webFound: { finds: WebFind[]; images: string[] } | null = null;
          void fetchWebGrounding(q)
            .then((web) => { webFound = web; return web; })
            .then((web) => liveChat(q, web))
            .then(({ answer, ws, webCaption }) => {
              const found = webFound as { finds: WebFind[]; images: string[] } | null;
              done({
                finds: found?.finds?.length ? found.finds : undefined,
                images: found?.images?.length ? found.images : undefined,
                html:
                  '<p><span class="fc-live-badge">' +
                  LIVE_BADGE +
                  "</span></p><p>" +
                  esc(answer).replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br>") +
                  "</p>",
                chips: ans.chips,
                /* Grounding is earned only here: a live answer that
                 * actually carried a Workshop snapshot and/or a
                 * successful web fetch. The caption names exactly
                 * what was sent — the Workshop robot, the web
                 * source, or both. The fallback paths below (and
                 * every recorded answer) call done without it, so
                 * they render no caption. */
                grounding:
                  ws || webCaption
                    ? {
                        caption: [
                          ws ? groundingCaption(ws) : "",
                          webCaption || "",
                        ]
                          .filter(Boolean)
                          .join(" · "),
                        failing: ws ? workshopSnapshotFailing(ws) : false,
                        ...(ws?.robotId && webCaption
                          ? { note: { robotId: ws.robotId, robotName: ws.robotName, text: answer, source: webCaption } }
                          : {}),
                      }
                    : undefined,
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
    [appendMsg, autoAction, checkLive, doNav, engine, fetchWebGrounding, liveBase, liveChat, pathname, proposeViaLive, proposeFromWeb, landWebProposal, runCommands, setChips, wrench, noteBubble, router]
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
          const allSaved = readStore<GarageRobot[]>(GARAGE_KEY, []);
          const saved = activeRecords(allSaved);
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
            const error = writeStore(GARAGE_KEY, [...allSaved, entry]);
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

  /* One-tap Fix on a FAIL-grounded live answer. Docked in the
   * Workshop, the button asks Garage (through the workshopContext
   * bridge — neither side imports the other) to switch the selected
   * robot to its Checks tab, where the "Fix with Muse Spark" loop
   * lives. Anywhere else the honest move is to route to the Workshop
   * and say, in a bubble, to open the robot's Checks tab — the chat
   * cannot switch another page's tab and never pretends it did. */
  const fixGroundedAnswer = useCallback(() => {
    if ((pathname || "").startsWith("/garage")) {
      requestWorkshopFix();
    } else {
      noteBubble("Opening the Workshop — open that robot's Checks tab there to run “Fix with Muse Spark” on its failing checks.");
      router.push("/garage/");
    }
  }, [noteBubble, pathname, router]);

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
    pendingSave.current = null;
    pendingWebProposal.current = null;
    pendingLibrary.current = null;
    pendingLibraryImport.current = null;
    setProposal(null);
    setAssemblyProposal(null);
    setUpgradeProposal(null);
    setInventoryProposal(null);
    setDexMoveProposal(null);
    setRobotDeleteProposal(null);
    setVexBuilds(null);
    setVexEditPlan(null);
    setPartEditReq(null);
    setPartLookReq(null);
    lastApplied.current = null;
    memoryRef.current = {};
    carry.messages = [];
    carry.proposal = null;
    carry.inventoryProposal = null;
    carry.dexMoveProposal = null;
    carry.robotDeleteProposal = null;
    carry.assemblyProposal = null;
    carry.upgradeProposal = null;
    carry.vexBuilds = null;
    carry.vexEditPlan = null;
    carry.memory = {};
    setChipsState(chipsFor({}));
  }, [pathname, wrench]);

  const saveGroundedNote = (note: GroundedNote) => {
    const err = addRobotNote(note.robotId, note.text, note.source);
    noteBubble(err ?? `Saved to ${note.robotName}’s notes, with its source. I’ll use it when you ask about ${note.robotName}; delete it on its Overview any time.`);
  };

  return {prepareLibraryImport,ask,messages,chips,onHitClick,fixGroundedAnswer,saveGroundedNote,workingOn,postCreateResult,openRobot,subText,resetConversation,actions: <div className="main-chat-actions">
        {vexBuilds && <VexBuildsCard builds={vexBuilds} onAdd={addVexBuild} onClose={() => setVexBuilds(null)} />}
        {partEditReq && <PartEditCard key={partEditReq.baseVersionId + partEditReq.plan.phrase} req={partEditReq} onApply={() => applyPartEditReq(partEditReq)} onCancel={() => { setPartEditReq(null); noteBubble(`Cancelled. ${partEditReq.robotName} is unchanged.`); }} />}
        {partLookReq && <PartLookCard key={partLookReq.robotId + partLookReq.plan.phrase} req={partLookReq} onKeep={(data, job) => { void keepPartLook(partLookReq, data, job); }} onCancel={(why) => { setPartLookReq(null); noteBubble(why ? `No new look this time: ${why}` : `Stopped. ${partLookReq.robotName} is unchanged.`); }} />}
        {vexEditPlan && <VexEditCard key={vexEditPlan.baseVersionId + vexEditPlan.phrase} plan={vexEditPlan} onApply={() => applyVexEdit(vexEditPlan)} onCancel={() => { setVexEditPlan(null); noteBubble(`Cancelled. ${vexEditPlan.robotName} is unchanged.`); }} />}
        {upgradeProposal && <UpgradeProposal key={upgradeProposal.robotId+':'+upgradeProposal.expectedRobotVersionId+':'+upgradeProposal.expectedAssemblyRevision} request={upgradeProposal}
          onInputsChange={inputs=>setUpgradeProposal(previous=>previous?{...previous,inputs}:null)}
          onApplied={versionId=>{lastApplied.current={robotId:upgradeProposal.robotId,versionId,scope:'assembly'};setUpgradeProposal(null);noteBubble('Incomplete upgrade plan saved as one robot version: assembly, wiring, evidence and CAD together. It is not ready for power. Open Build or Wiring to review it; type “undo” to restore the previous complete snapshot.');}}
          onCancel={()=>{setUpgradeProposal(null);noteBubble('Upgrade cancelled. Your robot is unchanged.');}} />}
        {inventoryProposal&&<InventoryProposal key={JSON.stringify(inventoryProposal)} operation={inventoryProposal} onDone={text=>{setInventoryProposal(null);noteBubble(text);}} onCancel={()=>{setInventoryProposal(null);noteBubble('Cancelled. Inventory unchanged.');}}/>}
        {dexMoveProposal&&<DexMoveProposal key={JSON.stringify(dexMoveProposal)} plan={dexMoveProposal} onDone={text=>{setDexMoveProposal(null);noteBubble(text);}} onCancel={()=>{setDexMoveProposal(null);noteBubble('Cancelled. Robodex filing unchanged.');}}/>}
        {robotDeleteProposal&&<RobotDeleteProposal key={robotDeleteProposal.id} robot={robotDeleteProposal} onDone={text=>{setRobotDeleteProposal(null);noteBubble(text);}} onCancel={()=>{setRobotDeleteProposal(null);noteBubble('Cancelled. Your robot is unchanged.');}}/>}
        {assemblyProposal && <AssemblyProposal key={JSON.stringify(assemblyProposal)} operation={assemblyProposal}
          onApplied={versionId => { lastApplied.current = {robotId: assemblyProposal.robotId,versionId,scope:'assembly'}; setAssemblyProposal(null); noteBubble('Assembly saved. Open this robot in My robots to see it in 3D. Type “undo” to restore the previous assembly.'); }}
          onCancel={() => {setAssemblyProposal(null); noteBubble('Cancelled. Assembly unchanged.');}}
          onError={text => {setAssemblyProposal(null); noteBubble(text);}} />}
        {proposal && (() => {
          const op = proposal.operation;
          const saved = readActiveRobots(() => readStore<GarageRobot[]>(GARAGE_KEY, []));
          let checks: string[] = [];
          try {
            const candidate = applyOperation(saved, op, 'preview', 'preview');
            checks = forgeValidateSpec(candidate.find(r => r.id === op.robotId)!.versions.at(-1)!.spec).lines;
          } catch (e) { checks = [(e as Error).message]; }
          const field = FIELD_GROUPS.flatMap((group) => group.fields).find((field) => field.path === op.path);
          const show = (value: unknown) => typeof value === 'number' ? fmtValue(Number((value * (field?.scale ?? 1)).toFixed(4))) : fmtValue(value);
          return <div className="fc-msg bot" role="region" aria-label="Operation preview">
            <strong>Change {field?.label ?? op.path}</strong>
            <p>{show(proposal.before)} → {show(proposal.after)} {field?.unit}</p>
            <p>Apply saves a new version. Any separate unsaved draft is kept.</p>
            <details><summary>Browser checks (subset)</summary>{checks.map((line, i) => <p key={i}>{line}</p>)}{!checks.length && <p>No findings in the browser subset.</p>}</details>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => {
              if (proposalRef.current !== proposal) return;
              // Invalidate synchronously so a double click cannot apply twice.
              proposalRef.current = null;
              setProposal(null);
              try {
                const current = readStore<GarageRobot[]>(GARAGE_KEY, []);
                if (!activeRecords(current).some((robot) => robot.id === op.robotId)) throw new Error('That robot is archived or no longer exists.');
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
