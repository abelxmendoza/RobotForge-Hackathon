'use strict';
/* RobotForge live endpoint — a single-file Cloudflare Worker.
 *
 * The RobotForge site is static (GitHub Pages) and cannot hold an API
 * key, so this Worker is the only place a key lives: it proxies the
 * site's two live calls to Baseten (Muse Spark Open) and holds the
 * key as a Worker secret (BASETEN_API_KEY — see README.md).
 *
 *   GET  /health   -> { ok, mode, configured, kv, budget, routes }
 *                     — no model call
 *   POST /describe -> { description }      => { spec, model }
 *   POST /chat     -> { message }          => { answer, model }
 *   POST /list     -> { text }             => { import, model_generated, model }
 *   POST /photo    -> { image_data_url }   => { draft, estimated, model }
 *
 * /describe, /chat and /list proxy Baseten (key: BASETEN_API_KEY
 * secret). /photo proxies the Meta Model API vision model (key:
 * META_API_KEY secret — OPTIONAL: without it /photo answers 501 and
 * the site falls back to its recorded photo sample, by design).
 *
 * Guardrails (these spend the owner's API credits):
 *   - CORS locked to the Pages origin (+ localhost for development);
 *     any other Origin is rejected.
 *   - Model, temperature and max_tokens are fixed here; nothing the
 *     client sends can change them.
 *   - Request bodies are size-capped; text inputs are length-capped.
 *   - A per-IP daily limit and a global daily budget counter in
 *     Workers KV, shared by every live route. Over budget -> 503,
 *     and the site falls back to its recorded/local modes. Counters
 *     fail closed: if KV errors, live calls stop rather than spend
 *     uncounted.
 *   - LIVE_ENABLED=0 is the kill switch.
 *
 * Deploy + keys: live/README.md. No secret is ever committed here.
 */

const MODEL = 'meta-models/muse-spark-open';
const BASETEN_URL = 'https://inference.baseten.co/v1/chat/completions';
const PHOTO_MODEL = 'muse-spark-1.3';
const META_URL = 'https://api.meta.ai/v1/chat/completions';
const ALLOWED_ORIGINS = [
  'https://abelxmendoza.github.io',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
  'http://localhost:3000',
];
const MAX_BODY_BYTES = 16384;
const PHOTO_MAX_BODY_BYTES = 3000000; // a downscaled photo data URL
const DESCRIBE_MAX_CHARS = 4000;
const CHAT_MAX_CHARS = 2000;
const LIST_MAX_CHARS = 8000;
const UPSTREAM_TIMEOUT_MS = 120000; // model calls took 15-95 s in testing

/* The describe system prompt. This is a MIRROR of SYSTEM_PROMPT in
 * src/robotforge/describe.py — the Python is the source of truth and
 * tests/test_live.py asserts the two are byte-identical. */
// BEGIN describe prompt mirror
const DESCRIBE_SYSTEM_PROMPT = /*PROMPT_BEGIN*/`You convert a plain-language robot description into a strict JSON
robot specification. Output ONLY the JSON object, no prose, no markdown fences.

Fields (all lengths in metres, masses in kg, voltages in V):
name (string), description (string),
drivetrain: one of differential|skid_steer|ackermann|mecanum|tracked,
length_m, width_m, height_m, mass_kg, ground_clearance_m (numbers),
wheel: {diameter_m, width_m, count, driven},
motor: {kind, voltage_v, count, stall_torque_nm or null},
battery: {chemistry, voltage_v, capacity_mah},
sensors: [{kind: ultrasonic|lidar_2d|depth_camera|rgb_camera|imu|gps|bumper|encoder,
           position, range_m or null}],
component_mass_kg: {part_name: mass} — include when the description gives part masses.

Use realistic values for anything the description omits, and keep the design
physically coherent: ground clearance must not exceed the wheel radius, and the
motor voltage must not exceed the battery voltage.`/*PROMPT_END*/;
// END describe prompt mirror

