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

let basetenMode = 'spec'; // spec | fenced | junk | chat | list | list-bad-draft
let metaMode = 'photo';   // photo | junk | document | document-bad
const upstreamCalls = [];
globalThis.fetch = async (url, opts) => {
  upstreamCalls.push({ url: String(url), opts });
  const u = String(url);
  if (u.startsWith('https://api.meta.ai/')) {
    assert.strictEqual(opts.headers.Authorization, 'Bearer meta-key-456');
    const content = metaMode === 'photo' ? JSON.stringify(PHOTO_DRAFT)
      : metaMode === 'document' ? JSON.stringify(DOC_DRAFT)
      : metaMode === 'document-bad' ? JSON.stringify(DOC_BAD)
      : 'this is not json at all';
    return new Response(JSON.stringify({
      choices: [{ message: { content } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  assert.ok(u.startsWith('https://inference.baseten.co/'),
    'worker fetched an unexpected URL: ' + url);
  assert.strictEqual(opts.headers.Authorization, 'Bearer test-key-123');
  const content = basetenMode === 'spec' ? JSON.stringify(GOOD_SPEC)
    : basetenMode === 'fenced' ? '```json\n' + JSON.stringify(GOOD_SPEC) + '\n```'
    : basetenMode === 'chat' ? 'A concise live answer.'
    : basetenMode === 'list' ? JSON.stringify(LIST_REPLY)
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
    ...overrides,
  };
}

async function call(env, path, { method = 'GET', body, origin = SITE, ip = '203.0.113.7' } = {}) {
  const headers = { 'CF-Connecting-IP': ip };
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
    { method: 'POST', body: { description: 'a small differential rover' } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.deepStrictEqual(r.body.spec, GOOD_SPEC);
  assert.strictEqual(r.body.model, 'meta-models/muse-spark-open');
});

await scenario('describe survives a fenced model reply', async () => {
  basetenMode = 'fenced';
  const r = await call(makeEnv(), '/describe',
    { method: 'POST', body: { description: 'a rover' } });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body.spec, GOOD_SPEC);
});

await scenario('malformed model output is a 502, never passthrough', async () => {
  basetenMode = 'junk';
  const r = await call(makeEnv(), '/describe',
    { method: 'POST', body: { description: 'a rover' } });
  assert.strictEqual(r.status, 502);
  assert.strictEqual(r.body.code, 'bad_model_output');
  assert.ok(!('spec' in r.body));
});

await scenario('chat happy path returns the answer', async () => {
  basetenMode = 'chat';
  const r = await call(makeEnv(), '/chat',
    { method: 'POST', body: { message: 'What is RobotForge?' } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.answer, 'A concise live answer.');
});

await scenario('client cannot override the model settings', async () => {
  basetenMode = 'chat';
  const before = upstreamCalls.length;
  const r = await call(makeEnv(), '/chat', {
    method: 'POST',
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
  const ok = await call(env, '/chat', { method: 'POST', body: { message: 'one' } });
  assert.strictEqual(ok.status, 200);
  const before = upstreamCalls.length;
  const r = await call(env, '/chat', { method: 'POST', body: { message: 'two' } });
  assert.strictEqual(r.status, 503);
  assert.strictEqual(r.body.code, 'budget_exhausted');
  assert.strictEqual(upstreamCalls.length, before, 'over-budget call reached the model');
  const h = await call(env, '/health');
  assert.strictEqual(h.body.budget.exhausted, true);
});

await scenario('per-IP limit is a 429', async () => {
  const env = makeEnv({ PER_IP_DAILY_LIMIT: '1' });
  basetenMode = 'chat';
  const ok = await call(env, '/chat', { method: 'POST', body: { message: 'one' } });
  assert.strictEqual(ok.status, 200);
  const r = await call(env, '/chat', { method: 'POST', body: { message: 'two' } });
  assert.strictEqual(r.status, 429);
  assert.strictEqual(r.body.code, 'rate_limited');
  const other = await call(env, '/chat',
    { method: 'POST', body: { message: 'different visitor' }, ip: '198.51.100.9' });
  assert.strictEqual(other.status, 200);
});

await scenario('kill switch turns live calls away', async () => {
  const env = makeEnv({ LIVE_ENABLED: '0' });
  const r = await call(env, '/chat', { method: 'POST', body: { message: 'hi' } });
  assert.strictEqual(r.status, 503);
  assert.strictEqual(r.body.code, 'disabled');
  const h = await call(env, '/health');
  assert.strictEqual(h.body.mode, 'off');
});

await scenario('oversized inputs are rejected before the model', async () => {
  const before = upstreamCalls.length;
  const r = await call(makeEnv(), '/chat',
    { method: 'POST', body: { message: 'x'.repeat(2001) } });
  assert.strictEqual(r.status, 413);
  const r2 = await call(makeEnv(), '/describe',
    { method: 'POST', body: { description: 'x'.repeat(4001) } });
  assert.strictEqual(r2.status, 413);
  assert.strictEqual(upstreamCalls.length, before);
});

await scenario('missing key is a plain 500, no call attempted', async () => {
  const env = makeEnv();
  delete env.BASETEN_API_KEY;
  const before = upstreamCalls.length;
  const r = await call(env, '/chat', { method: 'POST', body: { message: 'hi' } });
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
    { describe: true, chat: true, list: true, photo: false });
  const withMeta = await call(makeEnv({ META_API_KEY: 'meta-key-456' }), '/health');
  assert.strictEqual(withMeta.body.routes.photo, true);
});

await scenario('photo without the Meta key is a 501, no call attempted', async () => {
  const before = upstreamCalls.length;
  const r = await call(makeEnv(), '/photo', {
    method: 'POST',
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
    method: 'POST',
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
    method: 'POST',
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
    method: 'POST',
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
    method: 'POST',
    body: { image_data_url: 'data:image/png;base64,AAAA', mode: 'document' },
  });
  assert.strictEqual(r.status, 502);
  assert.strictEqual(r.body.code, 'bad_model_output');
  metaMode = 'photo';
});

await scenario('photo counts against the same daily budget', async () => {
  const env = makeEnv({ META_API_KEY: 'meta-key-456', DAILY_LIMIT: '1' });
  basetenMode = 'chat';
  const ok = await call(env, '/chat', { method: 'POST', body: { message: 'one' } });
  assert.strictEqual(ok.status, 200);
  const r = await call(env, '/photo', {
    method: 'POST',
    body: { image_data_url: 'data:image/jpeg;base64,AAAA' },
  });
  assert.strictEqual(r.status, 503);
  assert.strictEqual(r.body.code, 'budget_exhausted');
});

await scenario('list happy path sanitizes invented catalogue ids', async () => {
  basetenMode = 'list';
  const r = await call(makeEnv(), '/list', {
    method: 'POST',
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
    method: 'POST', body: { text: 'LiPo battery 4S 5200 mAh' },
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.import.draft_spec, null);
  assert.ok(r.body.draft_note && r.body.draft_note.includes('dropped'));
});

await scenario('list malformed model output is a 502', async () => {
  basetenMode = 'junk';
  const r = await call(makeEnv(), '/list', {
    method: 'POST', body: { text: 'some parts' },
  });
  assert.strictEqual(r.status, 502);
  assert.strictEqual(r.body.code, 'bad_model_output');
});

const failed = results.filter(r => r.startsWith('FAIL'));
console.log(results.join('\n'));
console.log(failed.length ? `\n${failed.length} scenario(s) failed` : '\nall scenarios passed');
process.exit(failed.length ? 1 : 0);
