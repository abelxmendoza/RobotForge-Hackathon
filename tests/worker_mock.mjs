/* Local mock test for live/worker.js — no network, no real keys.
 *
 * Stubs global fetch (the Worker's upstreams are Baseten for
 * describe/chat/list and the Meta Model API for photo) and Workers
 * KV, then exercises the Worker the way the site will: health +
 * route reporting, CORS rejection, happy-path passthroughs,
 * malformed model output -> 502, budget exhaustion -> 503, per-IP
 * rate limit -> 429, oversized input -> 413, /photo 501 when the
 * optional Meta key is absent, ESTIMATED framing enforced on photo
 * drafts, and /list sanitizing invented catalogue ids.
 *
 * Run: node tests/worker_mock.mjs   (exit 0 = all scenarios passed)
 * tests/test_live.py runs this when node is available.
 */
import assert from 'node:assert';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const workerUrl = pathToFileURL(join(here, '..', 'live', 'worker.js')).href;

class FakeKV {
  constructor() { this.map = new Map(); }
  async get(k) { return this.map.has(k) ? this.map.get(k) : null; }
  async put(k, v) { this.map.set(k, String(v)); }
  async delete(k) { this.map.delete(k); }
  async list({ prefix = '', limit = 1000 } = {}) {
    const names = [...this.map.keys()].filter(k => k.startsWith(prefix)).sort();
    return {
      keys: names.slice(0, limit).map(name => ({ name })),
      list_complete: names.length <= limit, cursor: '',
    };
  }
}

const GOOD_SPEC = {
  name: 'mockbot', description: 'a test rover', drivetrain: 'differential',
  length_m: 0.4, width_m: 0.3, height_m: 0.2, mass_kg: 3.0,
  ground_clearance_m: 0.03,
  wheel: { diameter_m: 0.1, width_m: 0.03, count: 2, driven: true },
  motor: { kind: 'dc_gearmotor', voltage_v: 12.0, count: 2, stall_torque_nm: 0.5 },
  battery: { chemistry: 'lipo', voltage_v: 12.0, capacity_mah: 3000 },
  sensors: [{ kind: 'imu', position: 'center', range_m: null }],
};

const PHOTO_DRAFT = {
  identity_guess: 'TurtleBot 3 Waffle Pi',
  visible_parts: [
    { kind: 'wheel', count: 2, position: 'sides', notes: 'drive wheels' },
    { kind: 'lidar_2d', count: 1, position: 'top', notes: '' },
  ],
  /* description deliberately lacks the ESTIMATED prefix: the Worker
   * must add it before the draft can reach the page. */
  spec: { ...GOOD_SPEC, name: 'Photo Draft Bot' },
};

const LIST_REPLY = {
  items: [
    { title: 'LiPo battery 4S 5200 mAh', matched_part_id: 'lipo_4s_5200', qty: 1 },
    { title: 'Mystery gadget 3000', matched_part_id: 'not_a_real_part', qty: 2 },
  ],
  missing: ['A charger for the battery'],
  wiring: [{ from: 'battery', via: 'XT60', to: 'power distribution',
             note: 'main feed' }],
  draft_spec: GOOD_SPEC,
};

const DOC_DRAFT = {
  identity_guess: 'TurtleBot3 Burger',
  values: [
    { label: 'Overall length', printed: '178 mm', field: 'length_m' },
    { label: 'Battery voltage', printed: '11.1 V', field: 'battery.voltage_v' },
    { label: 'Battery capacity', printed: '1800 mAh', field: 'battery.capacity_mah' },
  ],
  /* description deliberately lacks the DOCUMENT prefix, and mass_kg
   * deliberately has NO transcribed value behind it: the Worker must
   * add the prefix and DROP mass_kg, like photo.py's parser. */
  spec: {
    name: 'TURTLEBOT3 BURGER', description: 'transcribed table',
    length_m: 0.178, mass_kg: 0.93,
    battery: { chemistry: 'LiPo', voltage_v: 11.1, capacity_mah: 1800 },
  },
};

const DOC_BAD = {
  identity_guess: 'Some sheet',
  values: [{ label: 'Length', printed: '178 mm', field: 'length_m' }],
  spec: { name: 'Bad', length_m: 'one-seven-eight' },
};

const FIX_REPLY = {
  changes: [
    { path: 'ground_clearance_m', value: 0.04, reason: 'below the wheel radius' },
    { path: 'sensors', value: [], reason: 'not an allowed field' },
    { path: 'battery.voltage_v', value: -3, reason: 'not a real voltage' },
    { path: 'wheel.count', value: 2.5, reason: 'not an integer' },
  ],
  summary: 'Lower the clearance under the wheel radius.',
};

const PART_REPLY = {
  name: '4S LiPo 5200 mAh', category: 'battery', quantity: 1,
  catalog_part_id: 'lipo_4s_5200',
  specs: { voltage_v: 14.8, capacity_mah: 5200, secret_field: 'drop me' },
  read_from_label: ['voltage_v', 'capacity_mah', 'secret_field'],
  condition: 'used', confidence: 'high',
  question: 'Is the balance lead a 5-pin JST-XH?',
};

const PART_CHAT_REPLY = {
  reply: 'Got it, a 37 mm 12 V gearmotor.',
  update: { name: '37 mm 12 V gearmotor', category: 'motor',
            specs: { voltage_v: 12 }, category_bogus: 'x' },
  confirmed: true,
};