/* The spec contract the Worker's /describe validates against before
 * anything reaches the page: required fields + enums mirrored from
 * src/robotforge/schema.py (RobotSpec.from_dict). tests/test_live.py
 * asserts this matches the Python schema. Full parsing and the
 * engineering checks still happen in Python (robotforge validate)
 * when a spec is used with the CLI. */
const SPEC_SCHEMA = /*SPEC_SCHEMA_BEGIN*/{
  "required_top": ["name", "drivetrain", "length_m", "width_m",
    "height_m", "mass_kg", "ground_clearance_m", "wheel", "motor",
    "battery"],
  "required_nested": {
    "wheel": ["diameter_m", "width_m", "count"],
    "motor": ["kind", "voltage_v", "count"],
    "battery": ["chemistry", "voltage_v", "capacity_mah"]
  },
  "drivetrains": ["differential", "skid_steer", "ackermann", "mecanum",
    "tracked"],
  "sensor_kinds": ["ultrasonic", "lidar_2d", "depth_camera", "rgb_camera",
    "imu", "gps", "bumper", "encoder"]
}/*SPEC_SCHEMA_END*/;

const CHAT_SYSTEM_PROMPT = `You are the Forge Guide's live model for RobotForge, a tool that turns plain-language robot descriptions into validated digital twins: a structured spec, engineering checks, a Gazebo simulation twin, and a measured motion gate with locked thresholds.

Answer questions about RobotForge, robot design, parts, and how to write a good robot description. Be concise (a few short paragraphs at most), plain-spoken and beginner-friendly. Plain line breaks are fine; no markdown tables.

Hard rules:
- You have NO access to RobotForge's recorded data. Never state a specific gate verdict, pass/fail result, percentage, error value, or run count for any named robot as if it were a recorded fact.
- For recorded numbers, point the user to this site's Evidence page and Robodex, which carry the measured record.
- If you use a number as an example, label it clearly as an example, not a result.`;

/* The photo system prompt: a MIRROR of SYSTEM_PROMPT +
 * PHOTO_INSTRUCTIONS as composed in src/robotforge/photo.py (the
 * Python is the source of truth; tests/test_live.py asserts the two
 * are byte-identical). */
// BEGIN photo prompt mirror
const PHOTO_SYSTEM_PROMPT = /*PHOTO_PROMPT_BEGIN*/`You convert a plain-language robot description into a strict JSON
robot specification. Output ONLY the JSON object, no prose, no markdown fences.

Fields (all lengths in metres, masses in kg, voltages in V):
name (string), description (string),
drivetrain: one of differential|skid_steer|ackermann|mecanum|tracked,
length_m, width_m, height_m, mass_kg, ground_clearance_m (numbers),
wheel: {diameter_m, width_m, count, driven},
motor: {kind, voltage_v, count, stall_torque_nm or null},
battery: {chemistry, voltage_v, capacity_mah},
sensors: [{kind: ultrasonic|lidar_2d|depth_camera|rgb_camera|imu|gps|bumper|encoder,
           position, range_m or null}],
component_mass_kg: {part_name: mass} — include when the description gives part masses.

Use realistic values for anything the description omits, and keep the design
physically coherent: ground clearance must not exceed the wheel radius, and the
motor voltage must not exceed the battery voltage.
You are now looking at a PHOTO of a robot (attached as an image). Work from
what is actually visible in the photo, not from a typical robot.

Output ONLY one JSON object with exactly these keys:
- "identity_guess": your best identification of the robot (e.g. "TurtleBot 2
  (iRobot Create base, Kinect sensor)"), or "unknown custom robot" if you
  cannot identify it. Never state an identity you are not fairly confident
  about; a wrong name is worse than "unknown".
- "visible_parts": a list of {"kind": ..., "count": ..., "position": ...,
  "notes": ...} for parts you can SEE in the photo (wheels, cameras, lidar,
  arms, antennas...). "count" is how many are VISIBLE, which may be fewer
  than the robot really has (occlusion). Do not list parts you cannot see.
- "spec": the robot specification object, in exactly the field format
  described above.

Dimensions: a photo has no scale reference, so every length, mass and size
in the spec is an ESTIMATE from apparent proportions and the typical size
of the identified robot or parts — never present a dimension as measured.
If you recognized the robot model, use its published approximate size as
the estimate basis and say so in the spec "description" (prefix the
description with "Photo draft (all dimensions ESTIMATED): "). Keep the
design physically coherent: ground clearance must not exceed the wheel
radius, and the motor voltage must not exceed the battery voltage. For a
two-visible-wheel differential base with a caster, wheel count is the
number of DRIVE wheels (usually 2), not the visible total.
`/*PHOTO_PROMPT_END*/;
// END photo prompt mirror

