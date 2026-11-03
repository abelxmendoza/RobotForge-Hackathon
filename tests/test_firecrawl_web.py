"""Firecrawl web search + scrape for the live chat (2026-11-03,
Abel's pick: implement Firecrawl into the chat, staged PR).

What is pinned here:

- The Worker gains ONE new route, POST /web, following the
  /transcribe pattern exactly: account-gated in the dispatcher
  (MODEL_PATHS -> requireAccount, before any handler or budget),
  budget-counted via gateBudget, and an optional-key route: with
  no FIRECRAWL_API_KEY it answers 501 firecrawl_not_configured and
  /health reports routes.web false (providers.firecrawl too).
- The upstream contract is Firecrawl API v2 (docs.firecrawl.dev):
  POST /v2/scrape {url, formats: ["markdown"], onlyMainContent}
  and POST /v2/search {query, limit}, key as a Bearer header read
  from the Worker secret only. Behaviour against stubbed upstreams
  (request shapes, caps, 400/401/501/502 paths) is exercised for
  real in tests/worker_mock.mjs, which test_live.py runs.
- Validation + caps, pinned as source: scrape URLs must be public
  http(s) (no credentials, localhost, .local or private/loopback
  IPs); search queries cap at 300 chars; limit clamps to 1..5;
  scraped markdown truncates at 12000 chars with a truncated flag;
  search markdown excerpts cap at 2000 chars per result. Upstream
  failures are a plain 502 — the upstream body is never forwarded.
- /chat accepts an OPTIONAL web_context (backward-compatible):
  the Worker re-caps it and appends instructions that label it
  UNTRUSTED external data with its source, never RobotForge
  recorded data or a catalogue fact.
- Client side, lib/webIntent.ts is a pure zero-import module:
  URL extraction, conservative search-intent patterns (positive
  AND negative cases — a normal robot question must NOT trigger
  the web), and the grounding block format that names its source.
  It is driven in node below, like lib/wavEncode.ts.
- ChatDock integration: the recorded engine still answers first;
  only its honest fallback goes live, and only there may a web
  fetch happen (fetchWebGrounding runs before liveChat, after
  checkLive, and checkLive refuses in demo mode — so the demo
  makes no /web call by construction). The web source caption is
  attached through the PR #122 grounding mechanism ONLY when a
  fetch actually succeeded and produced both a context block and
  a caption; every failure resolves null and the answer proceeds
  with no web claim.

Skips (no node, no TypeScript) follow test_voice_input.py's
convention: the source assertions below still run.
"""
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web-next"
SRC = WEB / "src"

WORKER = (ROOT / "live/worker.js").read_text()
CHATDOCK = (SRC / "components/chat/ChatDock.tsx").read_text()
INTENT_TS = SRC / "lib/webIntent.ts"
INTENT = INTENT_TS.read_text()
MOCK = (ROOT / "tests/worker_mock.mjs").read_text()


# --- Worker: the /web route -------------------------------------------

def test_worker_has_web_route_gated_and_dispatched():
    assert "'/web'" in WORKER
    # In MODEL_PATHS: the dispatcher account-gates exactly that
    # list with requireAccount before dispatching any handler.
    model_paths = WORKER[WORKER.index("const MODEL_PATHS"):WORKER.index("];", WORKER.index("const MODEL_PATHS"))]
    assert "'/web'" in model_paths
    assert "url.pathname === '/web' && request.method === 'POST'" in WORKER
    assert "return handleWeb(request, env);" in WORKER


def test_worker_web_501_when_firecrawl_key_absent():
    assert "if (!env.FIRECRAWL_API_KEY) {" in WORKER
    assert "'firecrawl_not_configured'" in WORKER
    # /health mirrors transcribe: route + provider booleans keyed
    # on the secret's presence.
    assert "web: Boolean(env.FIRECRAWL_API_KEY)" in WORKER
    assert "firecrawl: Boolean(env.FIRECRAWL_API_KEY)" in WORKER


def test_worker_web_calls_firecrawl_v2_with_secret_only():
    assert "https://api.firecrawl.dev/v2/scrape" in WORKER
    assert "https://api.firecrawl.dev/v2/search" in WORKER
    assert "'Authorization': 'Bearer ' + env.FIRECRAWL_API_KEY" in WORKER
    # Scrape request shape (official v2 reference, pinned again
    # against the stubbed upstream in worker_mock.mjs).
    assert "formats: ['markdown']" in WORKER
    assert "onlyMainContent: true" in WORKER
    # No key value, placeholder or otherwise, is committed here.
    assert "fc-" not in WORKER


