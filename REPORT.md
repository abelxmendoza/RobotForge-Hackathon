# Hardening sweep — RobotForge-Hackathon — 2026-10-27

Branch: `hardening/sweep-2026-10-27` (local only — nothing pushed,
no PR opened, live site untouched). Base: `main` @ `abe9521`.

**Suite counts: 245 passed (baseline) → 255 (error handling) →
278 passed (final). Source coverage: 81% → 84%.**

Commits on this branch:

| Commit | Workstream |
|---|---|
| `844cea0` | Error handling: bad files are clean CLI errors, not tracebacks |
| `7c22c93` | Tests: coverage for repair/validate/listimport/kinds + CLI end-to-end |
| `1c0579c` | CI: run the test suite on push to main and on PRs |
| `93a44da` | Tech debt: remove proven-dead code and unused imports |
| (this file) | Sweep report — workstream 3 (security) changed no code |

Overlap note: `src/robotforge/twin.py` was deliberately **not**
touched — a separate agent is fixing the missing-`gz` crash in the
twin spawn path on another branch. Where this sweep's work borders
that fix (run-gate spec loading), the boundary is called out below.

---

## 1. Tests

**Checked:** full suite run; per-module coverage with coverage.py;
test inventory vs `src/robotforge` modules.

**Coverage before → after (selected):**

| Module | Before | After | Note |
|---|---|---|---|
| repair.py | 57% | 98% | proposal edge cases, narration paths |
| validate.py | 85% | 98% | warning branches |
| listimport.py | 85% | 99% | full `render_text` |
| kinds.py | 94% | 97% | override validation errors |
| cli.py | 64% | 68% | + all error paths (workstream 2) |
| **TOTAL** | **81%** | **84%** | |

**Changed** (`7c22c93`): `tests/test_coverage_gaps.py` (22 tests:
repair `to_dict`s, wheel-suspect-without-measurements note,
separation repair refused below the 50 mm chassis floor,
`apply_repairs` for both correction kinds, `render_proposal_md`,
`narrate` via a fake helper subprocess + template fallback on
helper failure + no-corrections case; validate warning/error
branches; `render_text` full report; kinds choice/preset errors)
and `tests/test_e2e_cli.py` — an end-to-end test that runs the CLI
demo path as real subprocesses in a temp dir:
`new → validate → urdf → describe --mock → site`, asserting exit
codes and artifacts at each step.