/* The parts catalogue the /list prompt matches against: id + name for
 * every part in catalog/parts.json, mirrored here (tests/test_live.py
 * asserts this list matches the catalogue exactly). */
// BEGIN catalogue parts mirror
const CATALOG_PARTS = /*PARTS_BEGIN*/[{"id": "lipo_4s_5200", "name": "LiPo battery 4S 5200 mAh"}, {"id": "lipo_4s_1500", "name": "LiPo battery 4S 1500 mAh (5-inch quad)"}, {"id": "lipo_3s_2200", "name": "LiPo battery 3S 2200 mAh"}, {"id": "buck_converter_5v", "name": "Buck converter 5 V / 5 A"}, {"id": "lipo_balance_charger", "name": "LiPo balance charger"}, {"id": "xt60_pigtail", "name": "XT60 pigtail lead"}, {"id": "silicone_wire_14awg", "name": "Silicone wire 14 AWG (per metre)"}, {"id": "driver_tb6612fng", "name": "TB6612FNG dual motor driver"}, {"id": "driver_l298n", "name": "L298N dual motor driver module"}, {"id": "esc_4in1_45a", "name": "4-in-1 ESC 45 A (BLHeli_S class)"}, {"id": "esc_quicrun_1060", "name": "Brushed ESC 60 A (QuicRun 1060 class)"}, {"id": "esp32_devkit", "name": "ESP32 development board"}, {"id": "teensy_41", "name": "Teensy 4.1"}, {"id": "pico_rp2040", "name": "Raspberry Pi Pico (RP2040)"}, {"id": "raspberry_pi_5", "name": "Raspberry Pi 5"}, {"id": "microsd_128gb", "name": "microSD card 128 GB (A2/V30)"}, {"id": "sik_telemetry_v3", "name": "SiK telemetry radio pair (915 MHz)"}, {"id": "elrs_receiver", "name": "ExpressLRS receiver"}, {"id": "realsense_d435", "name": "Intel RealSense D435 depth camera"}, {"id": "rplidar_a1", "name": "RPLIDAR A1 2D lidar"}, {"id": "imu_bno055", "name": "BNO055 9-DOF IMU breakout"}, {"id": "ultrasonic_hcsr04", "name": "HC-SR04 ultrasonic ranger"}, {"id": "pla_filament", "name": "PLA filament 1.75 mm, 1 kg"}, {"id": "petg_filament", "name": "PETG filament 1.75 mm, 1 kg"}, {"id": "fuse_inline", "name": "Inline blade fuse holder + fuse"}, {"id": "estop_button", "name": "Emergency stop button (latching)"}, {"id": "bms_4s", "name": "BMS protection board 4S 40 A"}, {"id": "custom_pcb_kicad", "name": "Custom PCB (KiCad import)"}, {"id": "gearmotor_12v", "name": "DC gearmotor 12 V (37 mm class)"}, {"id": "brushed_motor_540", "name": "Brushed motor 540 size"}, {"id": "servo_mg996r", "name": "MG996R servo"}, {"id": "servo_sts3215", "name": "STS3215 serial bus servo (Feetech)"}, {"id": "stepper_nema17", "name": "Stepper motor NEMA 17"}, {"id": "brushless_2207_1960kv", "name": "Brushless motor 2207 1960 KV"}, {"id": "wheel_100mm", "name": "Wheel 100 mm diameter"}, {"id": "mecanum_wheel_100mm", "name": "Mecanum wheel 100 mm"}, {"id": "caster_ball", "name": "Ball caster"}, {"id": "propeller_5040", "name": "Propeller 5x4.0x3 tri-blade"}, {"id": "fc_f405_stack", "name": "Flight controller stack F405"}, {"id": "gripper_2finger", "name": "2-finger parallel gripper kit"}, {"id": "quad_frame_5inch", "name": "Quadcopter frame 5 inch (carbon)"}, {"id": "extrusion_2020", "name": "Aluminium extrusion 2020 (per metre)"}, {"id": "chassis_plate", "name": "Chassis plate (3D-printed)"}, {"id": "motor_mount", "name": "Motor mount bracket (3D-printed)"}, {"id": "lidar_mount", "name": "Lidar mount post (3D-printed)"}, {"id": "camera_bracket", "name": "Camera bracket (3D-printed)"}, {"id": "ultrasonic_bracket", "name": "Ultrasonic bracket (3D-printed)"}, {"id": "camera_rpi_v2", "name": "Raspberry Pi Camera Module V2 (8 MP)"}, {"id": "liion_18650_3s", "name": "18650 Li-ion pack 3S (3 cells)"}]/*PARTS_END*/;
// END catalogue parts mirror

