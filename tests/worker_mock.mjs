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

let basetenMode = 'spec'; // spec | fenced | junk | chat | list | list-bad-draft | fix | part-chat
let metaMode = 'photo';   // photo | junk | document | document-bad | part
let githubMode = 'ok';    // ok | hidden | unverified
let googleMode = 'ok';    // ok | unverified
const upstreamCalls = [];
globalThis.fetch = async (url, opts) => {
  upstreamCalls.push({ url: String(url), opts });
  const u = String(url);
  if (u.startsWith('https://api.meta.ai/')) {
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
  assert.ok(u.startsWith('https://inference.baseten.co/'),
    'worker fetched an unexpected URL: ' + url);
  assert.strictEqual(opts.headers.Authorization, 'Bearer test-key-123');
  if (basetenMode === 'http500') {
    return new Response('upstream boom', { status: 500 });
  }
  const content = basetenMode === 'spec' ? JSON.stringify(GOOD_SPEC)
    : basetenMode === 'fenced' ? '```json\n' + JSON.stringify(GOOD_SPEC) + '\n```'
    : basetenMode === 'chat' ? 'A concise live answer.'
    : basetenMode === 'list' ? JSON.stringify(LIST_REPLY)
    : basetenMode === 'fix' ? JSON.stringify(FIX_REPLY)
    : basetenMode === 'part-chat' ? JSON.stringify(PART_CHAT_REPLY)
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
      photo: false, part: false, transcribe: false });
  const withMeta = await call(makeEnv({ META_API_KEY: 'meta-key-456' }), '/health');
  assert.strictEqual(withMeta.body.routes.photo, true);
  assert.strictEqual(withMeta.body.routes.transcribe, true);
});

await scenario('photo without the Meta key is a 501, no call attempted', async () => {
  const before = upstreamCalls.length;
  const r = await call(makeEnv(), '/photo', {
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

await scenario('part without the Meta key is a 501', async () => {
  const r = await call(makeEnv(), '/part', { method: 'POST', auth: true,
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

await scenario('transcribe without the Meta key is a 501', async () => {
  const before = upstreamCalls.length;
  const r = await call(makeEnv(), '/transcribe', { method: 'POST', auth: true,
    body: { audio_b64: 'UklGRg==' } });
  assert.strictEqual(r.status, 501);
  assert.strictEqual(r.body.code, 'transcribe_not_configured');
  assert.strictEqual(upstreamCalls.length, before);
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

const failed = results.filter(r => r.startsWith('FAIL'));
console.log(results.join('\n'));
console.log(failed.length ? `\n${failed.length} scenario(s) failed` : '\nall scenarios passed');
process.exit(failed.length ? 1 : 0);