**Remaining gaps (honest):** twin.py 38% (Gazebo subprocess code —
the other agent's branch), photo.py 74%, lookup.py 82%,
describe.py 80% — what's uncovered there is live-transport code
(API keys, network, SAM/Gazebo processes) that cannot be exercised
offline; see "Not fixed" #8.

## 2. Error handling

**Checked:** every CLI subcommand driven with bad inputs via a
probe harness (33 cases: missing files, directories in place of
files, malformed JSON, wrong-shape JSON, empty files, blocked
output paths, missing optional deps). 13 cases produced unhandled
tracebacks before the fix; **0 after**. The known missing-`gz`
traceback was excluded per instructions (separate agent).

**Findings (all fixed in `844cea0`):**

- **[worst] Missing/unreadable spec file crashed 7 commands.**
  `RobotSpec.from_json(Path(args.spec).read_text())` sat outside
  any `OSError` handling, so `validate`, `urdf`, `cad`,
  `stability`, `harness`, `run-gate` and `repair` all died with a
  raw `FileNotFoundError`/`IsADirectoryError` traceback on the
  most common user mistake there is. Fixed with a shared
  `_load_spec()` that raises `SpecError` → the CLI's existing
  `spec error: ...` message, exit 2.
- **import-list**: missing file / directory → traceback. Now
  `import error: cannot read list file ...`, exit 2.
- **repair**: missing report file → traceback; malformed report
  JSON → raw `JSONDecodeError`. Now `repair error: ...`, exit 2.
- **specimen**: missing URDF → traceback; malformed URDF → raw
  `xml.etree.ElementTree.ParseError`. Now `specimen error: ...`,
  exit 2.
- **urdf --out** whose parent path is blocked by a file →
  `FileExistsError` traceback. Now `urdf error: cannot write ...`,
  exit 2.

All fixes follow the codebase's existing error style
(`<area> error: <what>` on stderr, exit 2). Ten regression tests
in `tests/test_cli_errors.py` — verified to **fail on the old
code** (via `git stash`) and pass on the new.

## 3. Security

Scope: Abel's own assets only — this repo (full history) and his
GitHub Pages site. **No code changed in this workstream**; every
finding is either clean, low-risk by design, or flagged below.

### (a) Secrets scan of full git history — CLEAN

87 commits, all branches. Scanned for GitHub tokens (`ghp_`,
`github_pat_`), OpenAI-style keys (`sk-`), AWS keys (`AKIA`),
Slack tokens, Google API keys, Databricks tokens, private-key
blocks, assignment-style hardcoded secrets
(`api_key = "..."` etc.) in code files, and env/secret filenames
(`.env`, `*.pem`, `*.key`, credentials) ever committed.
**Zero hits.** Keys exist only as env-var names and
`wrangler secret put` instructions, as designed. `.gitignore`
covers `.env`. (The repo's large base64 blobs are embedded site
images, not secrets.)

### (b) Dependency audit — nothing to audit

`pyproject.toml` declares **zero runtime dependencies**; there is
no `requirements*.txt`, `package.json`, or lockfile anywhere in
the project. An AST scan of `src/robotforge` confirms imports are
stdlib-only, plus two lazy, guarded, function-level imports of
external runtime bindings (`gz.transport13` in twin.py, shipped
with Gazebo; `dynamic_credentials` in photo.py, the connector
surrogate) — neither is a pip dependency of this project.
pip-audit has no third-party surface to audit.

### (c) Python SAST (bandit 1.9.4, src/, 7,155 LOC)

**0 High, 4 Medium, 24 Low.**

- **Medium B310 `urlopen` ×3** — real risk assessed as **low**:
  `describe.py:178` posts to a constant `API_BASE`;
  `lookup.py` `_github_get`/`_download` build URLs from constant
  bases (`api.github.com`, `raw.githubusercontent.com`). No
  user-controlled scheme or host anywhere. One nuance worth
  knowing: `API_BASE` is env-overridable (`META_API_BASE`), and
  the Meta bearer key is sent to whatever host it names — by
  design for OpenAI-compatible endpoints; see "Not fixed" #6.
- **Medium B314 `ElementTree.parse`** — `specimen.py:172` parses
  a local URDF file the user explicitly points the CLI at.
  Python ≥3.8's stdlib ET does not resolve external entities;
  residual risk is an entity-expansion DoS from a file the user
  chose themselves. The standard fix (defusedxml) would add a
  dependency to a zero-dependency project → Abel's call (#1).
- **Low ×24** — mostly false positives and safe patterns:
  B105 ×3 are badge strings (`'GATE: PASS'`, `'pass'`); the
  B404/B603/B607 subprocess hits are list-argv spawns with no
  shell (the `gz` spawn among them is the other agent's fix);
  B110 ×2 are deliberate fallbacks (repair narration, sibling-ref
  parsing); B405/B406 concern `xml.sax.saxutils.escape`, which
  urdf.py uses to *generate* XML — the safe direction.

### (d) Web checks on the live Pages site — partial (tooling limit)

nikto and whatweb via the Kali container (`~/workspace/kali`)
could not complete: the sandbox's proot egress accepts the proxy
CONNECT but guest TLS sessions fail (nikto: "Unable to connect to
abelxmendoza.github.io:443" on 3 attempts, while host-side curl
succeeds instantly). This is the known sandbox network quirk, not
a site property. Verified host-side instead:

- The site is **static GitHub Pages** — no server code, no auth,
  no uploads; attack surface is the generated HTML/JS itself.
- Response headers (via curl): `Strict-Transport-Security:
  max-age=31556952` present; `Access-Control-Allow-Origin: *`
  (Pages default, harmless for public static content); **no
  CSP / X-Frame-Options / X-Content-Type-Options** — GitHub Pages
  offers no way to set custom headers on a plain Pages site, so
  this is a platform limitation to accept (or revisit if the
  site ever sits behind Cloudflare), not a repo defect.
- Spot-check of `assets/js/chat.js`: user/model text is rendered
  with `textContent`, and an `escText` helper exists for HTML
  contexts; `innerHTML` is used for static template markup. No
  unsanitized sink for message text found.

### (e) live/worker.js review — strong posture, two flags

Confirmed in the code: CORS is an exact-origin allowlist with
403 for other browser origins; body caps are enforced on the
actual body after read (no Content-Length bypass); per-route
input caps (describe 4000 / chat 2000 / list 8000 chars; photo
~3 MB, `data:image/` prefix required); the KV budget gate
increments **before** the model call and **fails closed** (503)
on any KV error; `LIVE_ENABLED=0` kill switch; model/temperature/
tokens fixed server-side; secrets only via `env`, never in the
repo (see (a)).

Flags (both in "Not fixed"): budget counters are
read-then-write in Workers KV, which has no atomic increment —
a concurrent burst can overshoot the daily/per-IP caps somewhat
before counters settle (#4). And upstream error bodies (≤300
chars) can surface inside client error messages via `e.message`
— minor information disclosure in a deliberate honest-errors
style; trimming it is a copy/behaviour change (#3).

Also flagged from (c): `lookup --pull` writes files to
`dest / repo_path` where `repo_path` comes from a repo's git
tree. A `..` component would be a write-escape, but git itself
forbids `..` in tree entries, so practical risk is ~0; a
one-line guard is cheap defense-in-depth (#2).

## 4. CI/CD

**Checked:** `.github/workflows/` (only `pages.yml` existed) and
run history via the public GitHub API.

- **Pages workflow is healthy — not fixed, because it isn't
  broken.** There has been exactly **one failed run ever**:
  40402415979 (2026-10-26 21:12 UTC, sha `4844d51`), which
  failed at the `configure-pages` step. Oct 26 saw 8 runs
  (7 success) amid that day's Pages setup changes, and every
  run since — 15+ on Oct 27 up to HEAD `abe9521` — succeeded.
  A single configure-pages failure during Pages enablement
  churn, then a clean streak, is a transient platform event,
  not a workflow defect. `pages.yml` also parses as valid YAML.
- **Gap found and fixed (`1c0579c`): nothing ran the test suite
  in CI.** Added `.github/workflows/tests.yml`: on push to
  `main`, on PRs, and manually — checkout, Python 3.12,
  `pip install -e . pytest`, `python -m pytest tests/ -q`.
  YAML validated by parsing; the exact steps were simulated in a
  clean local venv (fresh `pip install -e .`, suite run from
  outside the tree): **278 passed**. I cannot trigger GitHub
  runs from here — the workflow's first real run happens on
  Abel's next push (this branch, a PR, or the merge to main);
  expect green based on the simulation, and the run will appear
  under the repo's Actions tab as "Tests".

## 5. Tech debt

- **TODO/FIXME/XXX sweep: zero** across `src/`, `tests/`, and
  `live/worker.js`.
- **Dead code:** vulture at 90% confidence finds no dead
  functions/classes in `src/`. Removed only what pyflakes
  *proved* unused (`93a44da`): a discarded `rep.summary()` call
  in `format_harness_report`, a discarded `rep.to_dict()` in
  `format_stability_report`, `f`-prefixes on six literal strings
  in `urdf.py`, and unused imports/locals in five test files.
  Suite unchanged (278), pyflakes now fully clean.
- **Duplication noticed, not changed:** the `harness` and
  `stability` branches of cli.py each carry ~15 lines of
  near-identical report plumbing (date stamp, `--out` write,
  `--json`/text print). Their exit-code semantics differ
  (harness returns 1 on findings, stability returns 0), so a
  shared helper needs care; listed in "Not fixed" (#7) rather
  than risk a behaviour change in a sweep.

## NOT fixed — Abel's call

1. **specimen URDF parsing**: adopt `defusedxml` (adds the
   project's first runtime dependency) or accept stdlib
   ElementTree for user-supplied local files.
2. **lookup pull path guard**: one-line `..` rejection on
   repo-tree paths before writing — defense-in-depth against a
   hostile repo; practical risk ~0 today.
3. **Worker error messages**: trim upstream error detail out of
   client-facing responses (changes user-facing copy; some
   tests assert on message content).
4. **Worker budget atomicity**: KV counters are
   read-then-write; a hard guarantee needs Durable Objects.
   Current posture (fail-closed, pre-increment) bounds the
   damage to burst overshoot only.
5. **Pages security headers** (CSP, frame options): impossible
   on plain GitHub Pages; would require serving the site
   through a proxy (e.g. Cloudflare) — revisit only if the
   site ever handles accounts or uploads.
6. **`META_API_BASE` override**: the Meta key is sent to
   whatever base URL the env names. Intended for compatible
   endpoints; lock it to `api.meta.ai` if that flexibility is
   never wanted.
7. **cli.py harness/stability dedupe**: extract the shared
   report-writing helper, carefully preserving the different
   exit-code semantics.
8. **Mocked-transport tests** for the remaining live paths in
   photo.py / lookup.py / describe.py, if the coverage numbers
   (74–82%) are worth raising — they need fake transports, not
   real keys.

## What happens next (for Abel)

- Review this branch; if it looks good, push it and open a PR —
  the new "Tests" workflow will run on the PR and again on
  merge to `main` (Pages deploy unchanged).
- Nothing here touches the live site, the worker deployment, or
  `twin.py` (the other agent's `gz` fix merges independently;
  expected conflict surface: none — this branch does not modify
  twin.py, and its cli.py changes are in spec loading and
  file-reading paths only).