const LIST_SYSTEM_PROMPT = `You import a pasted robot parts list for RobotForge. You are given the site's parts catalogue as lines of "id — name". Match each line of the user's list to at most one catalogue part: use its exact id when the line clearly names that part, otherwise null. Never invent a catalogue id.

Output ONLY one JSON object, no prose, no markdown fences, with exactly these keys:
- "items": [{"title": the line as pasted, "matched_part_id": a catalogue id or null, "qty": a number}] — one entry per real list line; skip prices, ratings and store noise lines.
- "missing": [plain-language labels of parts a robot built from this list would still need that are not in the list] — [] when nothing obvious is missing.
- "wiring": [{"from": ..., "via": ..., "to": ..., "note": ...}] — suggested connections between the listed parts, each with a short reason; [] when the parts do not support any.
- "draft_spec": a robot specification object in the same field format as a RobotForge describe spec (name, description, drivetrain, length_m, width_m, height_m, mass_kg, ground_clearance_m, wheel{diameter_m,width_m,count}, motor{kind,voltage_v,count}, battery{chemistry,voltage_v,capacity_mah}, sensors) when the listed parts support a coherent ground robot; otherwise null. Use realistic values and keep it physically coherent: ground clearance must not exceed the wheel radius, and the motor voltage must not exceed the battery voltage.

Catalogue parts:
` + CATALOG_PARTS.map(p => p.id + ' — ' + p.name).join('\n');

/* ------------------------------------------------------------------ */

function intEnv(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const headers = { 'Vary': 'Origin' };
  if (ALLOWED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

function originRejected(request) {
  const origin = request.headers.get('Origin');
  // No Origin header: not a browser call (health checks, curl). The
  // budget below is the real guardrail; CORS only governs browsers.
  return origin !== null && !ALLOWED_ORIGINS.includes(origin);
}

function json(request, status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
  });
}

function err(request, status, code, message) {
  return json(request, status, { error: message, code });
}

/* ---------------- budget + rate limit (Workers KV) ---------------- */

function dayStamp() {
  return new Date().toISOString().slice(0, 10); // UTC day
}