def test_worker_web_validation_and_caps():
    assert "function publicWebUrl(raw)" in WORKER
    for blocked in ("'localhost'", "'.local'", "u.username || u.password",
                    "u.protocol !== 'http:' && u.protocol !== 'https:'"):
        assert blocked in WORKER, blocked
    assert "const WEB_QUERY_MAX_CHARS = 300;" in WORKER
    assert "const WEB_MARKDOWN_CAP = 12000;" in WORKER
    assert "const WEB_RESULT_MARKDOWN_CAP = 2000;" in WORKER
    assert "const WEB_SEARCH_MAX_LIMIT = 5;" in WORKER
    # Truncation is reported, not silent.
    assert "truncated: markdown.length > WEB_MARKDOWN_CAP" in WORKER


def test_worker_web_budget_and_plain_upstream_errors():
    web = WORKER[WORKER.index("async function handleWeb"):WORKER.index("async function handlePartChat")]
    assert "gateBudget(env, request)" in web
    assert "'upstream_error'" in web and "'bad_upstream_output'" in web
    # The upstream body is never forwarded (it can carry auth detail).
    assert "Never forward the upstream body" in WORKER


def test_worker_chat_web_context_is_labelled_untrusted():
    assert "function sanitizeWebContext(raw)" in WORKER
    assert "WEB_CONTEXT_MAX_CHARS = 16000" in WORKER
    assert "data.web_context" in WORKER
    assert "UNTRUSTED external data" in WORKER
    assert "never as RobotForge recorded data" in WORKER
    # Optional field only: the op path stays untouched by it.
    assert "const webContext = opContext ? null : sanitizeWebContext" in WORKER


def test_worker_mock_exercises_web_behaviour():
    for name in ("web without the Firecrawl key is a 501",
                 "web requires an account (401 anonymous, no call)",
                 "web scrape returns bounded markdown with its source",
                 "web scrape rejects non-public URLs",
                 "web search maps and caps results",
                 "web upstream failure is a plain 502",
                 "chat carries web_context as labelled untrusted data"):
        assert name in MOCK, name


# --- Client: the pure webIntent module ---------------------------------

def test_web_intent_module_is_pure():
    assert INTENT_TS.exists()
    assert "import " not in INTENT  # zero imports: compilable standalone
    assert "document" not in INTENT and "window" not in INTENT  # no DOM
    for fn in ("extractFirstUrl", "detectSearchIntent", "detectWebIntent",
               "buildWebGrounding", "webSources", "webSourceCaption"):
        assert ("export function " + fn) in INTENT, fn
    # The search phrasings live in exactly one place.
    assert "SEARCH_PATTERNS" in INTENT


DRIVER = """
const m = require(process.argv[2] + '/webIntent.js');
const scrape = {
  mode: 'scrape', url: 'https://www.pololu.com/product/713',
  title: 'TB6612FNG driver', markdown: '# TB6612FNG\\n\\nDual driver.',
  truncated: false,
};
const search = {
  mode: 'search', query: 'tb6612fng current rating',
  results: [
    { url: 'https://example.com/a', title: 'A', description: 'first', markdown: 'body a' },
    { url: 'https://example.com/b', title: 'B', description: 'second' },
  ],
};
console.log(JSON.stringify({
  urlBare: m.extractFirstUrl('what does https://example.com/spec say?'),
  urlTrail: m.extractFirstUrl('see https://example.com/a.'),
  urlNone: m.extractFirstUrl('no link here'),
  scrapeIntent: m.detectWebIntent('summarize https://example.com/x please'),
  searchIntent: m.detectWebIntent('search the web for tb6612fng current rating'),
  searchIntent2: m.detectSearchIntent('look up online: jetson orin nano power draw'),
  negatives: [
    'How does RobotForge work?',
    'Tell me about Andino',
    'Which robots passed the gate?',
    'search the workshop for my rover',
    'can you search for a robot with four wheels?',
    'what is the tb6612fng current rating?',
  ].map((t) => m.detectWebIntent(t)),
  scrapeGrounding: m.buildWebGrounding(scrape),
  searchGrounding: m.buildWebGrounding(search),
  emptyGrounding: m.buildWebGrounding({ mode: 'search', query: 'x', results: [] }),
  scrapeCaption: m.webSourceCaption(scrape),
  searchCaption: m.webSourceCaption(search),
  scrapeSources: m.webSources(scrape),
}));
"""