let basetenMode = 'spec'; // spec | fenced | junk | chat | list | list-bad-draft | fix | part-chat | photo | part | transcript | cutoff
let metaMode = 'photo';   // photo | junk | document | document-bad | part | http500
let firecrawlMode = 'ok'; // ok | http500 | empty
let githubMode = 'ok';    // ok | hidden | unverified
let googleMode = 'ok';    // ok | unverified
const upstreamCalls = [];
globalThis.fetch = async (url, opts) => {
  upstreamCalls.push({ url: String(url), opts });
  const u = String(url);
  if (u.startsWith('https://api.meta.ai/')) {
    if (metaMode === 'http500') {
      return new Response('meta boom', { status: 500 });
    }
    if (u.includes('/asr/transcribe')) {
      assert.ok(opts.body instanceof FormData, 'transcribe sends multipart');
      return new Response(JSON.stringify({
        transcript: 'a small indoor rover with four wheels',
        audioDurationMs: 3000, turns: [],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    assert.strictEqual(opts.headers.Authorization, 'Bearer meta-key-456');
    const content = metaMode === 'photo' ? JSON.stringify(PHOTO_DRAFT)
      : metaMode === 'document' ? JSON.stringify(DOC_DRAFT)
      : metaMode === 'document-bad' ? JSON.stringify(DOC_BAD)
      : metaMode === 'spec' ? JSON.stringify(GOOD_SPEC)
      : metaMode === 'chat' ? 'A concise Meta answer.'
      : metaMode === 'part' ? JSON.stringify(PART_REPLY)
      : 'this is not json at all';
    return new Response(JSON.stringify({
      choices: [{ message: { content } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (u.startsWith('https://graph.facebook.com/')) {
    if (u.includes('/oauth/access_token')) {
      return new Response(JSON.stringify({ access_token: 'fb-token-123' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify(
      { id: 'fb-777', name: 'Fran Dev', email: 'fran@example.com' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (u === 'https://github.com/login/oauth/access_token') {
    return new Response(JSON.stringify({ access_token: 'gh-token-123' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (u === 'https://api.github.com/user') {
    return new Response(JSON.stringify({
      id: 4242, login: 'octo', name: 'Octo Dev',
      /* 'hidden' mode: the profile email is null, like a GitHub
       * account with a private address. */
      email: githubMode === 'hidden' ? null : 'octo-public@example.com',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (u === 'https://api.github.com/user/emails') {
    const list = githubMode === 'unverified'
      ? [{ email: 'octo@example.com', primary: true, verified: false }]
      : [{ email: 'octo-secondary@example.com', primary: false, verified: true },
         { email: 'octo@example.com', primary: true, verified: true }];
    return new Response(JSON.stringify(list),
      { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (u === 'https://oauth2.googleapis.com/token') {
    return new Response(JSON.stringify({ access_token: 'goog-token-123' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (u.startsWith('https://openidconnect.googleapis.com/v1/userinfo')) {
    return new Response(JSON.stringify({
      sub: 'g-123', name: 'Gina Dev', email: 'gina@example.com',
      email_verified: googleMode !== 'unverified',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (u.startsWith('https://api.firecrawl.dev/')) {
    assert.strictEqual(opts.headers.Authorization, 'Bearer test-key-456');
    const payload = JSON.parse(opts.body);
    if (firecrawlMode === 'http500') {
      return new Response('firecrawl boom', { status: 500 });
    }
    if (u.includes('/v2/scrape')) {
      assert.deepStrictEqual(payload.formats, ['markdown']);
      assert.strictEqual(payload.onlyMainContent, true);
      return new Response(JSON.stringify({
        success: true,
        data: firecrawlMode === 'empty'
          ? { markdown: '', metadata: {} }
          : {
              markdown: '# TB6612FNG\n\nDual motor driver, 1.2 A per channel.',
              metadata: { title: 'TB6612FNG breakout', sourceURL: payload.url },
            },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    assert.ok(u.includes('/v2/search'), 'unexpected Firecrawl path: ' + u);
    assert.ok(payload.limit >= 1 && payload.limit <= 5, 'search limit clamped');
    return new Response(JSON.stringify({
      success: true,
      data: {
        web: [{
          url: 'https://example.com/driver', title: 'Driver page',
          description: 'A motor driver', markdown: 'x'.repeat(3000),
        }],
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  assert.ok(u.startsWith('https://inference.baseten.co/'),
    'worker fetched an unexpected URL: ' + url);
  assert.strictEqual(opts.headers.Authorization, 'Bearer test-key-123');
  if (basetenMode === 'http500') {
    return new Response('upstream boom', { status: 500 });
  }
  if (basetenMode === 'cutoff') {
    return new Response(JSON.stringify({
      choices: [{ message: { content: '{"spec": {"name": "half' }, finish_reason: 'length' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  const content = basetenMode === 'spec' ? JSON.stringify(GOOD_SPEC)
    : basetenMode === 'fenced' ? '```json\n' + JSON.stringify(GOOD_SPEC) + '\n```'
    : basetenMode === 'chat' ? 'A concise live answer.'
    : basetenMode === 'list' ? JSON.stringify(LIST_REPLY)
    : basetenMode === 'fix' ? JSON.stringify(FIX_REPLY)
    : basetenMode === 'part-chat' ? JSON.stringify(PART_CHAT_REPLY)
    : basetenMode === 'photo' ? JSON.stringify(PHOTO_DRAFT)
    : basetenMode === 'part' ? JSON.stringify(PART_REPLY)
    : basetenMode === 'transcript' ? 'a small indoor rover with four wheels'
    : basetenMode === 'list-bad-draft'
      ? JSON.stringify({ ...LIST_REPLY, draft_spec: { name: 'half a spec' } })
    : 'this is not json at all';
  return new Response(JSON.stringify({
    choices: [{ message: { content } }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const worker = (await import(workerUrl)).default;
const SITE = 'https://abelxmendoza.github.io';

function makeEnv(overrides = {}) {
  return {
    BASETEN_API_KEY: 'test-key-123',
    RF_LIVE_KV: new FakeKV(),
    LIVE_ENABLED: '1',
    DAILY_LIMIT: '200',
    PER_IP_DAILY_LIMIT: '30',
    AUTH_JWT_SECRET: 'mock-jwt-secret-0123456789',
    OPERATOR_TOKEN: 'mock-operator-token',
    ...overrides,
  };
}

/* The model routes are account-gated: scenarios that exercise
 * them pass `auth: true` and the harness registers a throwaway
 * account in that env (once per env) and attaches its session
 * token, the way the signed-in site does. Registration is local
 * to the Worker — it makes no upstream call and spends no model
 * budget, so upstream-call and budget assertions are unaffected. */
const envTokens = new WeakMap();
async function tokenFor(env) {
  if (envTokens.has(env)) return envTokens.get(env);
  const reg = await call(env, '/auth/register', { method: 'POST',
    body: { email: 'gate@example.com', password: 'gate-password-123', name: 'Gate User' } });
  assert.strictEqual(reg.status, 201,
    'gate helper register failed: ' + JSON.stringify(reg.body));
  envTokens.set(env, reg.body.token);
  return reg.body.token;
}

async function call(env, path, { method = 'GET', body, origin = SITE, ip = '203.0.113.7', headers: extraHeaders = {}, auth = false } = {}) {
  const headers = { 'CF-Connecting-IP': ip, ...extraHeaders };
  if (auth) headers.Authorization = 'Bearer ' + await tokenFor(env);
  if (origin) headers.Origin = origin;
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const res = await worker.fetch(
    new Request('https://robotforge-live.example' + path,
      { method, headers, body: payload }), env, {});
  let parsed = null;
  try { parsed = await res.json(); } catch { /* 204s etc. */ }
  return { status: res.status, headers: res.headers, body: parsed };
}

const results = [];
async function scenario(name, fn) {
  try { await fn(); results.push('PASS ' + name); }
  catch (e) { results.push('FAIL ' + name + ': ' + e.message); }
}

await scenario('health answers without a model call', async () => {
  const before = upstreamCalls.length;
  const r = await call(makeEnv(), '/health');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.ok, true);
  assert.strictEqual(r.body.mode, 'live');
  assert.strictEqual(r.body.kv, true);
  assert.strictEqual(r.body.budget.used, 0);
  assert.strictEqual(upstreamCalls.length, before, 'health spent a model call');
});

await scenario('wrong origin is rejected', async () => {
  const r = await call(makeEnv(), '/chat',
    { method: 'POST', body: { message: 'hi' }, origin: 'https://evil.example' });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.body.code, 'origin_rejected');
  assert.notStrictEqual(r.headers.get('Access-Control-Allow-Origin'),
    'https://evil.example');
});

await scenario('allowed origin gets its CORS header', async () => {
  const r = await call(makeEnv(), '/health');
  assert.strictEqual(r.headers.get('Access-Control-Allow-Origin'), SITE);
});

await scenario('describe happy path returns the parsed spec', async () => {
  basetenMode = 'spec';
  const r = await call(makeEnv(), '/describe',
    { method: 'POST', auth: true, body: { description: 'a small differential rover' } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.deepStrictEqual(r.body.spec, GOOD_SPEC);
  assert.strictEqual(r.body.model, 'meta-models/muse-spark-open');
});

await scenario('describe survives a fenced model reply', async () => {
  basetenMode = 'fenced';
  const r = await call(makeEnv(), '/describe',
    { method: 'POST', auth: true, body: { description: 'a rover' } });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body.spec, GOOD_SPEC);
});

await scenario('malformed model output is a 502, never passthrough', async () => {
  basetenMode = 'junk';
  const r = await call(makeEnv(), '/describe',
    { method: 'POST', auth: true, body: { description: 'a rover' } });
  assert.strictEqual(r.status, 502);
  assert.strictEqual(r.body.code, 'bad_model_output');
  assert.ok(!('spec' in r.body));
});

await scenario('chat happy path returns the answer', async () => {
  basetenMode = 'chat';
  const r = await call(makeEnv(), '/chat',
    { method: 'POST', auth: true, body: { message: 'What is RobotForge?' } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.answer, 'A concise live answer.');
});

await scenario('chat with a Workshop snapshot grounds the model in that robot', async () => {
  basetenMode = 'chat';
  const before = upstreamCalls.length;
  const r = await call(makeEnv(), '/chat', {
    method: 'POST', auth: true,
    body: {
      message: 'Why is it failing?',
      ws_context: {
        robot: 'Testbot', version: 'v2 — Baseline', tab: 'Checks',
        spec: ['Body · Drivetrain: differential', 'Battery · Voltage: 11.1 V'],
        checks: { verdict: 'Checks fail', lines: ['FAIL motor voltage 7.4 V is below battery 11.1 V'] },
        inventory: ['TB6612FNG driver'],
      },
    },
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.answer, 'A concise live answer.');
  assert.ok(!('command' in r.body), 'snapshot mode never returns a command');
  const sent = JSON.parse(upstreamCalls[before].opts.body);
  assert.ok(sent.messages[0].content.includes('Answer about THAT robot'),
    'system prompt carries the snapshot instructions');
  assert.ok(sent.messages[1].content.includes('Workshop snapshot:'),
    'user message carries the snapshot block');
  assert.ok(sent.messages[1].content.includes('Testbot'), 'snapshot names the robot');
  assert.ok(sent.messages[1].content.includes('FAIL motor voltage 7.4 V'),
    'snapshot carries the actual check lines');
  assert.ok(sent.messages[1].content.includes('TB6612FNG driver'),
    'snapshot carries the shelf list');
  assert.ok(sent.messages[1].content.includes('Question: Why is it failing?'),
    'the question rides after the snapshot');
});

await scenario('a malformed Workshop snapshot falls back to plain chat', async () => {
  basetenMode = 'chat';
  const before = upstreamCalls.length;
  const r = await call(makeEnv(), '/chat', {
    method: 'POST', auth: true,
    body: { message: 'hello', ws_context: { robot: 42, spec: 'not-a-list' } },
  });
  assert.strictEqual(r.status, 200);
  const sent = JSON.parse(upstreamCalls[before].opts.body);
  assert.strictEqual(sent.messages[1].content, 'hello',
    'no snapshot block reaches the model');
});

await scenario('client cannot override the model settings', async () => {
  basetenMode = 'chat';
  const before = upstreamCalls.length;
  const r = await call(makeEnv(), '/chat', {
    method: 'POST', auth: true,
    body: { message: 'hi', model: 'something-else', temperature: 9, max_tokens: 99999 },
  });
  assert.strictEqual(r.status, 200);
  const sent = JSON.parse(upstreamCalls[before].opts.body);
  assert.strictEqual(sent.model, 'meta-models/muse-spark-open');
  assert.strictEqual(sent.temperature, 0.4);
  assert.strictEqual(sent.max_tokens, 2000);
});

await scenario('budget exhausted is a 503 before any model call', async () => {
  const env = makeEnv({ DAILY_LIMIT: '1' });
  basetenMode = 'chat';
  const ok = await call(env, '/chat', { method: 'POST', auth: true, body: { message: 'one' } });
  assert.strictEqual(ok.status, 200);
  const before = upstreamCalls.length;
  const r = await call(env, '/chat', { method: 'POST', auth: true, body: { message: 'two' } });
  assert.strictEqual(r.status, 503);
  assert.strictEqual(r.body.code, 'budget_exhausted');
  assert.strictEqual(upstreamCalls.length, before, 'over-budget call reached the model');
  const h = await call(env, '/health');
  assert.strictEqual(h.body.budget.exhausted, true);
});

await scenario('per-IP limit is a 429', async () => {
  const env = makeEnv({ PER_IP_DAILY_LIMIT: '1' });
  basetenMode = 'chat';
  const ok = await call(env, '/chat', { method: 'POST', auth: true, body: { message: 'one' } });
  assert.strictEqual(ok.status, 200);
  const r = await call(env, '/chat', { method: 'POST', auth: true, body: { message: 'two' } });
  assert.strictEqual(r.status, 429);
  assert.strictEqual(r.body.code, 'rate_limited');
  const other = await call(env, '/chat',
    { method: 'POST', auth: true, body: { message: 'different visitor' }, ip: '198.51.100.9' });
  assert.strictEqual(other.status, 200);
});

await scenario('kill switch turns live calls away', async () => {
  const env = makeEnv({ LIVE_ENABLED: '0' });
  const r = await call(env, '/chat', { method: 'POST', auth: true, body: { message: 'hi' } });
  assert.strictEqual(r.status, 503);
  assert.strictEqual(r.body.code, 'disabled');
  const h = await call(env, '/health');
  assert.strictEqual(h.body.mode, 'off');
});

await scenario('oversized inputs are rejected before the model', async () => {
  const before = upstreamCalls.length;
  const r = await call(makeEnv(), '/chat',
    { method: 'POST', auth: true, body: { message: 'x'.repeat(2001) } });
  assert.strictEqual(r.status, 413);
  const r2 = await call(makeEnv(), '/describe',
    { method: 'POST', auth: true, body: { description: 'x'.repeat(4001) } });
  assert.strictEqual(r2.status, 413);
  assert.strictEqual(upstreamCalls.length, before);
});

await scenario('missing key is a plain 500, no call attempted', async () => {
  const env = makeEnv();
  delete env.BASETEN_API_KEY;
  const before = upstreamCalls.length;
  const r = await call(env, '/chat', { method: 'POST', auth: true, body: { message: 'hi' } });
  assert.strictEqual(r.status, 500);
  assert.strictEqual(r.body.code, 'not_configured');
  assert.strictEqual(upstreamCalls.length, before);
});

await scenario('unknown route is a 404', async () => {
  const r = await call(makeEnv(), '/nope');
  assert.strictEqual(r.status, 404);
});

await scenario('health reports which routes are configured', async () => {
  const plain = await call(makeEnv(), '/health');
  assert.deepStrictEqual(plain.body.routes,
    { describe: true, chat: true, list: true, fix: true, part_chat: true,
      photo: true, part: true, transcribe: true, web: false, parts: true });
  const noVision = await call(makeEnv({ BASETEN_API_KEY: undefined,
    FIREWORKS_API_KEY: 'fw' }), '/health');
  assert.strictEqual(noVision.body.routes.photo, false);
  assert.strictEqual(noVision.body.routes.transcribe, false);
  const withMeta = await call(makeEnv({ META_API_KEY: 'meta-key-456' }), '/health');
  assert.strictEqual(withMeta.body.routes.photo, true);
  assert.strictEqual(withMeta.body.routes.transcribe, true);
});

await scenario('photo without a Meta or Baseten key is a 501, no call attempted', async () => {
  const before = upstreamCalls.length;
  const r = await call(makeEnv({ BASETEN_API_KEY: undefined }), '/photo', {
    method: 'POST', auth: true,
    body: { image_data_url: 'data:image/jpeg;base64,AAAA' },
  });
  assert.strictEqual(r.status, 501);
  assert.strictEqual(r.body.code, 'photo_not_configured');
  assert.strictEqual(upstreamCalls.length, before);
});

await scenario('photo happy path enforces the ESTIMATED framing', async () => {
  metaMode = 'photo';
  const env = makeEnv({ META_API_KEY: 'meta-key-456' });
  const before = upstreamCalls.length;
  const r = await call(env, '/photo', {
    method: 'POST', auth: true,
    body: { image_data_url: 'data:image/jpeg;base64,AAAA', note: 'my rover' },
  });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.estimated, true);
  assert.strictEqual(r.body.model, 'muse-spark-1.3');
  assert.strictEqual(r.body.draft.identity_guess, 'TurtleBot 3 Waffle Pi');
  assert.strictEqual(r.body.draft.visible_parts.length, 2);
  assert.ok(r.body.draft.spec.description
    .startsWith('Photo draft (all dimensions ESTIMATED): '),
    'ESTIMATED prefix was not enforced: ' + r.body.draft.spec.description);
  const sent = JSON.parse(upstreamCalls[before].opts.body);
  assert.strictEqual(sent.model, 'muse-spark-1.3');
  const userParts = sent.messages[1].content;
  assert.strictEqual(userParts[1].image_url.url, 'data:image/jpeg;base64,AAAA');
});

await scenario('photo malformed model output is a 502', async () => {
  metaMode = 'junk';
  const r = await call(makeEnv({ META_API_KEY: 'meta-key-456' }), '/photo', {
    method: 'POST', auth: true,
    body: { image_data_url: 'data:image/png;base64,AAAA' },
  });
  assert.strictEqual(r.status, 502);
  assert.strictEqual(r.body.code, 'bad_model_output');
  metaMode = 'photo';
});

await scenario('document mode transcribes, prefixes and drops unbacked numbers', async () => {
  metaMode = 'document';
  const env = makeEnv({ META_API_KEY: 'meta-key-456' });
  const before = upstreamCalls.length;
  const r = await call(env, '/photo', {
    method: 'POST', auth: true,
    body: { image_data_url: 'data:image/png;base64,AAAA', mode: 'document' },
  });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.document_read, true);
  assert.strictEqual(r.body.estimated, false);
  assert.strictEqual(r.body.draft.identity_guess, 'TurtleBot3 Burger');
  assert.strictEqual(r.body.draft.spec.length_m, 0.178);
  assert.ok(!('mass_kg' in r.body.draft.spec),
    'an unbacked number must be dropped, got: ' +
    JSON.stringify(r.body.draft.spec));
  assert.deepStrictEqual(r.body.draft.dropped, ['mass_kg']);
  assert.ok(r.body.draft.spec.description.startsWith(
    'Document draft (values transcribed from the document): '),
    'DOCUMENT prefix was not enforced: ' + r.body.draft.spec.description);
  assert.strictEqual(r.body.draft.values.length, 3);
  const sent = JSON.parse(upstreamCalls[before].opts.body);
  assert.ok(sent.messages[0].content.includes('drawing scale'),
    'the document prompt must carry the no-inference rule');
  assert.ok(sent.messages[0].content.includes('DOCUMENT'),
    'the document system prompt must be used in document mode');
  metaMode = 'photo';
});

await scenario('document mode rejects a mistyped printed value', async () => {
  metaMode = 'document-bad';
  const r = await call(makeEnv({ META_API_KEY: 'meta-key-456' }), '/photo', {
    method: 'POST', auth: true,
    body: { image_data_url: 'data:image/png;base64,AAAA', mode: 'document' },
  });
  assert.strictEqual(r.status, 502);
  assert.strictEqual(r.body.code, 'bad_model_output');
  metaMode = 'photo';
});

await scenario('photo counts against the same daily budget', async () => {
  const env = makeEnv({ META_API_KEY: 'meta-key-456', DAILY_LIMIT: '1' });
  basetenMode = 'chat';
  const ok = await call(env, '/chat', { method: 'POST', auth: true, body: { message: 'one' } });
  assert.strictEqual(ok.status, 200);
  const r = await call(env, '/photo', {
    method: 'POST', auth: true,
    body: { image_data_url: 'data:image/jpeg;base64,AAAA' },
  });
  assert.strictEqual(r.status, 503);
  assert.strictEqual(r.body.code, 'budget_exhausted');
});

await scenario('list happy path sanitizes invented catalogue ids', async () => {
  basetenMode = 'list';
  const r = await call(makeEnv(), '/list', {
    method: 'POST', auth: true,
    body: { text: 'LiPo battery 4S 5200 mAh\nMystery gadget 3000' },
  });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.model_generated, true);
  assert.strictEqual(r.body.import.items[0].matched_part_id, 'lipo_4s_5200');
  assert.strictEqual(r.body.import.items[1].matched_part_id, null,
    'an id the catalogue does not have must become null');
  assert.deepStrictEqual(r.body.import.draft_spec, GOOD_SPEC);
  assert.strictEqual(r.body.draft_note, null);
});

await scenario('list drops an invalid draft spec with a note', async () => {
  basetenMode = 'list-bad-draft';
  const r = await call(makeEnv(), '/list', {
    method: 'POST', auth: true, body: { text: 'LiPo battery 4S 5200 mAh' },
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.import.draft_spec, null);
  assert.ok(r.body.draft_note && r.body.draft_note.includes('dropped'));
});

await scenario('list malformed model output is a 502', async () => {
  basetenMode = 'junk';
  const r = await call(makeEnv(), '/list', {
    method: 'POST', auth: true, body: { text: 'some parts' },
  });
  assert.strictEqual(r.status, 502);
  assert.strictEqual(r.body.code, 'bad_model_output');
});

await scenario('the Vercel site origin is allowed', async () => {
  const origin = 'https://robot-forge-hackathon.vercel.app';
  const r = await call(makeEnv(), '/health', { origin });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers.get('Access-Control-Allow-Origin'), origin);
});

await scenario('fix keeps only allowed, well-typed changes', async () => {
  basetenMode = 'fix';
  const r = await call(makeEnv(), '/fix', { method: 'POST', auth: true, body: {
    spec: GOOD_SPEC, findings: ['[ERROR] geometry.clearance_vs_wheel: too high'] } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.deepStrictEqual(r.body.changes.map(c => c.path), ['ground_clearance_m']);
  assert.strictEqual(r.body.changes[0].before, 0.03);
  assert.strictEqual(r.body.changes[0].value, 0.04);
  assert.ok(r.body.summary);
});

await scenario('fix without findings is a 400', async () => {
  const r = await call(makeEnv(), '/fix', { method: 'POST', auth: true, body: { spec: GOOD_SPEC, findings: [] } });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.body.code, 'missing_findings');
});

await scenario('fix malformed model output is a 502', async () => {
  basetenMode = 'junk';
  const r = await call(makeEnv(), '/fix', { method: 'POST', auth: true, body: {
    spec: GOOD_SPEC, findings: ['[ERROR] x: y'] } });
  assert.strictEqual(r.status, 502);
  assert.strictEqual(r.body.code, 'bad_model_output');
});

await scenario('part without a Meta or Baseten key is a 501', async () => {
  const r = await call(makeEnv({ BASETEN_API_KEY: undefined }), '/part', { method: 'POST', auth: true,
    body: { image_data_url: 'data:image/jpeg;base64,AAAA' } });
  assert.strictEqual(r.status, 501);
});

await scenario('part identifies and sanitizes', async () => {
  metaMode = 'part';
  const r = await call(makeEnv({ META_API_KEY: 'meta-key-456' }), '/part', { method: 'POST', auth: true,
    body: { image_data_url: 'data:image/jpeg;base64,AAAA', note: 'from my shelf' } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.part.catalog_part_id, 'lipo_4s_5200');
  assert.ok(!('secret_field' in r.body.part.specs));
  assert.deepStrictEqual(r.body.part.read_from_label, ['voltage_v', 'capacity_mah']);
  assert.strictEqual(r.body.part.confidence, 'high');
});

await scenario('part-chat returns a sanitized update', async () => {
  basetenMode = 'part-chat';
  const r = await call(makeEnv(), '/part-chat', { method: 'POST', auth: true, body: {
    part: { name: 'motor?' }, message: 'it is a 37mm 12V gearmotor',
    history: [{ role: 'assistant', text: 'What voltage is it?' }] } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.confirmed, true);
  assert.strictEqual(r.body.update.category, 'motor');
  assert.ok(!('category_bogus' in r.body.update));
});

await scenario('part-chat plain-text reply changes nothing', async () => {
  basetenMode = 'chat';
  const r = await call(makeEnv(), '/part-chat', { method: 'POST', auth: true, body: {
    part: {}, message: 'what is this?' } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.update, null);
  assert.strictEqual(r.body.confirmed, false);
});

await scenario('Meta direct answers when Baseten fails, and says so', async () => {
  basetenMode = 'http500'; metaMode = 'spec';
  const env = makeEnv({ META_API_KEY: 'meta-key-456' });
  const before = upstreamCalls.length;
  const r = await call(env, '/describe',
    { method: 'POST', auth: true, body: { description: 'a small rover' } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.model, 'muse-spark-1.3');
  const hosts = upstreamCalls.slice(before).map(c => new URL(c.url).host);
  assert.deepStrictEqual(hosts, ['inference.baseten.co', 'api.meta.ai']);
});

await scenario('a pinned provider is the only one attempted', async () => {
  basetenMode = 'chat'; metaMode = 'chat';
  const env = makeEnv({ META_API_KEY: 'meta-key-456' });
  const before = upstreamCalls.length;
  const r = await call(env, '/chat', { method: 'POST', auth: true,
    body: { message: 'hi', provider: 'meta' } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.answer, 'A concise Meta answer.');
  assert.strictEqual(r.body.model, 'muse-spark-1.3');
  const calls = upstreamCalls.slice(before);
  assert.strictEqual(calls.length, 1);
  assert.ok(calls[0].url.startsWith('https://api.meta.ai/'));
});

await scenario('pinning an unconfigured provider fails honestly', async () => {
  basetenMode = 'chat';
  const r = await call(makeEnv(), '/chat', { method: 'POST', auth: true,
    body: { message: 'hi', provider: 'meta' } });
  assert.strictEqual(r.status, 502);
  assert.strictEqual(r.body.code, 'upstream_error');
});

await scenario('transcribe happy path returns the transcript', async () => {
  const env = makeEnv({ META_API_KEY: 'meta-key-456' });
  const wav = new Uint8Array(48);
  wav.set([0x52, 0x49, 0x46, 0x46], 0); // 'RIFF'
  wav.set([0x57, 0x41, 0x56, 0x45], 8); // 'WAVE'
  const r = await call(env, '/transcribe', { method: 'POST', auth: true,
    body: { audio_b64: Buffer.from(wav).toString('base64') } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.transcript, 'a small indoor rover with four wheels');
  assert.strictEqual(r.body.model, 'muse-voice-transcribe-1.0');
  assert.strictEqual(r.body.audio_duration_ms, 3000);
});

await scenario('transcribe without a Meta or Baseten key is a 501', async () => {
  const before = upstreamCalls.length;
  const r = await call(makeEnv({ BASETEN_API_KEY: undefined }), '/transcribe', { method: 'POST', auth: true,
    body: { audio_b64: 'UklGRg==' } });
  assert.strictEqual(r.status, 501);
  assert.strictEqual(r.body.code, 'transcribe_not_configured');
  assert.strictEqual(upstreamCalls.length, before);
});

await scenario('photo falls back to Baseten when Meta fails, and says so', async () => {
  metaMode = 'http500'; basetenMode = 'photo';
  const env = makeEnv({ META_API_KEY: 'meta-key-456' });
  const before = upstreamCalls.length;
  const r = await call(env, '/photo', { method: 'POST', auth: true,
    body: { image_data_url: 'data:image/jpeg;base64,AAAA' } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.model, 'meta-models/muse-spark-open');
  assert.strictEqual(r.body.estimated, true);
  const sent = JSON.parse(upstreamCalls[upstreamCalls.length - 1].opts.body);
  assert.ok(upstreamCalls[upstreamCalls.length - 1].url.startsWith('https://inference.baseten.co/'));
  assert.strictEqual(sent.messages[1].content[1].image_url.url, 'data:image/jpeg;base64,AAAA');
  assert.strictEqual(upstreamCalls.length - before, 2);
  metaMode = 'photo';
});

await scenario('photo with only the Baseten key goes straight to Baseten', async () => {
  basetenMode = 'photo';
  const r = await call(makeEnv(), '/photo', { method: 'POST', auth: true,
    body: { image_data_url: 'data:image/jpeg;base64,AAAA' } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.model, 'meta-models/muse-spark-open');
});

await scenario('part photo falls back to Baseten when Meta fails', async () => {
  metaMode = 'http500'; basetenMode = 'part';
  const r = await call(makeEnv({ META_API_KEY: 'meta-key-456' }), '/part', {
    method: 'POST', auth: true,
    body: { image_data_url: 'data:image/jpeg;base64,AAAA' } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.model, 'meta-models/muse-spark-open');
  assert.strictEqual(r.body.part.name, '4S LiPo 5200 mAh');
  metaMode = 'photo';
});

await scenario('transcribe falls back to Baseten audio when Meta fails', async () => {
  metaMode = 'http500'; basetenMode = 'transcript';
  const wav = new Uint8Array(48);
  wav.set([0x52, 0x49, 0x46, 0x46], 0);
  wav.set([0x57, 0x41, 0x56, 0x45], 8);
  const b64 = Buffer.from(wav).toString('base64');
  const r = await call(makeEnv({ META_API_KEY: 'meta-key-456' }), '/transcribe', {
    method: 'POST', auth: true, body: { audio_b64: b64 } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.transcript, 'a small indoor rover with four wheels');
  assert.strictEqual(r.body.model, 'meta-models/muse-spark-open');
  const sent = JSON.parse(upstreamCalls[upstreamCalls.length - 1].opts.body);
  assert.strictEqual(sent.messages[1].content[1].type, 'audio_url');
  assert.strictEqual(sent.messages[1].content[1].audio_url.url, 'data:audio/wav;base64,' + b64);
  metaMode = 'photo';
});

await scenario('a reply cut off at the length limit fails over to the next provider', async () => {
  basetenMode = 'cutoff'; metaMode = 'chat';
  const r = await call(makeEnv({ META_API_KEY: 'meta-key-456' }), '/chat', {
    method: 'POST', auth: true, body: { message: 'hi' } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.model, 'muse-spark-1.3');
  metaMode = 'photo'; basetenMode = 'chat';
});

/* ---------------- Firecrawl web (/web) ---------------- */

await scenario('web without the Firecrawl key is a 501, no call attempted', async () => {
  const before = upstreamCalls.length;
  const r = await call(makeEnv(), '/web', { method: 'POST', auth: true,
    body: { mode: 'scrape', url: 'https://example.com/page' } });
  assert.strictEqual(r.status, 501);
  assert.strictEqual(r.body.code, 'firecrawl_not_configured');
  assert.strictEqual(upstreamCalls.length, before);
});

await scenario('web requires an account (401 anonymous, no call)', async () => {
  const before = upstreamCalls.length;
const fcEnv = makeEnv({ FIRECRAWL_API_KEY: 'test-key-456' });
  const r = await call(fcEnv, '/web', { method: 'POST',
    body: { mode: 'search', query: 'motor driver' } });
  assert.strictEqual(r.status, 401);
  assert.strictEqual(upstreamCalls.length, before);
});

await scenario('web scrape returns bounded markdown with its source', async () => {
  firecrawlMode = 'ok';
const fcEnv = makeEnv({ FIRECRAWL_API_KEY: 'test-key-456' });
  const r = await call(fcEnv, '/web', { method: 'POST', auth: true,
    body: { mode: 'scrape', url: 'https://example.com/tb6612' } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.url, 'https://example.com/tb6612');
  assert.strictEqual(r.body.title, 'TB6612FNG breakout');
  assert.ok(r.body.markdown.includes('TB6612FNG'));
  assert.strictEqual(r.body.truncated, false);
});

await scenario('web scrape rejects non-public URLs', async () => {
const fcEnv = makeEnv({ FIRECRAWL_API_KEY: 'test-key-456' });
  for (const url of ['http://localhost:3000/x', 'http://192.168.1.5/x',
      'ftp://example.com/x', 'https://user:pass@example.com/x',
      'not a url']) {
    const r = await call(fcEnv, '/web', { method: 'POST', auth: true,
      body: { mode: 'scrape', url } });
    assert.strictEqual(r.status, 400, url);
    assert.strictEqual(r.body.code, 'bad_url', url);
  }
});

await scenario('web search maps and caps results', async () => {
  firecrawlMode = 'ok';
const fcEnv = makeEnv({ FIRECRAWL_API_KEY: 'test-key-456' });
  const r = await call(fcEnv, '/web', { method: 'POST', auth: true,
    body: { mode: 'search', query: 'tb6612 driver', limit: 99 } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.results.length, 1);
  assert.strictEqual(r.body.results[0].url, 'https://example.com/driver');
  assert.strictEqual(r.body.results[0].markdown.length, 2000);
});

await scenario('web upstream failure is a plain 502', async () => {
  firecrawlMode = 'http500';
const fcEnv = makeEnv({ FIRECRAWL_API_KEY: 'test-key-456' });
  const r = await call(fcEnv, '/web', { method: 'POST', auth: true,
    body: { mode: 'scrape', url: 'https://example.com/x' } });
  assert.strictEqual(r.status, 502);
  assert.strictEqual(r.body.code, 'upstream_error');
  firecrawlMode = 'ok';
});

await scenario('chat carries web_context as labelled untrusted data', async () => {
  basetenMode = 'chat';
  const before = upstreamCalls.length;
  const r = await call(makeEnv(), '/chat', { method: 'POST', auth: true,
    body: { message: 'what does this page say?',
      web_context: 'Web content (UNTRUSTED external data):\nSource: https://example.com/x\n\nPage body' } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const callToModel = upstreamCalls.slice(before)
    .find((c) => String(c.url).includes('baseten'));
  assert.ok(callToModel, 'model was called');
  const payload = JSON.parse(callToModel.opts.body);
  const system = payload.messages[0].content;
  const user = payload.messages[1].content;
  assert.ok(system.includes('UNTRUSTED external data'), 'system labels web content untrusted');
  assert.ok(user.includes('Source: https://example.com/x'), 'user block keeps its source');
  assert.ok(user.includes('Question: what does this page say?'));
});

await scenario('transcribe rejects non-WAV audio', async () => {
  const env = makeEnv({ META_API_KEY: 'meta-key-456' });
  const r = await call(env, '/transcribe', { method: 'POST', auth: true,
    body: { audio_b64: Buffer.from('not a wav file at all........').toString('base64') } });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.body.code, 'bad_audio');
});

/* ---------------- accounts ---------------- */

await scenario('health reports auth on and meta login off', async () => {
  const r = await call(makeEnv(), '/health');
  assert.strictEqual(r.body.auth, true);
  assert.strictEqual(r.body.metaLogin, false);
  const c = await call(makeEnv(), '/auth/config');
  assert.deepStrictEqual(c.body, { metaLogin: false,
    providers: { meta: false, github: false, google: false } });
});

await scenario('auth register then login then me', async () => {
  const env = makeEnv();
  const reg = await call(env, '/auth/register', { method: 'POST',
    body: { email: 'Pat@Example.com', password: 'hunter2-hunter2', name: 'Pat' } });
  assert.strictEqual(reg.status, 201, JSON.stringify(reg.body));
  assert.strictEqual(reg.body.user.email, 'pat@example.com');
  assert.strictEqual(reg.body.user.role, 'user');
  assert.ok(reg.body.token.split('.').length === 3, 'session token is a JWT');
  assert.ok(!JSON.stringify(reg.body).includes('passHash'), 'hash leaked in register reply');
  const me = await call(env, '/auth/me',
    { headers: { Authorization: 'Bearer ' + reg.body.token } });
  assert.strictEqual(me.status, 200);
  assert.strictEqual(me.body.user.name, 'Pat');
  const login = await call(env, '/auth/login', { method: 'POST',
    body: { email: 'pat@example.com', password: 'hunter2-hunter2' } });
  assert.strictEqual(login.status, 200);
  assert.strictEqual(login.body.user.email, 'pat@example.com');
  const out = await call(env, '/auth/logout', { method: 'POST' });
  assert.strictEqual(out.status, 200);
});

await scenario('auth duplicate register is a 409', async () => {
  const env = makeEnv();
  const body = { email: 'dup@example.com', password: 'password-123' };
  const first = await call(env, '/auth/register', { method: 'POST', body });
  assert.strictEqual(first.status, 201);
  const second = await call(env, '/auth/register', { method: 'POST', body });
  assert.strictEqual(second.status, 409);
  assert.strictEqual(second.body.code, 'already_registered');
});

await scenario('auth wrong password and unknown email are a generic 401', async () => {
  const env = makeEnv();
  await call(env, '/auth/register', { method: 'POST',
    body: { email: 'sam@example.com', password: 'password-123' } });
  const wrong = await call(env, '/auth/login', { method: 'POST',
    body: { email: 'sam@example.com', password: 'password-999' } });
  assert.strictEqual(wrong.status, 401);
  assert.strictEqual(wrong.body.code, 'bad_credentials');
  const ghost = await call(env, '/auth/login', { method: 'POST',
    body: { email: 'ghost@example.com', password: 'password-123' } });
  assert.strictEqual(ghost.status, 401);
  assert.strictEqual(ghost.body.error, wrong.body.error, 'login errors must not say which part failed');
});

await scenario('auth validation rejects bad email and short password', async () => {
  const env = makeEnv();
  const badEmail = await call(env, '/auth/register', { method: 'POST',
    body: { email: 'not-an-email', password: 'password-123' } });
  assert.strictEqual(badEmail.status, 400);
  assert.strictEqual(badEmail.body.code, 'bad_email');
  const short = await call(env, '/auth/register', { method: 'POST',
    body: { email: 'ok@example.com', password: 'short' } });
  assert.strictEqual(short.status, 400);
  assert.strictEqual(short.body.code, 'weak_password');
});

await scenario('auth founder email is reserved on the public route', async () => {
  const r = await call(makeEnv(), '/auth/register', { method: 'POST',
    body: { email: 'AbelXMendoza@gmail.com', password: 'password-123' } });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.body.code, 'reserved_email');
});

await scenario('auth me rejects missing and tampered tokens', async () => {
  const env = makeEnv();
  const none = await call(env, '/auth/me');
  assert.strictEqual(none.status, 401);
  const reg = await call(env, '/auth/register', { method: 'POST',
    body: { email: 'tam@example.com', password: 'password-123' } });
  const parts = reg.body.token.split('.');
  const tampered = parts[0] + '.' + parts[1] + '.' +
    (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
  const bad = await call(env, '/auth/me',
    { headers: { Authorization: 'Bearer ' + tampered } });
  assert.strictEqual(bad.status, 401);
  const forged = await call(env, '/auth/me',
    { headers: { Authorization: 'Bearer not-a-jwt' } });
  assert.strictEqual(forged.status, 401);
});

await scenario('auth operator routes need the operator token', async () => {
  const env = makeEnv();
  const noToken = await call(env, '/admin/users');
  assert.strictEqual(noToken.status, 401);
  const wrong = await call(env, '/admin/users',
    { headers: { 'X-Operator-Token': 'nope' } });
  assert.strictEqual(wrong.status, 401);
  const seedNoToken = await call(env, '/admin/seed-founder', { method: 'POST',
    body: { password: 'founder-pass-123' } });
  assert.strictEqual(seedNoToken.status, 401);
});

await scenario('auth seed founder then founder login works', async () => {
  const env = makeEnv();
  const op = { headers: { 'X-Operator-Token': 'mock-operator-token' } };
  const seed = await call(env, '/admin/seed-founder', { method: 'POST',
    body: { password: 'founder-pass-123' }, ...op });
  assert.strictEqual(seed.status, 200, JSON.stringify(seed.body));
  assert.strictEqual(seed.body.user.role, 'founder');
  assert.strictEqual(seed.body.user.email, 'abelxmendoza@gmail.com');
  const login = await call(env, '/auth/login', { method: 'POST',
    body: { email: 'abelxmendoza@gmail.com', password: 'founder-pass-123' } });
  assert.strictEqual(login.status, 200);
  assert.strictEqual(login.body.user.role, 'founder');
  const me = await call(env, '/auth/me',
    { headers: { Authorization: 'Bearer ' + login.body.token } });
  assert.strictEqual(me.body.user.role, 'founder');
});

await scenario('auth admin users lists public fields only', async () => {
  const env = makeEnv();
  const op = { headers: { 'X-Operator-Token': 'mock-operator-token' } };
  await call(env, '/auth/register', { method: 'POST',
    body: { email: 'lee@example.com', password: 'password-123', name: 'Lee' } });
  await call(env, '/admin/seed-founder', { method: 'POST',
    body: { password: 'founder-pass-123' }, ...op });
  const r = await call(env, '/admin/users', { ...op });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.count, 2);
  assert.deepStrictEqual(r.body.users.map(u => u.email),
    ['abelxmendoza@gmail.com', 'lee@example.com']);
  assert.ok(!JSON.stringify(r.body).includes('passHash'), 'hash leaked via /admin/users');
  assert.ok(!JSON.stringify(r.body).includes('pbkdf2'), 'hash leaked via /admin/users');
});

await scenario('auth grant role promotes and me reflects it at once', async () => {
  const env = makeEnv();
  const op = { headers: { 'X-Operator-Token': 'mock-operator-token' } };
  const reg = await call(env, '/auth/register', { method: 'POST',
    body: { email: 'mod@example.com', password: 'password-123' } });
  const grant = await call(env, '/admin/grant-role', { method: 'POST',
    body: { email: 'mod@example.com', role: 'admin' }, ...op });
  assert.strictEqual(grant.status, 200);
  assert.strictEqual(grant.body.user.role, 'admin');
  /* The pre-grant token still works, and /me reads the fresh role. */
  const me = await call(env, '/auth/me',
    { headers: { Authorization: 'Bearer ' + reg.body.token } });
  assert.strictEqual(me.body.user.role, 'admin');
  const bogus = await call(env, '/admin/grant-role', { method: 'POST',
    body: { email: 'mod@example.com', role: 'superuser' }, ...op });
  assert.strictEqual(bogus.status, 400);
  const ghost = await call(env, '/admin/grant-role', { method: 'POST',
    body: { email: 'ghost@example.com', role: 'admin' }, ...op });
  assert.strictEqual(ghost.status, 404);
});

await scenario('auth meta routes are a 501 while unconfigured', async () => {
  const env = makeEnv();
  const start = await call(env, '/auth/meta/start');
  assert.strictEqual(start.status, 501);
  assert.strictEqual(start.body.code, 'meta_not_configured');
  const cb = await call(env, '/auth/meta/callback?code=x&state=y');
  assert.strictEqual(cb.status, 501);
});

/* Run one provider's start -> callback dance against the stubbed
 * upstreams and hand back both responses. */
async function oauthDance(env, provider) {
  const start = await call(env, `/auth/${provider}/start`);
  assert.strictEqual(start.status, 302, provider + ' start should redirect');
  const loc = start.headers.get('Location') || '';
  const state = new URL(loc).searchParams.get('state');
  assert.ok(state, provider + ' start mints a state nonce');
  const cb = await call(env,
    `/auth/${provider}/callback?code=mock-code&state=${encodeURIComponent(state)}`);
  assert.strictEqual(cb.status, 302, provider + ' callback should redirect');
  return { loc, cb };
}

function fragmentToken(res) {
  const m = (res.headers.get('Location') || '').match(/#auth=([^&]+)/);
  return m ? m[1] : null;
}

await scenario('auth config reports providers on when their secrets exist', async () => {
  const env = makeEnv({
    META_APP_ID: 'm-id', META_APP_SECRET: 'm-secret',
    GITHUB_CLIENT_ID: 'gh-id', GITHUB_CLIENT_SECRET: 'gh-secret',
    GOOGLE_CLIENT_ID: 'g-id', GOOGLE_CLIENT_SECRET: 'g-secret',
  });
  const c = await call(env, '/auth/config');
  assert.deepStrictEqual(c.body, { metaLogin: true,
    providers: { meta: true, github: true, google: true } });
  const h = await call(env, '/health');
  assert.strictEqual(h.body.metaLogin, true);
  assert.strictEqual(h.body.githubLogin, true);
  assert.strictEqual(h.body.googleLogin, true);
});

await scenario('auth github and google routes are a 501 while unconfigured', async () => {
  const env = makeEnv();
  for (const [provider, code] of [['github', 'github_not_configured'],
                                  ['google', 'google_not_configured']]) {
    const start = await call(env, `/auth/${provider}/start`);
    assert.strictEqual(start.status, 501);
    assert.strictEqual(start.body.code, code);
    const cb = await call(env, `/auth/${provider}/callback?code=x&state=y`);
    assert.strictEqual(cb.status, 501);
  }
});

await scenario('auth meta login happy path still works', async () => {
  const env = makeEnv({ META_APP_ID: 'm-id', META_APP_SECRET: 'm-secret' });
  const { loc, cb } = await oauthDance(env, 'meta');
  assert.ok(loc.startsWith('https://www.facebook.com/dialog/oauth'), loc);
  const token = fragmentToken(cb);
  assert.ok(token, 'callback returns a session in the fragment');
  const me = await call(env, '/auth/me',
    { headers: { Authorization: 'Bearer ' + token } });
  assert.strictEqual(me.body.user.email, 'fran@example.com');
  assert.strictEqual(me.body.user.provider, 'meta');
  assert.strictEqual(me.body.user.providerId, 'fb-777');
});

await scenario('auth github login happy path', async () => {
  githubMode = 'ok';
  const env = makeEnv({ GITHUB_CLIENT_ID: 'gh-id', GITHUB_CLIENT_SECRET: 'gh-secret' });
  const { loc, cb } = await oauthDance(env, 'github');
  assert.ok(loc.startsWith('https://github.com/login/oauth/authorize'), loc);
  assert.ok(loc.includes('scope=read%3Auser+user%3Aemail'), loc);
  const token = fragmentToken(cb);
  assert.ok(token, 'callback returns a session in the fragment');
  const me = await call(env, '/auth/me',
    { headers: { Authorization: 'Bearer ' + token } });
  assert.strictEqual(me.status, 200);
  /* The account keys on the primary VERIFIED email from
   * /user/emails — not the public profile address, and not the
   * verified-but-secondary one. */
  assert.strictEqual(me.body.user.email, 'octo@example.com');
  assert.strictEqual(me.body.user.provider, 'github');
  assert.strictEqual(me.body.user.providerId, '4242');
  assert.strictEqual(me.body.user.name, 'Octo Dev');
});

await scenario('auth github login works with a hidden profile email', async () => {
  githubMode = 'hidden';
  const env = makeEnv({ GITHUB_CLIENT_ID: 'gh-id', GITHUB_CLIENT_SECRET: 'gh-secret' });
  const { cb } = await oauthDance(env, 'github');
  const token = fragmentToken(cb);
  assert.ok(token, 'hidden profile email still signs in via /user/emails');
  const me = await call(env, '/auth/me',
    { headers: { Authorization: 'Bearer ' + token } });
  assert.strictEqual(me.body.user.email, 'octo@example.com');
  githubMode = 'ok';
});

await scenario('auth github login fails without a verified primary email', async () => {
  githubMode = 'unverified';
  const env = makeEnv({ GITHUB_CLIENT_ID: 'gh-id', GITHUB_CLIENT_SECRET: 'gh-secret' });
  const { cb } = await oauthDance(env, 'github');
  const loc = cb.headers.get('Location') || '';
  assert.ok(loc.includes('#auth_error=github_login_failed'), loc);
  const users = await call(env, '/admin/users',
    { headers: { 'X-Operator-Token': 'mock-operator-token' } });
  assert.strictEqual(users.body.count, 0,
    'no account may be created from an unverified email');
  githubMode = 'ok';
});

await scenario('auth google login happy path', async () => {
  googleMode = 'ok';
  const env = makeEnv({ GOOGLE_CLIENT_ID: 'g-id', GOOGLE_CLIENT_SECRET: 'g-secret' });
  const { loc, cb } = await oauthDance(env, 'google');
  assert.ok(loc.startsWith('https://accounts.google.com/o/oauth2/v2/auth'), loc);
  const token = fragmentToken(cb);
  assert.ok(token, 'callback returns a session in the fragment');
  const me = await call(env, '/auth/me',
    { headers: { Authorization: 'Bearer ' + token } });
  assert.strictEqual(me.body.user.email, 'gina@example.com');
  assert.strictEqual(me.body.user.provider, 'google');
  assert.strictEqual(me.body.user.providerId, 'g-123');
});

await scenario('auth google login fails when the email is unverified', async () => {
  googleMode = 'unverified';
  const env = makeEnv({ GOOGLE_CLIENT_ID: 'g-id', GOOGLE_CLIENT_SECRET: 'g-secret' });
  const { cb } = await oauthDance(env, 'google');
  const loc = cb.headers.get('Location') || '';
  assert.ok(loc.includes('#auth_error=google_login_failed'), loc);
  const users = await call(env, '/admin/users',
    { headers: { 'X-Operator-Token': 'mock-operator-token' } });
  assert.strictEqual(users.body.count, 0,
    'no account may be created from an unverified email');
  googleMode = 'ok';
});

await scenario('auth oauth same email lands in the existing account', async () => {
  googleMode = 'ok';
  const env = makeEnv({ GOOGLE_CLIENT_ID: 'g-id', GOOGLE_CLIENT_SECRET: 'g-secret' });
  const reg = await call(env, '/auth/register', { method: 'POST',
    body: { email: 'gina@example.com', password: 'password-123', name: 'Gina Password' } });
  assert.strictEqual(reg.status, 201);
  const { cb } = await oauthDance(env, 'google');
  const token = fragmentToken(cb);
  assert.ok(token);
  const me = await call(env, '/auth/me',
    { headers: { Authorization: 'Bearer ' + token } });
  /* First channel wins: the record stays the password account and
   * the social login signs into it rather than duplicating it. */
  assert.strictEqual(me.body.user.provider, 'password');
  assert.strictEqual(me.body.user.name, 'Gina Password');
  const users = await call(env, '/admin/users',
    { headers: { 'X-Operator-Token': 'mock-operator-token' } });
  assert.strictEqual(users.body.count, 1);
});

await scenario('auth is a 503 when the JWT secret is missing', async () => {
  const env = makeEnv();
  delete env.AUTH_JWT_SECRET;
  const r = await call(env, '/auth/register', { method: 'POST',
    body: { email: 'a@example.com', password: 'password-123' } });
  assert.strictEqual(r.status, 503);
  assert.strictEqual(r.body.code, 'auth_not_configured');
  const h = await call(env, '/health');
  assert.strictEqual(h.body.auth, false);
});

/* ---------------- the account gate on the model routes -------- */

await scenario('live routes refuse anonymous callers with a 401', async () => {
  const env = makeEnv({ META_API_KEY: 'meta-key-456' });
  const before = upstreamCalls.length;
  const attempts = [
    ['/describe', { description: 'a rover' }],
    ['/chat', { message: 'hi' }],
    ['/list', { text: 'a battery' }],
    ['/photo', { image_data_url: 'data:image/jpeg;base64,AAAA' }],
    ['/fix', { spec: GOOD_SPEC, findings: ['[ERROR] x: y'] }],
    ['/part', { image_data_url: 'data:image/jpeg;base64,AAAA' }],
    ['/part-chat', { part: {}, message: 'what is this?' }],
    ['/transcribe', { audio_b64: 'UklGRg==' }],
  ];
  for (const [path, body] of attempts) {
    const r = await call(env, path, { method: 'POST', body });
    assert.strictEqual(r.status, 401, path + ' answered ' + r.status);
    assert.strictEqual(r.body.code, 'auth_required', path);
  }
  assert.strictEqual(upstreamCalls.length, before,
    'an anonymous call reached a model upstream');
  const h = await call(env, '/health');
  assert.strictEqual(h.body.budget.used, 0,
    'anonymous calls must not spend the daily budget');
});

await scenario('live routes pass with a valid account token', async () => {
  const env = makeEnv();
  basetenMode = 'spec';
  const r = await call(env, '/describe', { method: 'POST', auth: true,
    body: { description: 'a small differential rover' } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.deepStrictEqual(r.body.spec, GOOD_SPEC);
  basetenMode = 'chat';
  const c = await call(env, '/chat', { method: 'POST', auth: true,
    body: { message: 'What is RobotForge?' } });
  assert.strictEqual(c.status, 200);
  assert.strictEqual(c.body.answer, 'A concise live answer.');
});

await scenario('live routes refuse a tampered account token', async () => {
  const env = makeEnv();
  const token = await tokenFor(env);
  const parts = token.split('.');
  const tampered = parts[0] + '.' + parts[1] + '.' +
    (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
  const before = upstreamCalls.length;
  const r = await call(env, '/describe', { method: 'POST',
    headers: { Authorization: 'Bearer ' + tampered },
    body: { description: 'a rover' } });
  assert.strictEqual(r.status, 401);
  assert.strictEqual(r.body.code, 'auth_required');
  assert.strictEqual(upstreamCalls.length, before);
});

await scenario('health, login and operator routes are not session-gated', async () => {
  const env = makeEnv();
  const h = await call(env, '/health');
  assert.strictEqual(h.status, 200);
  await call(env, '/auth/register', { method: 'POST',
    body: { email: 'pub@example.com', password: 'password-123' } });
  const login = await call(env, '/auth/login', { method: 'POST',
    body: { email: 'pub@example.com', password: 'password-123' } });
  assert.strictEqual(login.status, 200, 'login must stay public');
  /* The operator gate is unchanged: a session token is not an
   * operator token, and the operator token needs no session. */
  const asUser = await call(env, '/admin/users',
    { headers: { Authorization: 'Bearer ' + login.body.token } });
  assert.strictEqual(asUser.status, 401);
  const asOperator = await call(env, '/admin/users',
    { headers: { 'X-Operator-Token': 'mock-operator-token' } });
  assert.strictEqual(asOperator.status, 200);
});

await scenario('live routes fail closed when accounts are not configured', async () => {
  const env = makeEnv();
  delete env.AUTH_JWT_SECRET;
  const before = upstreamCalls.length;
  const r = await call(env, '/describe', { method: 'POST',
    body: { description: 'a rover' } });
  assert.strictEqual(r.status, 503);
  assert.strictEqual(r.body.code, 'auth_not_configured');
  assert.strictEqual(upstreamCalls.length, before);
});

/* ---------------- Parts API ----------------
 * Records are seeded straight into the fake KV, in the shape
 * tools/parts-api/seed.py writes. Expiry dates are pinned to
 * 2000/2999 so the scenarios never rot with the calendar. */

const PART_RECORDS = [
  {
    id: 'driver_tb6612fng', name: 'TB6612FNG dual motor driver',
    mpn: 'TB6612FNG', category: 'drivers',
    specs: { channels: 2, voltage_v_max: 15 },
    interfaces: ['pwm'], photo: null,
    estimates: [{
      unit_price: 4.95, currency: 'USD',
      price_breaks: [{ qty: 1, unit_price: 4.95 },
                     { qty: 100, unit_price: 3.85 }],
      supplier: 'Pololu', supplier_url: 'https://www.pololu.com/product/713',
      source_kind: 'web_gathered', state: 'web_gathered',
      fetched_at: '2026-11-01T09:25:48Z', expires_at: '2999-01-01T00:00:00Z',
      quote: '1+ $4.95', stock_wording: 'backorders allowed',
    }],
  },
  {
    id: 'multi_source_part', name: 'Multi Source Widget',
    mpn: null, category: 'sbc', specs: {}, interfaces: ['usb'],
    photo: { url: 'https://example.com/widget.jpg', credit: 'Photo: Example',
             source_page: 'https://example.com/widget' },
    estimates: [
      {
        unit_price: 10, currency: 'USD',
        price_breaks: [{ qty: 1, unit_price: 10 }],
        supplier: 'Pololu', supplier_url: 'https://www.pololu.com/product/999',
        source_kind: 'web_gathered', state: 'web_gathered',
        fetched_at: '2026-11-01T00:00:00Z', expires_at: '2999-01-01T00:00:00Z',
        quote: '$10.00',
      },
      {
        unit_price: 11, currency: 'USD',
        price_breaks: [{ qty: 1, unit_price: 11 }],
        supplier: 'Mouser', supplier_url: 'https://www.mouser.com/ProductDetail/999',
        source_kind: 'api', state: 'confirmed',
        fetched_at: '2026-10-01T00:00:00Z', expires_at: '2999-01-01T00:00:00Z',
        quote: null,
      },
    ],
  },
  {
    id: 'stale_part', name: 'Stale Part', mpn: null, category: 'power',
    specs: {}, interfaces: [], photo: null,
    estimates: [{
      unit_price: 7.5, currency: 'USD',
      price_breaks: [{ qty: 1, unit_price: 7.5 }],
      supplier: 'Pololu', supplier_url: 'https://www.pololu.com/product/111',
      source_kind: 'web_gathered', state: 'web_gathered',
      fetched_at: '2000-01-01T00:00:00Z', expires_at: '2000-01-02T00:00:00Z',
      quote: '$7.50',
    }],
  },
  {
    /* A price with NO source record behind it: the API must
     * refuse to serve it as currency anywhere. */
    id: 'bare_price_part', name: 'Bare Price Part', mpn: null,
    category: 'power', specs: {}, interfaces: [], photo: null,
    estimates: [{ unit_price: 9.99 }],
  },
  {
    id: 'plain_part', name: 'Plain Part', mpn: null, category: 'structure',
    specs: {}, interfaces: [], photo: null, estimates: [],
  },
];

async function seedParts(env) {
  for (const r of PART_RECORDS) {
    await env.RF_LIVE_KV.put('parts:' + r.id, JSON.stringify(r));
  }
  await env.RF_LIVE_KV.put('parts:index', JSON.stringify({
    ids: PART_RECORDS.map(r => r.id), count: PART_RECORDS.length,
    seeded_at: '2026-11-01T00:00:00Z', seed_version: 'test',
  }));
  return env;
}

await scenario('parts list serves seeded records, anonymously, with filters', async () => {
  const env = await seedParts(makeEnv());
  const all = await call(env, '/parts');
  assert.strictEqual(all.status, 200);
  assert.strictEqual(all.body.seeded, true);
  assert.strictEqual(all.body.count, 5);
  assert.ok(all.body.disclaimer.includes('Estimates'));
  assert.ok((all.headers.get('Cache-Control') || '').includes('s-maxage=3600'));
  const driver = all.body.parts.find(p => p.id === 'driver_tb6612fng');
  assert.strictEqual(driver.best_estimate.unit_price, 4.95);
  assert.strictEqual(driver.best_estimate.state, 'web_gathered');
  const byQ = await call(env, '/parts?q=tb6612');
  assert.deepStrictEqual(byQ.body.parts.map(p => p.id), ['driver_tb6612fng']);
  const byMpn = await call(env, '/parts?q=TB6612FNG');
  assert.strictEqual(byMpn.body.count, 1);
  const byCat = await call(env, '/parts?category=power');
  assert.deepStrictEqual(byCat.body.parts.map(p => p.id).sort(),
    ['bare_price_part', 'stale_part']);
  const byIface = await call(env, '/parts?interface=pwm');
  assert.deepStrictEqual(byIface.body.parts.map(p => p.id), ['driver_tb6612fng']);
  const none = await call(env, '/parts?interface=can');
  assert.strictEqual(none.body.count, 0);
});

await scenario('parts routes are a 503 without KV, and health says so', async () => {
  const env = makeEnv();
  delete env.RF_LIVE_KV;
  const r = await call(env, '/parts');
  assert.strictEqual(r.status, 503);
  assert.strictEqual(r.body.code, 'parts_not_configured');
  const h = await call(env, '/health');
  assert.strictEqual(h.body.routes.parts, false);
});

await scenario('parts list on an unseeded namespace is an honest empty', async () => {
  const r = await call(makeEnv(), '/parts');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.seeded, false);
  assert.strictEqual(r.body.count, 0);
});

await scenario('part get returns the full record; unknown id is a clean 404', async () => {
  const env = await seedParts(makeEnv());
  const r = await call(env, '/parts/multi_source_part');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.photo.credit, 'Photo: Example');
  assert.strictEqual(r.body.estimates.length, 2);
  assert.strictEqual(r.body.estimates[0].expired, false);
  const missing = await call(env, '/parts/no_such_part');
  assert.strictEqual(missing.status, 404);
  assert.strictEqual(missing.body.code, 'part_not_found');
});

await scenario('estimate endpoint: confirmed beats fresher web-gathered', async () => {
  const env = await seedParts(makeEnv());
  const r = await call(env, '/parts/multi_source_part/estimate');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.estimate.unit_price, 11);
  assert.strictEqual(r.body.estimate.state, 'confirmed');
  assert.strictEqual(r.body.estimate.expired, false);
  assert.strictEqual(r.body.alternates.length, 1);
  assert.strictEqual(r.body.alternates[0].unit_price, 10);
  assert.deepStrictEqual(r.body.unknowns, ['shipping', 'tax', 'stock']);
  assert.ok(r.body.disclaimer.includes('Estimates'));
  assert.ok(r.body.as_of);
});

await scenario('estimate endpoint flags expired money, never serves it fresh', async () => {
  const env = await seedParts(makeEnv());
  const r = await call(env, '/parts/stale_part/estimate');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.estimate, null);
  assert.strictEqual(r.body.expired.length, 1);
  assert.strictEqual(r.body.expired[0].expired, true);
  const g = await call(env, '/parts/stale_part');
  assert.strictEqual(g.body.best_estimate, null);
  assert.strictEqual(g.body.estimates[0].expired, true);
});

await scenario('a price without a source record is never served', async () => {
  const env = await seedParts(makeEnv());
  const g = await call(env, '/parts/bare_price_part');
  assert.strictEqual(g.status, 200);
  assert.deepStrictEqual(g.body.estimates, []);
  assert.strictEqual(g.body.best_estimate, null);
  const e = await call(env, '/parts/bare_price_part/estimate');
  assert.strictEqual(e.body.estimate, null);
});

await scenario('bom rollup: qty breaks, trust split, unverified share', async () => {
  const env = await seedParts(makeEnv());
  const before = upstreamCalls.length;
  const r = await call(env, '/bom/estimate', { method: 'POST', body: {
    lines: [
      { partId: 'driver_tb6612fng', qty: 150 },
      { partId: 'multi_source_part', qty: 1 },
      { partId: 'plain_part', qty: 1 },
      { partId: 'bare_price_part', qty: 2 },
      { partId: 'ghost_part', qty: 1 },
    ] } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const byId = Object.fromEntries(r.body.lines.map(l => [l.partId, l]));
  /* 150 units reach the 100+ break: 3.85, not the 1+ price. */
  assert.strictEqual(byId.driver_tb6612fng.status, 'priced');
  assert.strictEqual(byId.driver_tb6612fng.qty_break, 100);
  assert.strictEqual(byId.driver_tb6612fng.line_total, 577.5);
  assert.strictEqual(byId.multi_source_part.line_total, 11);
  assert.strictEqual(byId.plain_part.status, 'unpriced');
  assert.strictEqual(byId.bare_price_part.status, 'unpriced');
  assert.strictEqual(byId.ghost_part.status, 'unknown_part');
  assert.strictEqual(r.body.totals.priced_total, 588.5);
  assert.strictEqual(r.body.totals.by_source_kind.web_gathered, 577.5);
  assert.strictEqual(r.body.totals.by_source_kind.api, 11);
  assert.strictEqual(r.body.totals.unverified_web_gathered_total, 577.5);
  assert.deepStrictEqual(r.body.unpriced.sort(),
    ['bare_price_part', 'ghost_part', 'plain_part']);
  assert.strictEqual(upstreamCalls.length, before,
    'the rollup must not call a model');
  const h = await call(env, '/health');
  assert.strictEqual(h.body.budget.used, 0,
    'the rollup must not spend the daily budget');
});

await scenario('bom rollup keeps expired money out of the totals', async () => {
  const env = await seedParts(makeEnv());
  const r = await call(env, '/bom/estimate', { method: 'POST', body: {
    lines: [{ partId: 'stale_part', qty: 1 }] } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.lines[0].status, 'stale');
  assert.strictEqual(r.body.lines[0].estimate.expired, true);
  assert.strictEqual(r.body.totals.priced_total, 0);
  assert.deepStrictEqual(r.body.stale, ['stale_part']);
});

await scenario('bom estimate validates its body and lines', async () => {
  const env = await seedParts(makeEnv());
  const empty = await call(env, '/bom/estimate', { method: 'POST', body: {} });
  assert.strictEqual(empty.status, 400);
  assert.strictEqual(empty.body.code, 'bad_lines');
  const badQty = await call(env, '/bom/estimate', { method: 'POST', body: {
    lines: [{ partId: 'plain_part', qty: 0 }] } });
  assert.strictEqual(badQty.status, 200);
  assert.strictEqual(badQty.body.lines[0].status, 'error');
});

await scenario('account save keeps robots under the account', async () => {
  const env = makeEnv();
  const anon = await call(env, '/account/save', { method: 'POST', body: { data: { 'rf.garage.v1': [] } } });
  assert.strictEqual(anon.status, 401);
  const none = await call(env, '/account/data', { auth: true });
  assert.strictEqual(none.status, 200);
  assert.strictEqual(none.body.saved, false);
  const garage = [{ id: 'r1', name: 'Omega1', versions: [] }];
  const ok = await call(env, '/account/save', { method: 'POST', auth: true,
    body: { data: { 'rf.garage.v1': garage, 'rf.inventory.v1': [], 'evil.key': 'x' } } });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
  assert.ok(ok.body.savedAt);
  const back = await call(env, '/account/data', { auth: true });
  assert.strictEqual(back.body.saved, true);
  assert.deepStrictEqual(back.body.data['rf.garage.v1'], garage);
  assert.ok(!('evil.key' in back.body.data), 'unknown keys must be dropped');
  const bad = await call(env, '/account/save', { method: 'POST', auth: true, body: { data: [] } });
  assert.strictEqual(bad.status, 400);
  const big = await call(env, '/account/save', { method: 'POST', auth: true,
    body: { data: { 'rf.inventory.v1': 'x'.repeat(5 * 1024 * 1024 + 10) } } });
  assert.strictEqual(big.status, 413);
  // The daily cap: one KV write per save, at most 50 a day.
  for (let i = 1; i < 50; i++) {
    const r = await call(env, '/account/save', { method: 'POST', auth: true, body: { data: { 'rf.garage.v1': [] } } });
    assert.strictEqual(r.status, 200, 'save ' + i);
  }
  const capped = await call(env, '/account/save', { method: 'POST', auth: true, body: { data: { 'rf.garage.v1': [] } } });
  assert.strictEqual(capped.status, 429);
  assert.strictEqual(capped.body.code, 'save_limit');
});

const failed = results.filter(r => r.startsWith('FAIL'));
console.log(results.join('\n'));
console.log(failed.length ? `\n${failed.length} scenario(s) failed` : '\nall scenarios passed');
process.exit(failed.length ? 1 : 0);