async function readCount(kv, key) {
  const n = parseInt(await kv.get(key), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

async function budgetState(env) {
  if (!env.RF_LIVE_KV) return null;
  const limit = intEnv(env.DAILY_LIMIT, 200);
  const used = await readCount(env.RF_LIVE_KV, 'count:' + dayStamp());
  return { used, limit, exhausted: used >= limit };
}

/* Returns an error Response when a live call must not proceed, else
 * null. Increments both counters BEFORE the model call, so failed or
 * slow calls still count against the budget. */
async function gateBudget(env, request) {
  if (String(env.LIVE_ENABLED ?? '1') === '0') {
    return err(request, 503, 'disabled',
      'Live mode is switched off at the endpoint. The recorded answers still work.');
  }
  const kv = env.RF_LIVE_KV;
  if (!kv) return null; // dev without KV bound: no counters (README: bind KV before going live)
  try {
    const day = dayStamp();
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const perIpLimit = intEnv(env.PER_IP_DAILY_LIMIT, 30);
    const ipKey = 'ip:' + day + ':' + ip;
    const ipUsed = await readCount(kv, ipKey);
    if (ipUsed >= perIpLimit) {
      return err(request, 429, 'rate_limited',
        'You have reached today\'s per-visitor limit for live calls. The recorded answers still work.');
    }
    const state = await budgetState(env);
    if (state && state.exhausted) {
      return err(request, 503, 'budget_exhausted',
        'Today\'s live budget is used up. The recorded answers still work.');
    }
    const ttl = { expirationTtl: 172800 }; // counters die with the day
    await kv.put(ipKey, String(ipUsed + 1), ttl);
    await kv.put('count:' + day, String((state ? state.used : 0) + 1), ttl);
    return null;
  } catch (e) {
    // Counters are the credit guardrail: if they break, stop rather
    // than spend uncounted.
    return err(request, 503, 'guardrail_error',
      'The live budget guardrail is unavailable, so live calls are paused. The recorded answers still work.');
  }
}

/* ---------------- upstream model calls ---------------- */

async function postChatCompletions(url, apiKey, payload, label) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(label + ' returned HTTP ' + res.status + (detail ? ': ' + detail : ''));
  }
  return res.json();
}

function messageContent(payload) {
  const content = payload && payload.choices && payload.choices[0] &&
    payload.choices[0].message && payload.choices[0].message.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('the model returned an empty reply');
  }
  return content;
}

async function callModel(env, messages, temperature, maxTokens) {
  const payload = await postChatCompletions(BASETEN_URL, env.BASETEN_API_KEY, {
    model: MODEL,
    messages,
    temperature,
    max_tokens: maxTokens,
  }, 'Baseten');
  return messageContent(payload);
}

/* One Meta Model API vision call: photo -> ESTIMATED spec draft.
 * Mirrors photo.py's draft_spec_from_photo request shape. */
async function callMetaVision(env, imageDataUrl, note) {
  const payload = await postChatCompletions(META_URL, env.META_API_KEY, {
    model: PHOTO_MODEL,
    messages: [
      { role: 'system', content: PHOTO_SYSTEM_PROMPT },
      { role: 'user', content: [
        { type: 'text',
          text: 'Draft a robot specification from this photo.' +
            (note ? ' The photographer adds: ' + note : '') },
        { type: 'image_url', image_url: { url: imageDataUrl } },
      ] },
    ],
    temperature: 0.2,
    max_tokens: 4000,
  }, 'The Meta Model API');
  return messageContent(payload);
}

/* ---------------- spec validation (mirrors schema.py) ---------------- */

function validateSpec(spec) {
  if (typeof spec !== 'object' || spec === null || Array.isArray(spec)) {
    return 'the reply is not a JSON object';
  }
  for (const k of SPEC_SCHEMA.required_top) {
    if (!(k in spec)) return 'missing field: ' + k;
  }
  for (const [obj, keys] of Object.entries(SPEC_SCHEMA.required_nested)) {
    if (typeof spec[obj] !== 'object' || spec[obj] === null) {
      return obj + ' is not an object';
    }
    for (const k of keys) {
      if (!(k in spec[obj])) return 'missing field: ' + obj + '.' + k;
    }
  }
  for (const k of ['length_m', 'width_m', 'height_m', 'mass_kg',
                   'ground_clearance_m']) {
    if (typeof spec[k] !== 'number' || !Number.isFinite(spec[k])) {
      return k + ' is not a number';
    }
  }
  if (!SPEC_SCHEMA.drivetrains.includes(spec.drivetrain)) {
    return 'unknown drivetrain: ' + String(spec.drivetrain);
  }
  if (spec.sensors !== undefined) {
    if (!Array.isArray(spec.sensors)) return 'sensors is not a list';
    for (const s of spec.sensors) {
      if (!s || !SPEC_SCHEMA.sensor_kinds.includes(s.kind)) {
        return 'unknown sensor kind: ' + String(s && s.kind);
      }
    }
  }
  return null;
}