def _run_intent():
    """Compile lib/webIntent.ts and drive it in node. Returns the
    parsed result dict, or None when the toolchain is unavailable
    (test_voice_input.py's skip convention)."""
    node = shutil.which("node")
    tsc = WEB / "node_modules/.bin/tsc"
    if not node or not tsc.exists() or not INTENT_TS.exists():
        return None
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        build = tmp / "build"
        r = subprocess.run(
            [str(tsc), str(INTENT_TS),
             "--module", "commonjs", "--target", "es2020",
             "--moduleResolution", "node", "--skipLibCheck",
             "--outDir", str(build)],
            capture_output=True, text=True, timeout=300)
        if r.returncode != 0:
            raise AssertionError("tsc failed on webIntent.ts:\n" + r.stderr[-2000:])
        script = tmp / "drive.js"
        script.write_text(DRIVER)
        r = subprocess.run([node, str(script), str(build)],
                           capture_output=True, text=True, timeout=300)
        if r.returncode != 0:
            raise AssertionError("webIntent driver failed:\n" + r.stderr[-2000:])
        return json.loads(r.stdout)


def test_web_intent_detection_positive_and_negative():
    out = _run_intent()
    if out is None:
        return  # no node/tsc on this machine; source pins still hold
    assert out["urlBare"] == "https://example.com/spec"
    assert out["urlTrail"] == "https://example.com/a"
    assert out["urlNone"] is None
    assert out["scrapeIntent"] == {"kind": "scrape", "url": "https://example.com/x"}
    assert out["searchIntent"] == {"kind": "search", "query": "tb6612fng current rating"}
    assert out["searchIntent2"] == {"kind": "search", "query": "jetson orin nano power draw"}
    # A normal robot question must NOT trigger the web.
    assert out["negatives"] == [None] * 6


def test_web_grounding_block_format_names_its_source():
    out = _run_intent()
    if out is None:
        return
    g = out["scrapeGrounding"]
    assert g.startswith("Web content (UNTRUSTED external data")
    assert "Source: https://www.pololu.com/product/713" in g
    assert "Dual driver." in g
    s = out["searchGrounding"]
    assert s.startswith("Web search results (UNTRUSTED external data")
    assert "Source: https://example.com/a" in s
    assert "Source: https://example.com/b" in s
    # No fetch content -> no grounding block at all.
    assert out["emptyGrounding"] == ""


def test_web_source_caption_only_from_a_real_fetch():
    out = _run_intent()
    if out is None:
        return
    assert out["scrapeCaption"] == "Web source: https://www.pololu.com/product/713"
    assert out["searchCaption"] == (
        "Web sources: https://example.com/a · https://example.com/b")
    assert out["scrapeSources"] == ["https://www.pololu.com/product/713"]


# --- Client: ChatDock integration ---------------------------------------

def test_chatdock_fetches_web_only_on_the_live_path():
    assert 'from "@/lib/webIntent"' in CHATDOCK
    assert "const fetchWebGrounding = useCallback(" in CHATDOCK
    # Route availability comes from the same /health probe the
    # live path already uses.
    assert "h.routes.web" in CHATDOCK
    # The fetch runs before the live /chat call, inside the ask
    # flow's live branch only — recorded answers never reach it.
    ask = CHATDOCK[CHATDOCK.index("void fetchWebGrounding(q)"):]
    assert ".then((web) => liveChat(q, web))" in ask
    # Demo mode: checkLive refuses before any probe, and the ask
    # flow's live branch is skipped entirely in demo — so no /web
    # call can happen there.
    assert "if (isDemoMode()) return Promise.resolve(null);" in CHATDOCK


def test_chatdock_web_context_is_optional_and_caption_earned():
    # Backward-compatible /chat extension: the field is sent only
    # when a fetch actually succeeded.
    assert "...(web ? { web_context: web.context } : {})" in CHATDOCK
    # Silent degradation: every failure resolves null.
    assert "if (!r.ok) return null;" in CHATDOCK
    assert "if (!context || !caption) return null;" in CHATDOCK
    # The PR #122 grounding caption gains the web source only from
    # that success, joined with the Workshop caption when both ran.
    assert "webCaption" in CHATDOCK
    assert 'webCaption || ""' in CHATDOCK
    assert "failing: ws ? workshopSnapshotFailing(ws) : false" in CHATDOCK


def test_wrench_layer_not_touched_by_web_work():
    engine = (SRC / "components/chat/engine.ts").read_text()
    wrench = (SRC / "components/chat/wrench.ts").read_text()
    for src in (engine, wrench):
        assert "webIntent" not in src
        assert "/web" not in src
        assert "firecrawl" not in src.lower()