/* Same fence-stripping as describe.py's _spec_from_chat_payload. */
function stripFences(text) {
  let t = text.trim();
  if (t.startsWith('```')) {
    t = t.replace(/^`+/, '').replace(/`+$/, '');
    if (t.startsWith('json')) t = t.slice(4);
    t = t.trim();
  }
  return t;
}

/* ---------------- request handling ---------------- */

async function readJsonBody(request, maxBytes) {
  const cap = maxBytes || MAX_BODY_BYTES;
  const len = Number(request.headers.get('Content-Length') || 0);
  if (len > cap) return { error: 'request body too large' };
  const text = await request.text();
  if (text.length > cap) return { error: 'request body too large' };
  try {
    return { data: JSON.parse(text || '{}') };
  } catch (e) {
    return { error: 'request body is not valid JSON' };
  }
}

async function handleDescribe(request, env) {
  if (!env.BASETEN_API_KEY) {
    return err(request, 500, 'not_configured',
      'The endpoint has no Baseten key configured (see live/README.md).');
  }
  const { data, error } = await readJsonBody(request);
  if (error) return err(request, 413, 'too_large', error);
  const description = data && data.description;
  if (typeof description !== 'string' || !description.trim()) {
    return err(request, 400, 'missing_description',
      'Send { "description": "a plain-language robot description" }.');
  }
  if (description.length > DESCRIBE_MAX_CHARS) {
    return err(request, 413, 'too_large',
      'Description is over ' + DESCRIBE_MAX_CHARS + ' characters.');
  }
  const gate = await gateBudget(env, request);
  if (gate) return gate;
  let content;
  try {
    content = await callModel(env, [
      { role: 'system', content: DESCRIBE_SYSTEM_PROMPT },
      { role: 'user', content: description },
    ], 0.2, 4000);
  } catch (e) {
    return err(request, 502, 'upstream_error',
      'The model call failed (' + e.message + '). Nothing was recorded; the recorded runs still work.');
  }
  let spec;
  try {
    spec = JSON.parse(stripFences(content));
  } catch (e) {
    return err(request, 502, 'bad_model_output',
      'The model returned something that is not a spec JSON. Nothing was saved; try rephrasing the description.');
  }
  const problem = validateSpec(spec);
  if (problem) {
    return err(request, 502, 'bad_model_output',
      'The model\'s spec failed the schema check (' + problem + '). Nothing was saved; try rephrasing the description.');
  }
  return json(request, 200, { spec, model: MODEL });
}

async function handleChat(request, env) {
  if (!env.BASETEN_API_KEY) {
    return err(request, 500, 'not_configured',
      'The endpoint has no Baseten key configured (see live/README.md).');
  }
  const { data, error } = await readJsonBody(request);
  if (error) return err(request, 413, 'too_large', error);
  const message = data && data.message;
  if (typeof message !== 'string' || !message.trim()) {
    return err(request, 400, 'missing_message',
      'Send { "message": "your question" }.');
  }
  if (message.length > CHAT_MAX_CHARS) {
    return err(request, 413, 'too_large',
      'Message is over ' + CHAT_MAX_CHARS + ' characters.');
  }
  const gate = await gateBudget(env, request);
  if (gate) return gate;
  let content;
  try {
    content = await callModel(env, [
      { role: 'system', content: CHAT_SYSTEM_PROMPT },
      { role: 'user', content: message },
    ], 0.4, 2000);
  } catch (e) {
    return err(request, 502, 'upstream_error',
      'The model call failed (' + e.message + '). The recorded answers still work.');
  }
  return json(request, 200, { answer: content.trim(), model: MODEL });
}

const ESTIMATED_PREFIX = 'Photo draft (all dimensions ESTIMATED): ';

async function handlePhoto(request, env) {
  /* The Meta key is OPTIONAL by design: without it this route is
   * simply off (501), and the site says so and offers its recorded
   * photo sample instead. Nothing about that is an error state. */
  if (!env.META_API_KEY) {
    return err(request, 501, 'photo_not_configured',
      'Photo live mode is not configured on this endpoint (no Meta API key). The recorded photo sample still works.');
  }
  const { data, error } = await readJsonBody(request, PHOTO_MAX_BODY_BYTES);
  if (error) return err(request, 413, 'too_large', error);
  const image = data && data.image_data_url;
  if (typeof image !== 'string' || !image.startsWith('data:image/')) {
    return err(request, 400, 'missing_image',
      'Send { "image_data_url": "data:image/..." }.');
  }
  const note = typeof data.note === 'string' ? data.note.slice(0, 500) : '';
  const gate = await gateBudget(env, request);
  if (gate) return gate;
  let content;
  try {
    content = await callMetaVision(env, image, note);
  } catch (e) {
    return err(request, 502, 'upstream_error',
      'The photo model call failed (' + e.message + '). Your photo was not stored anywhere.');
  }
  let parsed;
  try {
    parsed = JSON.parse(stripFences(content));
  } catch (e) {
    return err(request, 502, 'bad_model_output',
      'The photo model returned something that is not JSON. Nothing was saved.');
  }
  if (!parsed || typeof parsed !== 'object' || !parsed.spec) {
    return err(request, 502, 'bad_model_output',
      'The photo model returned no spec object. Nothing was saved.');
  }
  const problem = validateSpec(parsed.spec);
  if (problem) {
    return err(request, 502, 'bad_model_output',
      'The photo draft failed the schema check (' + problem + '). Nothing was saved.');
  }
  const spec = parsed.spec;
  /* ESTIMATED framing is mandatory: the prompt asks for the prefix,
   * and the Worker enforces it, so no client can ever render a
   * photo draft as if it were measured. */
  if (typeof spec.description !== 'string' ||
      !spec.description.startsWith('Photo draft')) {
    spec.description = ESTIMATED_PREFIX +
      (typeof spec.description === 'string' ? spec.description : '');
  }
  const parts = Array.isArray(parsed.visible_parts)
    ? parsed.visible_parts
        .filter(p => p && typeof p === 'object')
        .map(p => ({
          kind: String(p.kind || ''),
          count: Number(p.count) || 0,
          position: String(p.position || ''),
          notes: String(p.notes || ''),
        }))
        .filter(p => p.kind)
    : [];
  return json(request, 200, {
    draft: {
      spec,
      identity_guess: String(parsed.identity_guess || 'unknown custom robot'),
      visible_parts: parts,
    },
    estimated: true,
    model: PHOTO_MODEL,
  });
}

async function handleList(request, env) {
  if (!env.BASETEN_API_KEY) {
    return err(request, 500, 'not_configured',
      'The endpoint has no Baseten key configured (see live/README.md).');
  }
  const { data, error } = await readJsonBody(request);
  if (error) return err(request, 413, 'too_large', error);
  const text = data && data.text;
  if (typeof text !== 'string' || !text.trim()) {
    return err(request, 400, 'missing_text',
      'Send { "text": "the pasted parts list" }.');
  }
  if (text.length > LIST_MAX_CHARS) {
    return err(request, 413, 'too_large',
      'List is over ' + LIST_MAX_CHARS + ' characters.');
  }
  const gate = await gateBudget(env, request);
  if (gate) return gate;
  let content;
  try {
    content = await callModel(env, [
      { role: 'system', content: LIST_SYSTEM_PROMPT },
      { role: 'user', content: text },
    ], 0.2, 4000);
  } catch (e) {
    return err(request, 502, 'upstream_error',
      'The model call failed (' + e.message + '). The recorded list run still works.');
  }
  let parsed;
  try {
    parsed = JSON.parse(stripFences(content));
  } catch (e) {
    return err(request, 502, 'bad_model_output',
      'The model returned something that is not JSON. Nothing was saved.');
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.items)) {
    return err(request, 502, 'bad_model_output',
      'The model returned no items list. Nothing was saved.');
  }
  /* Sanitize against the catalogue: a matched id the catalogue does
   * not have becomes null — the model cannot invent parts. */
  const ids = new Set(CATALOG_PARTS.map(p => p.id));
  const items = parsed.items
    .filter(i => i && typeof i === 'object')
    .map(i => ({
      title: String(i.title || '').slice(0, 300),
      matched_part_id: ids.has(i.matched_part_id) ? i.matched_part_id : null,
      qty: (typeof i.qty === 'number' && Number.isFinite(i.qty) && i.qty > 0)
        ? i.qty : 1,
    }))
    .filter(i => i.title);
  const missing = Array.isArray(parsed.missing)
    ? parsed.missing.filter(m => typeof m === 'string').map(m => m.slice(0, 200))
    : [];
  const wiring = Array.isArray(parsed.wiring)
    ? parsed.wiring
        .filter(c => c && typeof c === 'object')
        .map(c => ({
          from: String(c.from || ''), via: String(c.via || ''),
          to: String(c.to || ''), note: String(c.note || ''),
        }))
    : [];
  /* A draft spec rides along only if it passes the same schema
   * check as /describe; a bad draft is dropped with a note, never
   * passed through raw. */
  let draft = null, draftNote = null;
  if (parsed.draft_spec && typeof parsed.draft_spec === 'object') {
    const problem = validateSpec(parsed.draft_spec);
    if (problem) {
      draftNote = 'The model\'s draft spec failed the schema check (' +
        problem + ') and was dropped.';
    } else {
      draft = parsed.draft_spec;
    }
  }
  return json(request, 200, {
    import: { items, missing, wiring, draft_spec: draft },
    draft_note: draftNote,
    model_generated: true,
    model: MODEL,
  });
}

async function handle(request, env) {
  if (originRejected(request)) {
    return err(request, 403, 'origin_rejected',
      'This endpoint only serves the RobotForge site.');
  }
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...corsHeaders(request),
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
      },
    });
  }
  if (url.pathname === '/health' && request.method === 'GET') {
    let budget = null;
    try {
      budget = await budgetState(env);
    } catch (e) {
      budget = null;
    }
    const baseten = Boolean(env.BASETEN_API_KEY);
    return json(request, 200, {
      ok: true,
      mode: String(env.LIVE_ENABLED ?? '1') === '0' ? 'off' : 'live',
      configured: baseten,
      kv: Boolean(env.RF_LIVE_KV),
      budget,
      /* Which routes can actually run: describe/chat/list need the
       * Baseten key; photo needs the optional Meta key. */
      routes: {
        describe: baseten, chat: baseten, list: baseten,
        photo: Boolean(env.META_API_KEY),
      },
    });
  }
  if (url.pathname === '/describe' && request.method === 'POST') {
    return handleDescribe(request, env);
  }
  if (url.pathname === '/chat' && request.method === 'POST') {
    return handleChat(request, env);
  }
  if (url.pathname === '/list' && request.method === 'POST') {
    return handleList(request, env);
  }
  if (url.pathname === '/photo' && request.method === 'POST') {
    return handlePhoto(request, env);
  }
  return err(request, 404, 'not_found', 'No such route. Try /health, /describe, /chat, /list or /photo.');
}

export default { fetch: handle };
