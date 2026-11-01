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
 *                     with { op_context }  => { answer, command, model }
 *                     (Tier-1 operator translation; the client validates
 *                     and applies the command, never the worker)
 *   POST /list     -> { text }             => { import, model_generated, model }
 *   POST /photo    -> { image_data_url, mode? }   => { draft, ... }
 *                     mode "photo" (default): ESTIMATED robot-photo
 *                     draft. mode "document": TRANSCRIBED draft from a
 *                     spec sheet / blueprint photo — document_read.
 *   POST /fix      -> { spec, findings }   => { changes, summary, model }
 *                     Muse Spark PROPOSES bounded spec edits for the
 *                     validator's findings; the client re-validates —
 *                     the model never assigns a verdict.
 *   POST /part     -> { image_data_url, note? }  => { part, model }
 *                     one inventory part identified from a photo
 *                     (Meta vision; needs the optional Meta key).
 *   POST /transcribe -> { audio_b64 }    => { transcript, model }
 *                     one spoken robot description, transcribed by
 *                     Muse Voice Transcribe on the Meta Model API
 *                     (key: META_API_KEY; WAV audio, client-encoded).
 *   POST /part-chat-> { part, message, history? } => { reply, update,
 *                     confirmed, model } — talk a part through until
 *                     the owner confirms what it is.
 *   POST /auth/register -> { email, password, name? } => { token, user }
 *   POST /auth/login    -> { email, password } => { token, user }
 *   GET  /auth/me       -> (Bearer) => { user }
 *   POST /auth/logout   -> { ok } (stateless: the client drops the token)
 *   GET  /auth/config   -> { metaLogin, providers: { meta, github,
 *                     google } } (which social logins are on)
 *   GET  /auth/<provider>/start    -> 302 to the provider (501
 *                     until that provider's app secrets exist)
 *   GET  /auth/<provider>/callback -> 302 back to the site with
 *                     the session token in the URL fragment
 *                     (<provider> is meta, github or google)
 *   GET  /admin/users, POST /admin/seed-founder, POST
 *        /admin/grant-role — operator routes, guarded by the
 *        OPERATOR_TOKEN secret (X-Operator-Token header). That is
 *        how Muse administers accounts for the owner.
 *
 * The text routes (describe/chat/list/fix/part-chat) run a
 * three-provider chain in MEASURED order (fixed 24-description
 * sweep, Oct 2026): Baseten serving Muse Spark Open (24/24, key:
 * BASETEN_API_KEY secret), then the Meta Model API direct serving
 * the hosted muse-spark-1.3 (23/24, key: META_API_KEY secret),
 * then Fireworks serving Muse Spark Open (21/24, re-measured
 * 18/24; key: FIREWORKS_API_KEY secret). A provider is attempted
 * only when its key is set and every earlier attempt failed; any
 * one key lights the text routes. Responses report the model that
 * actually answered, because the Meta attempt is a different model
 * (hosted Spark 1.3), not the same model on another host. A request
 * may pin one provider with { "provider": "baseten"|"meta"|
 * "fireworks" } — the site never sends it; it exists so the sweep
 * can be re-measured through this endpoint. /photo and /part proxy
 * the Meta Model API vision model (key: META_API_KEY secret —
 * OPTIONAL: without it they answer 501 and the site falls back to
 * its recorded photo sample, by design). /transcribe uses the same
 * Meta key.
 *
 * Guardrails (these spend the owner's API credits):
 *   - CORS locked to the site's origins (Vercel production, the
 *     legacy Pages origin, and localhost for development);
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
const META_TEXT_MODEL = 'muse-spark-1.3';
const TRANSCRIBE_MODEL = 'muse-voice-transcribe-1.0';
const TRANSCRIBE_URL = 'https://api.meta.ai/v1/asr/transcribe';
const META_URL = 'https://api.meta.ai/v1/chat/completions';
const FIREWORKS_MODEL = 'accounts/fireworks/models/muse-spark-open';
const FIREWORKS_URL = 'https://api.fireworks.ai/inference/v1/chat/completions';
const ALLOWED_ORIGINS = [
  'https://robot-forge-hackathon.vercel.app',
  'https://robot-forge-hackathon-abel-mendozas-projects.vercel.app',
  'https://abelxmendoza.github.io',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
  'http://localhost:3000',
];
const MAX_BODY_BYTES = 16384;
const PHOTO_MAX_BODY_BYTES = 3000000; // a downscaled photo data URL
const TRANSCRIBE_MAX_BODY_BYTES = 6000000; // base64 of a <=60 s WAV clip
const TRANSCRIBE_MAX_AUDIO_BYTES = 4000000; // decoded WAV cap (~80 s at 24 kHz mono)
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
    "height_m", "mass_kg", "motor", "battery"],
  "ground_required_top": ["ground_clearance_m", "wheel"],
  "ground_drivetrains": ["differential", "skid_steer", "ackermann",
    "mecanum", "tracked"],
  "class_required_top": {
    "multirotor": ["rotors"],
    "quadruped": ["legs"],
    "humanoid": ["legs", "arms"],
    "robotic_arm": ["arms"]
  },
  "required_nested": {
    "wheel": ["diameter_m", "width_m", "count"],
    "motor": ["kind", "voltage_v", "count"],
    "battery": ["chemistry", "voltage_v", "capacity_mah"],
    "rotors": ["count", "prop_diameter_m"],
    "legs": ["count"],
    "arms": ["count"]
  },
  "drivetrains": ["differential", "skid_steer", "ackermann", "mecanum",
    "tracked", "multirotor", "quadruped", "humanoid", "robotic_arm"],
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

/* The document system prompt: a MIRROR of SYSTEM_PROMPT +
 * DOCUMENT_INSTRUCTIONS as composed in src/robotforge/photo.py
 * (transcription of printed values from a spec sheet / datasheet /
 * blueprint — never inference from drawing scale). tests/test_live.py
 * asserts the two are byte-identical. */
// BEGIN document prompt mirror
const DOC_SYSTEM_PROMPT = /*DOC_PROMPT_BEGIN*/`You convert a plain-language robot description into a strict JSON
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
You are now looking at a DOCUMENT (attached as an image): a photo or scan
of a spec sheet, datasheet or blueprint. Your job is TRANSCRIPTION, not
estimation: read the values the document PRINTS and carry them into the
draft exactly. Do not work from the appearance or proportions of anything
in the image — there may be no robot in it at all.

Output ONLY one JSON object with exactly these keys:
- "identity_guess": the robot or product the document describes, as
  printed (e.g. "TurtleBot3 Burger"), or "unknown document" if the
  document does not name it.
- "values": a list of {"label": ..., "printed": ..., "field": ...} —
  one entry for EVERY value you transcribe: "label" is the document's
  own label ("Overall length"), "printed" is the value exactly as
  printed, with its unit ("178 mm"), and "field" is the spec field it
  fills, as a dotted path ("length_m", "wheel.diameter_m",
  "battery.capacity_mah"). Use ONLY these field paths: name,
  description, drivetrain, length_m, width_m, height_m, mass_kg,
  ground_clearance_m, wheel.diameter_m, wheel.width_m, wheel.count,
  motor.kind, motor.voltage_v, motor.count, motor.stall_torque_nm,
  battery.chemistry, battery.voltage_v, battery.capacity_mah, and for
  sensors: sensors.kind, sensors.position, sensors.range_m.
- "spec": the robot specification object in the field format described
  above, built ONLY from the values you transcribed.

Hard rules:
- Transcribe ONLY printed values. A number you cannot read in the
  document does not go in the draft: no typical values, no values from
  memory of a similar product, no completing the table. This overrides
  any instruction above about filling in realistic values for omissions.
- NEVER infer a dimension from drawing scale, proportions, or the size
  of anything in the image. If a blueprint dimension is not printed as
  a callout, it is absent, even if the drawing looks measurable.
- A value that is not printed stays ABSENT: leave the field out of the
  spec entirely. A partial spec is a correct answer for a partial
  document.
- Units: keep the printed unit in "values". In the spec, convert to
  metres / volts / kilograms ONLY when the printed unit is explicit
  (178 mm becomes 0.178 in length_m; 1800 mAh stays 1800 in
  battery.capacity_mah). If a printed value carries no unit, leave it
  out of the spec and note that in the "description".
- Prefix the spec "description" with "Document draft (values
  transcribed from the document): " and mention anything you could not
  read or had to leave out.
`/*DOC_PROMPT_END*/;
// END document prompt mirror

/* The parts catalogue the /list prompt matches against: id + name for
 * every part in catalog/parts.json, mirrored here (tests/test_live.py
 * asserts this list matches the catalogue exactly). */
// BEGIN catalogue parts mirror
const CATALOG_PARTS = /*PARTS_BEGIN*/[{"id": "lipo_4s_5200", "name": "LiPo battery 4S 5200 mAh"}, {"id": "lipo_4s_1500", "name": "LiPo battery 4S 1500 mAh (5-inch quad)"}, {"id": "lipo_3s_2200", "name": "LiPo battery 3S 2200 mAh"}, {"id": "buck_converter_5v", "name": "Buck converter 5 V / 5 A"}, {"id": "lipo_balance_charger", "name": "LiPo balance charger"}, {"id": "xt60_pigtail", "name": "XT60 pigtail lead"}, {"id": "silicone_wire_14awg", "name": "Silicone wire 14 AWG (per metre)"}, {"id": "driver_tb6612fng", "name": "TB6612FNG dual motor driver"}, {"id": "driver_l298n", "name": "L298N dual motor driver module"}, {"id": "esc_4in1_45a", "name": "4-in-1 ESC 45 A (BLHeli_S class)"}, {"id": "esc_quicrun_1060", "name": "Brushed ESC 60 A (QuicRun 1060 class)"}, {"id": "esp32_devkit", "name": "ESP32 development board"}, {"id": "teensy_41", "name": "Teensy 4.1"}, {"id": "pico_rp2040", "name": "Raspberry Pi Pico (RP2040)"}, {"id": "raspberry_pi_5", "name": "Raspberry Pi 5"}, {"id": "jetson_orin_nano", "name": "NVIDIA Jetson Orin Nano"}, {"id": "microsd_128gb", "name": "microSD card 128 GB (A2/V30)"}, {"id": "sik_telemetry_v3", "name": "SiK telemetry radio pair (915 MHz)"}, {"id": "elrs_receiver", "name": "ExpressLRS receiver"}, {"id": "realsense_d435", "name": "Intel RealSense D435 depth camera"}, {"id": "rplidar_a1", "name": "RPLIDAR A1 2D lidar"}, {"id": "imu_bno055", "name": "BNO055 9-DOF IMU breakout"}, {"id": "ultrasonic_hcsr04", "name": "HC-SR04 ultrasonic ranger"}, {"id": "pla_filament", "name": "PLA filament 1.75 mm, 1 kg"}, {"id": "petg_filament", "name": "PETG filament 1.75 mm, 1 kg"}, {"id": "fuse_inline", "name": "Inline blade fuse holder + fuse"}, {"id": "estop_button", "name": "Emergency stop button (latching)"}, {"id": "bms_4s", "name": "BMS protection board 4S 40 A"}, {"id": "custom_pcb_kicad", "name": "Custom PCB (KiCad import)"}, {"id": "gearmotor_12v", "name": "DC gearmotor 12 V (37 mm class)"}, {"id": "brushed_motor_540", "name": "Brushed motor 540 size"}, {"id": "servo_mg996r", "name": "MG996R servo"}, {"id": "servo_sts3215", "name": "STS3215 serial bus servo (Feetech)"}, {"id": "stepper_nema17", "name": "Stepper motor NEMA 17"}, {"id": "brushless_2207_1960kv", "name": "Brushless motor 2207 1960 KV"}, {"id": "wheel_100mm", "name": "Wheel 100 mm diameter"}, {"id": "mecanum_wheel_100mm", "name": "Mecanum wheel 100 mm"}, {"id": "caster_ball", "name": "Ball caster"}, {"id": "propeller_5040", "name": "Propeller 5x4.0x3 tri-blade"}, {"id": "fc_f405_stack", "name": "Flight controller stack F405"}, {"id": "gripper_2finger", "name": "2-finger parallel gripper kit"}, {"id": "quad_frame_5inch", "name": "Quadcopter frame 5 inch (carbon)"}, {"id": "extrusion_2020", "name": "Aluminium extrusion 2020 (per metre)"}, {"id": "chassis_plate", "name": "Chassis plate (3D-printed)"}, {"id": "motor_mount", "name": "Motor mount bracket (3D-printed)"}, {"id": "lidar_mount", "name": "Lidar mount post (3D-printed)"}, {"id": "camera_bracket", "name": "Camera bracket (3D-printed)"}, {"id": "ultrasonic_bracket", "name": "Ultrasonic bracket (3D-printed)"}, {"id": "camera_rpi_v2", "name": "Raspberry Pi Camera Module V2 (8 MP)"}, {"id": "liion_18650_3s", "name": "18650 Li-ion pack 3S (3 cells)"}]/*PARTS_END*/;
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

async function callModelOn(url, apiKey, model, label, messages, temperature, maxTokens) {
  const payload = await postChatCompletions(url, apiKey, {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  }, label);
  return messageContent(payload);
}

/* A request may pin a single provider (measurement sweeps through
 * the production endpoint). Anything else is ignored. */
function providerOnly(data) {
  const p = data && data.provider;
  return (p === 'baseten' || p === 'meta' || p === 'fireworks') ? p : undefined;
}

/* Text routes run a three-provider chain in the order the fixed
 * 24-description sweep measured (Oct 2026): Baseten / Muse Spark
 * Open 24/24, Meta Model API direct / hosted muse-spark-1.3 23/24,
 * Fireworks / Muse Spark Open 21/24 (re-measured 18/24). An attempt
 * runs only when its key is set (and, when a provider is pinned,
 * only that one). Returns { content, model } with the model that
 * ACTUALLY answered — the Meta attempt serves a different model
 * than the other two, so callers report it verbatim. Worst case is
 * three slow upstreams in sequence (each bounded by
 * UPSTREAM_TIMEOUT_MS); the common outage mode (fast 5xx / refused)
 * fails over in seconds. */
async function callModel(env, messages, temperature, maxTokens, only) {
  const attempts = [];
  if (env.BASETEN_API_KEY && (!only || only === 'baseten')) {
    attempts.push(async () => ({ content: await callModelOn(BASETEN_URL,
      env.BASETEN_API_KEY, MODEL, 'Baseten', messages, temperature,
      maxTokens), model: MODEL }));
  }
  if (env.META_API_KEY && (!only || only === 'meta')) {
    attempts.push(async () => ({ content: await callModelOn(META_URL,
      env.META_API_KEY, META_TEXT_MODEL, 'Meta', messages, temperature,
      maxTokens), model: META_TEXT_MODEL }));
  }
  if (env.FIREWORKS_API_KEY && (!only || only === 'fireworks')) {
    attempts.push(async () => ({ content: await callModelOn(FIREWORKS_URL,
      env.FIREWORKS_API_KEY, FIREWORKS_MODEL, 'Fireworks', messages,
      temperature, maxTokens), model: MODEL }));
  }
  let lastError = new Error('no model provider is configured');
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

/* One Meta Model API vision call. mode 'photo' mirrors photo.py's
 * draft_spec_from_photo (ESTIMATED draft); mode 'document' mirrors
 * draft_spec_from_document (TRANSCRIBED draft from printed values). */
async function callMetaVision(env, imageDataUrl, note, mode) {
  const doc = mode === 'document';
  const payload = await postChatCompletions(META_URL, env.META_API_KEY, {
    model: PHOTO_MODEL,
    messages: [
      { role: 'system', content: doc ? DOC_SYSTEM_PROMPT : PHOTO_SYSTEM_PROMPT },
      { role: 'user', content: [
        { type: 'text',
          text: (doc
            ? 'Transcribe the printed specification values in this ' +
              'document into a robot specification draft.'
            : 'Draft a robot specification from this photo.') +
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
  /* Class requirements, as in schema.py: the ground drivetrains
   * need wheels + ground clearance; the other classes declare their
   * own blocks (rotors / legs / arms) instead. */
  const extraTop =
    (SPEC_SCHEMA.ground_drivetrains.includes(spec.drivetrain)
      ? SPEC_SCHEMA.ground_required_top
      : SPEC_SCHEMA.class_required_top[spec.drivetrain]) || [];
  for (const k of extraTop) {
    if (!(k in spec)) return 'missing field: ' + k;
  }
  const requiredObjs = new Set(['motor', 'battery', ...extraTop]);
  for (const [obj, keys] of Object.entries(SPEC_SCHEMA.required_nested)) {
    if (!(obj in spec)) {
      if (requiredObjs.has(obj)) return obj + ' is not an object';
      continue;
    }
    if (typeof spec[obj] !== 'object' || spec[obj] === null) {
      return obj + ' is not an object';
    }
    for (const k of keys) {
      if (!(k in spec[obj])) return 'missing field: ' + obj + '.' + k;
    }
  }
  for (const k of ['length_m', 'width_m', 'height_m', 'mass_kg']) {
    if (typeof spec[k] !== 'number' || !Number.isFinite(spec[k])) {
      return k + ' is not a number';
    }
  }
  if ('ground_clearance_m' in spec &&
      (typeof spec.ground_clearance_m !== 'number' ||
       !Number.isFinite(spec.ground_clearance_m))) {
    return 'ground_clearance_m is not a number';
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

/* Document drafts may be PARTIAL on purpose (a value the document
 * does not print stays absent), so the document path validates only
 * what is present: types of present fields and the enums. */
function validateSpecPartial(spec) {
  if (typeof spec !== 'object' || spec === null || Array.isArray(spec)) {
    return 'the reply is not a JSON object';
  }
  for (const k of ['length_m', 'width_m', 'height_m', 'mass_kg',
                   'ground_clearance_m']) {
    if (k in spec && (typeof spec[k] !== 'number' ||
        !Number.isFinite(spec[k]))) {
      return k + ' is not a number';
    }
  }
  if ('drivetrain' in spec &&
      !SPEC_SCHEMA.drivetrains.includes(spec.drivetrain)) {
    return 'unknown drivetrain: ' + String(spec.drivetrain);
  }
  const nestedNums = {
    wheel: ['diameter_m', 'width_m', 'count'],
    motor: ['voltage_v', 'count', 'stall_torque_nm'],
    battery: ['voltage_v', 'capacity_mah'],
    rotors: ['count', 'prop_diameter_m'],
    legs: ['count', 'segments'],
    arms: ['count', 'segments'],
  };
  for (const [obj, keys] of Object.entries(nestedNums)) {
    if (!(obj in spec)) continue;
    if (typeof spec[obj] !== 'object' || spec[obj] === null) {
      return obj + ' is not an object';
    }
    for (const k of keys) {
      if (k in spec[obj] && spec[obj][k] !== null &&
          (typeof spec[obj][k] !== 'number' ||
           !Number.isFinite(spec[obj][k]))) {
        return obj + '.' + k + ' is not a number';
      }
    }
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
  if (!env.BASETEN_API_KEY && !env.FIREWORKS_API_KEY && !env.META_API_KEY) {
    return err(request, 500, 'not_configured',
      'The endpoint has no model provider key configured (see live/README.md).');
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
  let model = MODEL;
  try {
    ({ content, model } = await callModel(env, [
      { role: 'system', content: DESCRIBE_SYSTEM_PROMPT },
      { role: 'user', content: description },
    ], 0.2, 4000, providerOnly(data)));
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
  return json(request, 200, { spec, model });
}

/* Tier-1 operator mode for /chat: when the client sends op_context, the
 * model acts as a TRANSLATOR from a free-form operation request into ONE
 * command in the app's built-in command grammar. The worker only ever
 * returns the command as text — the client runs it through the same
 * validators, preview card and Apply tap as a typed command, so a bad or
 * stale proposal changes nothing. Without op_context, /chat is unchanged. */
const OP_SYSTEM_PROMPT = `You translate a RobotForge user's operation request into ONE command in the app's command grammar, using ONLY the robots, fields, components and inventory parts listed in the context JSON the user message carries.

Output ONLY a JSON object, no prose, no markdown fences:
{"answer": "<one short sentence: what the command does, or why no command fits>", "command": "<one command>" or null}

Grammar (match it exactly; robot names in double quotes):
- set "<RobotName>" <field.path> to <value>   — spec edit. Values use SPEC UNITS: metres, kilograms, volts, mAh. Convert what the user said (120 mm diameter -> wheel.diameter_m to 0.12; 2 lb -> mass_kg to 0.907). Text/select fields take the bare word.
- add a <component name> to "<RobotName>"
- move "<component>" on "<RobotName>" to <x> <y> <z> mm   — positions stay in millimetres; append "yaw <degrees>" only if the user gave a rotation.
- connect "<component A>" to "<component B>" on "<RobotName>"
- remove "<component>" from "<RobotName>"
- set inventory "<PartName>" quantity to <whole number>
- assign inventory "<PartName>" to "<RobotName>"

Rules:
- Only use robot names, field paths, component names and part names from the context. If the request names something not in the context, or is not an operation you can express in this grammar, set "command": null and say why in "answer".
- Never invent a robot, field, component or part. Never claim the change has been applied — the user still reviews and applies it in the app.
- One command only. If the request needs two changes, translate the first and say so in "answer".`;

function sanitizeOpContext(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const list = (v, cap, len) => Array.isArray(v)
    ? v.filter((x) => typeof x === 'string' && x.trim()).slice(0, cap).map((x) => x.slice(0, len))
    : [];
  const ctx = {
    robots: list(raw.robots, 50, 120),
    fields: list(raw.fields, 40, 80),
    components: list(raw.components, 120, 120),
    inventory: list(raw.inventory, 100, 120),
  };
  return ctx.robots.length || ctx.inventory.length ? ctx : null;
}

/* Parse a Tier-1 model reply: a JSON object with a string answer and a
 * string-or-null command. Anything else returns null and the caller
 * falls back to treating the reply as a plain answer. */
function parseOpReply(content) {
  try {
    const parsed = JSON.parse(stripFences(content));
    if (!parsed || typeof parsed !== 'object' || typeof parsed.answer !== 'string') return null;
    const command = typeof parsed.command === 'string' && parsed.command.trim()
      ? parsed.command.trim().slice(0, 300) : null;
    return { answer: parsed.answer.trim(), command };
  } catch {
    return null;
  }
}

async function handleChat(request, env) {
  if (!env.BASETEN_API_KEY && !env.FIREWORKS_API_KEY && !env.META_API_KEY) {
    return err(request, 500, 'not_configured',
      'The endpoint has no model provider key configured (see live/README.md).');
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
  const opContext = sanitizeOpContext(data && data.op_context);
  let content;
  let model = MODEL;
  try {
    ({ content, model } = await callModel(env, opContext ? [
      { role: 'system', content: OP_SYSTEM_PROMPT },
      { role: 'user', content: 'Context: ' + JSON.stringify(opContext) + '\nRequest: ' + message },
    ] : [
      { role: 'system', content: CHAT_SYSTEM_PROMPT },
      { role: 'user', content: message },
    ], opContext ? 0.1 : 0.4, 2000, providerOnly(data)));
  } catch (e) {
    return err(request, 502, 'upstream_error',
      'The model call failed (' + e.message + '). The recorded answers still work.');
  }
  if (opContext) {
    const op = parseOpReply(content);
    if (op) return json(request, 200, { answer: op.answer, command: op.command, model });
    return json(request, 200, { answer: content.trim(), command: null, model });
  }
  return json(request, 200, { answer: content.trim(), model });
}

const ESTIMATED_PREFIX = 'Photo draft (all dimensions ESTIMATED): ';
const DOCUMENT_PREFIX =
  'Document draft (values transcribed from the document): ';

/* Document mode's result shaping — mirrors photo.py's
 * parse_document_payload enforcement: the DOCUMENT banner prefix is
 * mandatory, and a numeric spec value with no transcribed values[]
 * entry behind it is DROPPED (named in `dropped`), never passed
 * through. A partial spec is a valid result here. */
function photoDocumentResult(request, parsed) {
  const problem = validateSpecPartial(parsed.spec);
  if (problem) {
    return err(request, 502, 'bad_model_output',
      'The document draft failed the schema check (' + problem +
      '). Nothing was saved.');
  }
  const spec = parsed.spec;
  if (typeof spec.description !== 'string' ||
      !spec.description.startsWith('Document draft')) {
    spec.description = DOCUMENT_PREFIX +
      (typeof spec.description === 'string' ? spec.description : '');
  }
  const FIELD_ALIASES = {
    wheel_diameter_m: 'wheel.diameter_m',
    wheel_width_m: 'wheel.width_m',
    wheel_count: 'wheel.count',
    motor_voltage_v: 'motor.voltage_v',
    motor_count: 'motor.count',
    motor_stall_torque_nm: 'motor.stall_torque_nm',
    battery_chemistry: 'battery.chemistry',
    battery_voltage_v: 'battery.voltage_v',
    battery_capacity_mah: 'battery.capacity_mah',
  };
  const values = Array.isArray(parsed.values)
    ? parsed.values
        .filter(v => v && typeof v === 'object')
        .map(v => {
          const f = String(v.field || '').slice(0, 80);
          return {
            label: String(v.label || '').slice(0, 120),
            printed: String(v.printed || '').slice(0, 120),
            field: FIELD_ALIASES[f] || f,
          };
        })
        .filter(v => v.field)
    : [];
  const backed = new Set(values.map(v => v.field));
  const dropped = [];
  (function walk(node, path) {
    if (Array.isArray(node)) {
      node.forEach(item => walk(item, path));
      return;
    }
    if (!node || typeof node !== 'object') return;
    for (const k of Object.keys(node)) {
      const p = path ? path + '.' + k : k;
      const v = node[k];
      if (typeof v === 'number') {
        const ok = backed.has(p) || (p.startsWith('component_mass_kg.') &&
          [...backed].some(f => f.startsWith('component_mass_kg')));
        if (!ok) { dropped.push(p); delete node[k]; }
      } else {
        walk(v, p);
      }
    }
  })(spec, '');
  return json(request, 200, {
    draft: {
      spec,
      identity_guess: String(parsed.identity_guess ||
        'unknown document'),
      values,
      dropped,
    },
    document_read: true,
    estimated: false,
    model: PHOTO_MODEL,
  });
}

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
  const mode = data.mode === 'document' ? 'document' : 'photo';
  const gate = await gateBudget(env, request);
  if (gate) return gate;
  let content;
  try {
    content = await callMetaVision(env, image, note, mode);
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
  if (mode === 'document') {
    return photoDocumentResult(request, parsed);
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
    document_read: false,
    model: PHOTO_MODEL,
  });
}

async function handleList(request, env) {
  if (!env.BASETEN_API_KEY && !env.FIREWORKS_API_KEY && !env.META_API_KEY) {
    return err(request, 500, 'not_configured',
      'The endpoint has no model provider key configured (see live/README.md).');
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
  let model = MODEL;
  try {
    ({ content, model } = await callModel(env, [
      { role: 'system', content: LIST_SYSTEM_PROMPT },
      { role: 'user', content: text },
    ], 0.2, 4000, providerOnly(data)));
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
    model,
  });
}

/* ---------------- /fix: the Forge loop's proposer ---------------- */

/* Spec fields the proposer may change. Anything else in a model reply
 * is dropped: the model can tune a design, never restructure it. */
const FIX_FIELDS = {
  'length_m': 'number', 'width_m': 'number', 'height_m': 'number',
  'mass_kg': 'number', 'ground_clearance_m': 'number',
  'wheel.diameter_m': 'number', 'wheel.width_m': 'number',
  'wheel.count': 'integer',
  'motor.voltage_v': 'number', 'motor.count': 'integer',
  'motor.stall_torque_nm': 'number', 'motor.kind': 'string',
  'battery.voltage_v': 'number', 'battery.capacity_mah': 'integer',
  'battery.chemistry': 'string',
};
const FIX_MAX_CHANGES = 6;
const FIX_MAX_FINDINGS = 20;

const FIX_SYSTEM_PROMPT = `You repair a robot specification for RobotForge. You are given the spec as JSON and the engineering validator's findings ("[ERROR] check: message" or "[WARN] ...").

Propose the SMALLEST set of field changes that would resolve the findings while keeping the robot recognisably the same robot. Prefer changing the one field the finding names. Never invent sensors or new parts. Keep values physically realistic.

You may only change these fields: ${Object.keys(FIX_FIELDS).join(', ')}.

Output ONLY a JSON object, no prose, no markdown fences:
{"changes": [{"path": "<field>", "value": <new value>, "reason": "<one short sentence>"}], "summary": "<one or two plain sentences for the robot's owner>"}

You only PROPOSE. The validator re-checks every proposal; you never decide whether the robot passes.`;

function sanitizeChanges(raw, spec) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const c of raw) {
    if (out.length >= FIX_MAX_CHANGES) break;
    if (!c || typeof c !== 'object') continue;
    const path = String(c.path || '');
    const kind = FIX_FIELDS[path];
    if (!kind || seen.has(path)) continue;
    let value = c.value;
    if (kind === 'string') {
      if (typeof value !== 'string' || !value.trim()) continue;
      value = value.trim().slice(0, 60);
    } else {
      value = typeof value === 'string' ? Number(value) : value;
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue;
      if (kind === 'integer') {
        if (!Number.isInteger(value)) continue;
      }
    }
    const [a, b] = path.split('.');
    const before = b === undefined ? spec[a]
      : (spec[a] && typeof spec[a] === 'object' ? spec[a][b] : undefined);
    if (before === value) continue;
    seen.add(path);
    out.push({
      path, value,
      before: before === undefined ? null : before,
      reason: String(c.reason || '').slice(0, 300),
    });
  }
  return out;
}

async function handleFix(request, env) {
  if (!env.BASETEN_API_KEY && !env.FIREWORKS_API_KEY && !env.META_API_KEY) {
    return err(request, 500, 'not_configured',
      'The endpoint has no model provider key configured (see live/README.md).');
  }
  const { data, error } = await readJsonBody(request);
  if (error) return err(request, 413, 'too_large', error);
  const spec = data && data.spec;
  const findings = data && data.findings;
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    return err(request, 400, 'missing_spec', 'Send { "spec": {...}, "findings": [...] }.');
  }
  if (!Array.isArray(findings) || !findings.length) {
    return err(request, 400, 'missing_findings',
      'Send the validator findings to fix as { "findings": ["[ERROR] ..."] }.');
  }
  const lines = findings.slice(0, FIX_MAX_FINDINGS)
    .map(f => String(f).slice(0, 400));
  const gate = await gateBudget(env, request);
  if (gate) return gate;
  let content;
  let model = MODEL;
  try {
    ({ content, model } = await callModel(env, [
      { role: 'system', content: FIX_SYSTEM_PROMPT },
      { role: 'user', content: 'Spec:\n' + JSON.stringify(spec) +
        '\n\nFindings:\n' + lines.join('\n') },
    ], 0.2, 3000, providerOnly(data)));
  } catch (e) {
    return err(request, 502, 'upstream_error',
      'The model call failed (' + e.message + '). Your spec was not changed.');
  }
  let parsed;
  try {
    parsed = JSON.parse(stripFences(content));
  } catch (e) {
    return err(request, 502, 'bad_model_output',
      'The model returned something that is not a fix proposal. Your spec was not changed.');
  }
  const changes = sanitizeChanges(parsed && parsed.changes, spec);
  return json(request, 200, {
    changes,
    summary: String((parsed && parsed.summary) || '').slice(0, 600),
    model,
  });
}

/* ---------------- /part + /part-chat: the parts inventory ---------------- */

const PART_CATEGORIES = ['battery', 'motor', 'motor_driver', 'controller',
  'computer', 'sensor', 'wheel', 'servo', 'power', 'radio', 'frame',
  'cable', 'tool', 'other'];
const PART_SPEC_KEYS = ['voltage_v', 'capacity_mah', 'current_a',
  'stall_torque_nm', 'rpm', 'diameter_mm', 'width_mm', 'mass_g',
  'cells', 'chemistry', 'interface', 'range_m', 'model_number'];

const PART_SYSTEM_PROMPT = `You identify ONE robot part from a photo for a maker's parts inventory. Read printed labels first (model numbers, voltages, capacities); estimate only what you cannot read and say so.

You are given the site's parts catalogue as lines of "id — name". Use a catalogue id only when the part clearly IS that part; otherwise null.

Output ONLY a JSON object, no prose, no markdown fences:
{"name": "<short part name>", "category": one of ${PART_CATEGORIES.join('|')},
 "quantity": <integer, how many identical parts are in the photo>,
 "catalog_part_id": "<id or null>",
 "specs": {<only keys from: ${PART_SPEC_KEYS.join(', ')}>},
 "read_from_label": [<spec keys you READ from printed text>],
 "condition": "<new|used|damaged|unknown>",
 "confidence": "<low|medium|high>",
 "question": "<one short question that would confirm the identification>"}

Catalogue parts:
` + CATALOG_PARTS.map(p => p.id + ' — ' + p.name).join('\n');

const PART_CHAT_SYSTEM_PROMPT = `You help a maker confirm one part in their robot parts inventory. You get the part record as JSON, the conversation so far, and the owner's new message. The owner has the part in their hands, so their statements about it win over the photo-based guess.

Reply briefly and plainly (one to three sentences). If the owner's message corrects or adds facts, include them in "update". Set "confirmed" to true only when the owner has clearly confirmed what the part is.

Output ONLY a JSON object, no prose, no markdown fences:
{"reply": "<your answer>", "update": {<any of: name, category, quantity, condition, specs>} or null, "confirmed": true|false}

Allowed categories: ${PART_CATEGORIES.join('|')}. Allowed spec keys: ${PART_SPEC_KEYS.join(', ')}.`;

function sanitizePartSpecs(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const k of PART_SPEC_KEYS) {
    const v = raw[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'string' && v.trim()) out[k] = v.trim().slice(0, 80);
  }
  return out;
}

function sanitizePart(raw) {
  const ids = new Set(CATALOG_PARTS.map(p => p.id));
  const r = raw && typeof raw === 'object' ? raw : {};
  const specs = sanitizePartSpecs(r.specs);
  const qty = Number(r.quantity);
  return {
    name: String(r.name || 'Unidentified part').slice(0, 120),
    category: PART_CATEGORIES.includes(r.category) ? r.category : 'other',
    quantity: Number.isInteger(qty) && qty > 0 && qty < 1000 ? qty : 1,
    catalog_part_id: ids.has(r.catalog_part_id) ? r.catalog_part_id : null,
    specs,
    read_from_label: Array.isArray(r.read_from_label)
      ? r.read_from_label.filter(k => k in specs) : [],
    condition: ['new', 'used', 'damaged'].includes(r.condition) ? r.condition : 'unknown',
    confidence: ['low', 'medium', 'high'].includes(r.confidence) ? r.confidence : 'low',
    question: String(r.question || '').slice(0, 300),
  };
}

function sanitizePartUpdate(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const u = {};
  if (typeof raw.name === 'string' && raw.name.trim()) u.name = raw.name.trim().slice(0, 120);
  if (PART_CATEGORIES.includes(raw.category)) u.category = raw.category;
  const qty = Number(raw.quantity);
  if (Number.isInteger(qty) && qty > 0 && qty < 1000) u.quantity = qty;
  if (['new', 'used', 'damaged', 'unknown'].includes(raw.condition)) u.condition = raw.condition;
  const specs = sanitizePartSpecs(raw.specs);
  if (Object.keys(specs).length) u.specs = specs;
  return Object.keys(u).length ? u : null;
}

async function handlePart(request, env) {
  if (!env.META_API_KEY) {
    return err(request, 501, 'photo_not_configured',
      'Part photos need the optional Meta key on the endpoint. You can still add the part by hand.');
  }
  const { data, error } = await readJsonBody(request, PHOTO_MAX_BODY_BYTES);
  if (error) return err(request, 413, 'too_large', error);
  const image = data && data.image_data_url;
  if (typeof image !== 'string' || !image.startsWith('data:image/')) {
    return err(request, 400, 'missing_image', 'Send { "image_data_url": "data:image/..." }.');
  }
  const note = typeof data.note === 'string' ? data.note.slice(0, 500) : '';
  const gate = await gateBudget(env, request);
  if (gate) return gate;
  let content;
  try {
    const payload = await postChatCompletions(META_URL, env.META_API_KEY, {
      model: PHOTO_MODEL,
      messages: [
        { role: 'system', content: PART_SYSTEM_PROMPT },
        { role: 'user', content: [
          { type: 'text', text: 'Identify this part.' +
            (note ? ' The owner adds: ' + note : '') },
          { type: 'image_url', image_url: { url: image } },
        ] },
      ],
      temperature: 0.2,
      max_tokens: 1500,
    }, 'The Meta Model API');
    content = messageContent(payload);
  } catch (e) {
    return err(request, 502, 'upstream_error',
      'The photo model call failed (' + e.message + '). Your photo was not stored anywhere.');
  }
  let parsed;
  try {
    parsed = JSON.parse(stripFences(content));
  } catch (e) {
    return err(request, 502, 'bad_model_output',
      'The photo model returned something that is not JSON. Try another photo or add the part by hand.');
  }
  return json(request, 200, { part: sanitizePart(parsed), model: PHOTO_MODEL });
}

/* One Muse Voice Transcribe call. The batch endpoint takes
 * multipart form data: a 'request' JSON part naming the model and
 * audio encoding, and an 'audio' part with the bytes. Verified
 * against the live API 2026-10-31: WAV is accepted; MP3 and WebM
 * containers are rejected as malformed, which is why the SITE
 * encodes WAV (WebAudio decode + PCM encode) and this route only
 * accepts WAV. */
async function handleTranscribe(request, env) {
  /* Same optional-key posture as /photo: no Meta key -> the route
   * is off (501) and the site hides the mic. Not an error state. */
  if (!env.META_API_KEY) {
    return err(request, 501, 'transcribe_not_configured',
      'Voice transcription is not configured on this endpoint (no Meta API key). Typing still works.');
  }
  const { data, error } = await readJsonBody(request, TRANSCRIBE_MAX_BODY_BYTES);
  if (error) return err(request, 413, 'too_large', error);
  const b64 = data && data.audio_b64;
  if (typeof b64 !== 'string' || !b64) {
    return err(request, 400, 'missing_audio',
      'Send { "audio_b64": "<base64 WAV audio>" }.');
  }
  let bytes;
  try {
    const bin = atob(b64.replace(/\s+/g, ''));
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch (e) {
    return err(request, 400, 'bad_audio', 'audio_b64 is not valid base64.');
  }
  if (bytes.length > TRANSCRIBE_MAX_AUDIO_BYTES) {
    return err(request, 413, 'too_large',
      'Audio is over ' + TRANSCRIBE_MAX_AUDIO_BYTES + ' bytes decoded.');
  }
  if (bytes.length < 44 || bytes[0] !== 0x52 || bytes[1] !== 0x49 ||
      bytes[2] !== 0x46 || bytes[3] !== 0x46) {
    return err(request, 400, 'bad_audio',
      'Audio must be a WAV file (the site encodes recordings to WAV).');
  }
  const gate = await gateBudget(env, request);
  if (gate) return gate;
  const form = new FormData();
  form.append('request', new Blob(
    [JSON.stringify({ model: TRANSCRIBE_MODEL, audioEncoding: 'WAV' })],
    { type: 'application/json' }));
  form.append('audio', new Blob([bytes], { type: 'audio/wav' }), 'audio.wav');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
  let payload;
  try {
    const res = await fetch(TRANSCRIBE_URL, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + env.META_API_KEY },
      body: form,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 300);
      throw new Error('The Meta Model API returned HTTP ' + res.status +
        (detail ? ': ' + detail : ''));
    }
    payload = await res.json();
  } catch (e) {
    return err(request, 502, 'upstream_error',
      'The transcription call failed (' + e.message + '). Your audio was not stored anywhere.');
  } finally {
    clearTimeout(timer);
  }
  const transcript = payload && payload.transcript;
  if (typeof transcript !== 'string' || !transcript.trim()) {
    return err(request, 502, 'bad_model_output',
      'The transcription came back empty. Nothing was saved; try again closer to the mic.');
  }
  return json(request, 200, {
    transcript: transcript.trim(),
    model: TRANSCRIBE_MODEL,
    audio_duration_ms: typeof payload.audioDurationMs === 'number'
      ? payload.audioDurationMs : null,
  });
}

async function handlePartChat(request, env) {
  if (!env.BASETEN_API_KEY && !env.FIREWORKS_API_KEY && !env.META_API_KEY) {
    return err(request, 500, 'not_configured',
      'The endpoint has no model provider key configured (see live/README.md).');
  }
  const { data, error } = await readJsonBody(request);
  if (error) return err(request, 413, 'too_large', error);
  const message = data && data.message;
  if (typeof message !== 'string' || !message.trim()) {
    return err(request, 400, 'missing_message', 'Send { "part": {...}, "message": "..." }.');
  }
  if (message.length > CHAT_MAX_CHARS) {
    return err(request, 413, 'too_large', 'Message is over ' + CHAT_MAX_CHARS + ' characters.');
  }
  const part = data.part && typeof data.part === 'object' ? data.part : {};
  const history = Array.isArray(data.history) ? data.history.slice(-8)
    .filter(h => h && (h.role === 'user' || h.role === 'assistant') && typeof h.text === 'string')
    .map(h => ({ role: h.role, content: h.text.slice(0, 600) })) : [];
  const gate = await gateBudget(env, request);
  if (gate) return gate;
  let content;
  let model = MODEL;
  try {
    ({ content, model } = await callModel(env, [
      { role: 'system', content: PART_CHAT_SYSTEM_PROMPT },
      { role: 'user', content: 'Part record:\n' + JSON.stringify(sanitizePart(part)) },
      ...history,
      { role: 'user', content: message },
    ], 0.3, 1500, providerOnly(data)));
  } catch (e) {
    return err(request, 502, 'upstream_error',
      'The model call failed (' + e.message + '). Your inventory was not changed.');
  }
  let parsed;
  try {
    parsed = JSON.parse(stripFences(content));
  } catch (e) {
    /* A plain-text answer is still an answer; it just changes nothing. */
    return json(request, 200, { reply: content.trim().slice(0, 1200), update: null,
      confirmed: false, model });
  }
  return json(request, 200, {
    reply: String(parsed.reply || '').slice(0, 1200),
    update: sanitizePartUpdate(parsed.update),
    confirmed: parsed.confirmed === true,
    model,
  });
}

/* ---------------- accounts (auth) ----------------
 * Identity + role only (v1): an account does NOT sync robots or
 * inventory — those stay in the visitor's browser (localStorage).
 * There is no email verification and no password reset in v1.
 *
 * Users live in the same KV as the budget counters:
 *   auth:user:<email-lowercase> -> { email, name, passHash, role,
 *     provider, providerId, createdAt }
 * providerId is the creating provider's stable user id (Meta id,
 * GitHub numeric id, Google sub); password accounts have none.
 * Because the store is keyed by email, a social login may only
 * find-or-create on an email the provider has VERIFIED (GitHub:
 * the primary + verified address from /user/emails; Google:
 * email_verified from userinfo; Meta: Facebook account email).
 * passHash is "pbkdf2$100000$<salt b64>$<hash b64>" (PBKDF2-HMAC-
 * SHA256 via WebCrypto, per-user salt) or null for social-login
 * accounts, which have no password. Passwords and hashes are never
 * logged and never returned; /admin/users returns public fields
 * only. Sessions are stateless HS256 JWTs signed with the
 * AUTH_JWT_SECRET Worker secret (7-day expiry). Every protected
 * route re-verifies the signature AND the expiry, then re-reads
 * the user record, so a role change applies immediately.
 *
 * The founder address is reserved: it cannot be registered through
 * the public route — only the operator route can seed it. */

const FOUNDER_EMAIL = 'abelxmendoza@gmail.com';
const SITE_HOME = 'https://robot-forge-hackathon.vercel.app';
const AUTH_JWT_TTL_SECONDS = 7 * 24 * 3600;
const PBKDF2_ITERATIONS = 100000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const textEnc = new TextEncoder();
const textDec = new TextDecoder();

function authConfigured(env) {
  return Boolean(env.AUTH_JWT_SECRET && env.RF_LIVE_KV);
}

function metaConfigured(env) {
  return oauthConfigured('meta', env);
}

/* ---------------- social login (OAuth) ----------------
 * One flow skeleton for every provider: mint a single-use state
 * nonce in KV, 302 to the provider, exchange the returned code,
 * fetch the profile, find-or-create the user by VERIFIED email,
 * and 302 back to the site with a session JWT in the fragment.
 * Only the endpoints, scopes and profile shapes differ; those
 * live in OAUTH_PROVIDERS. A provider whose two secrets are not
 * set is cleanly absent (501 on its routes, false in /auth/config
 * and /health) — it never half-works. */

async function oauthTokenPost(url, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams(params).toString(),
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return data && data.access_token ? data.access_token : null;
}

async function exchangeMetaCode(env, code, redirectUri) {
  return oauthTokenPost('https://graph.facebook.com/v21.0/oauth/access_token', {
    client_id: env.META_APP_ID, client_secret: env.META_APP_SECRET,
    redirect_uri: redirectUri, code,
  });
}

async function fetchMetaProfile(accessToken) {
  const res = await fetch('https://graph.facebook.com/me?fields=id,name,email&access_token=' +
    encodeURIComponent(accessToken));
  if (!res.ok) return null;
  const me = await res.json().catch(() => null);
  if (!me) return null;
  /* Facebook account emails are verified by Facebook itself. */
  return {
    providerId: String(me.id || ''), name: String(me.name || ''),
    email: cleanEmail(me.email),
  };
}

async function exchangeGithubCode(env, code, redirectUri) {
  return oauthTokenPost('https://github.com/login/oauth/access_token', {
    client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET,
    redirect_uri: redirectUri, code,
  });
}

async function fetchGithubProfile(accessToken) {
  const headers = {
    Authorization: 'Bearer ' + accessToken,
    Accept: 'application/vnd.github+json',
  };
  const res = await fetch('https://api.github.com/user', { headers });
  if (!res.ok) return null;
  const me = await res.json().catch(() => null);
  if (!me) return null;
  /* The profile email can be null (a hidden address) or public
   * but unverified, so it is never trusted: the only address an
   * account may be keyed on is the primary VERIFIED one from
   * /user/emails (the user:email scope is what unlocks that call). */
  const emailsRes = await fetch('https://api.github.com/user/emails', { headers });
  if (!emailsRes.ok) return null;
  const emails = await emailsRes.json().catch(() => null);
  if (!Array.isArray(emails)) return null;
  const primary = emails.find((e) => e && e.primary && e.verified);
  if (!primary) return null;
  return {
    providerId: String(me.id || ''),
    name: String(me.name || me.login || ''),
    email: cleanEmail(primary.email),
  };
}

async function exchangeGoogleCode(env, code, redirectUri) {
  return oauthTokenPost('https://oauth2.googleapis.com/token', {
    client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri: redirectUri, code, grant_type: 'authorization_code',
  });
}

async function fetchGoogleProfile(accessToken) {
  const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: 'Bearer ' + accessToken },
  });
  if (!res.ok) return null;
  const me = await res.json().catch(() => null);
  /* An unverified Google email must never key an account. */
  if (!me || me.email_verified !== true) return null;
  return {
    providerId: String(me.sub || ''), name: String(me.name || ''),
    email: cleanEmail(me.email),
  };
}

const OAUTH_PROVIDERS = {
  meta: {
    label: 'Meta',
    idEnv: 'META_APP_ID', secretEnv: 'META_APP_SECRET',
    authorizeUrl: 'https://www.facebook.com/dialog/oauth',
    scope: 'email,public_profile',
    exchange: exchangeMetaCode, profile: fetchMetaProfile,
  },
  github: {
    label: 'GitHub',
    idEnv: 'GITHUB_CLIENT_ID', secretEnv: 'GITHUB_CLIENT_SECRET',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    scope: 'read:user user:email',
    exchange: exchangeGithubCode, profile: fetchGithubProfile,
  },
  google: {
    label: 'Google',
    idEnv: 'GOOGLE_CLIENT_ID', secretEnv: 'GOOGLE_CLIENT_SECRET',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    scope: 'openid email profile',
    exchange: exchangeGoogleCode, profile: fetchGoogleProfile,
  },
};

function oauthConfigured(id, env) {
  const p = OAUTH_PROVIDERS[id];
  return Boolean(p && env[p.idEnv] && env[p.secretEnv]);
}

function bytesToB64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function b64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function bytesToB64Url(bytes) {
  return bytesToB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64UrlToBytes(text) {
  let s = String(text).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return b64ToBytes(s);
}

function timingSafeEqualStr(a, b) {
  const x = textEnc.encode(String(a));
  const y = textEnc.encode(String(b));
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

async function pbkdf2(password, saltBytes, iterations = PBKDF2_ITERATIONS) {
  const key = await crypto.subtle.importKey(
    'raw', textEnc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' }, key, 256);
  return new Uint8Array(bits);
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToB64(salt)}$${bytesToB64(hash)}`;
}

async function verifyPassword(password, stored) {
  if (!stored) return false;
  const parts = String(stored).split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = parseInt(parts[1], 10) || PBKDF2_ITERATIONS;
  let salt;
  try { salt = b64ToBytes(parts[2]); } catch (e) { return false; }
  const actual = bytesToB64(await pbkdf2(password, salt, iterations));
  return timingSafeEqualStr(actual, parts[3]);
}

async function jwtKey(env) {
  return crypto.subtle.importKey('raw', textEnc.encode(env.AUTH_JWT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function signSession(env, user) {
  const now = Math.floor(Date.now() / 1000);
  const head = bytesToB64Url(textEnc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = bytesToB64Url(textEnc.encode(JSON.stringify(
    { sub: user.email, role: user.role, iat: now, exp: now + AUTH_JWT_TTL_SECONDS })));
  const data = head + '.' + body;
  const sig = await crypto.subtle.sign('HMAC', await jwtKey(env), textEnc.encode(data));
  return data + '.' + bytesToB64Url(new Uint8Array(sig));
}

async function verifySession(env, token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await jwtKey(env),
      b64UrlToBytes(parts[2]), textEnc.encode(parts[0] + '.' + parts[1]));
    if (!ok) return null;
    const payload = JSON.parse(textDec.decode(b64UrlToBytes(parts[1])));
    if (!payload.sub || !payload.exp) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

function userKey(email) { return 'auth:user:' + email; }

async function getUser(env, email) {
  const raw = await env.RF_LIVE_KV.get(userKey(email));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

async function putUser(env, user) {
  await env.RF_LIVE_KV.put(userKey(user.email), JSON.stringify(user));
}

/* The only user shape that ever leaves this Worker: no hash, ever. */
function publicUser(u) {
  return {
    email: u.email, name: u.name || '', role: u.role,
    provider: u.provider || 'password',
    ...(u.providerId ? { providerId: u.providerId } : {}),
    createdAt: u.createdAt,
  };
}

function cleanEmail(value) {
  return String(value || '').trim().toLowerCase().slice(0, 254);
}

async function sessionUser(request, env) {
  const header = request.headers.get('Authorization') || '';
  if (!header.startsWith('Bearer ')) return null;
  const payload = await verifySession(env, header.slice(7).trim());
  if (!payload) return null;
  return getUser(env, payload.sub);
}

function authOff(request) {
  return err(request, 503, 'auth_not_configured',
    'Accounts are not switched on at the endpoint yet.');
}

async function handleAuthRegister(request, env) {
  if (!authConfigured(env)) return authOff(request);
  const { data, error } = await readJsonBody(request, MAX_BODY_BYTES);
  if (error) return err(request, 400, 'bad_request', error);
  const email = cleanEmail(data.email);
  const password = String(data.password || '');
  const name = String(data.name || '').trim().slice(0, 80);
  if (!EMAIL_RE.test(email)) {
    return err(request, 400, 'bad_email', 'That email address does not look right.');
  }
  if (password.length < 8) {
    return err(request, 400, 'weak_password', 'Password must be at least 8 characters.');
  }
  if (password.length > 200) {
    return err(request, 400, 'weak_password', 'Password is too long.');
  }
  if (email === FOUNDER_EMAIL) {
    return err(request, 403, 'reserved_email',
      'This address is reserved for the founder account and cannot be registered here.');
  }
  if (await getUser(env, email)) {
    return err(request, 409, 'already_registered',
      'An account with this email already exists — sign in instead.');
  }
  const user = {
    email, name: name || email.split('@')[0],
    passHash: await hashPassword(password),
    role: 'user', provider: 'password', createdAt: new Date().toISOString(),
  };
  await putUser(env, user);
  const token = await signSession(env, user);
  return json(request, 201, { token, user: publicUser(user) });
}

async function handleAuthLogin(request, env) {
  if (!authConfigured(env)) return authOff(request);
  const { data, error } = await readJsonBody(request, MAX_BODY_BYTES);
  if (error) return err(request, 400, 'bad_request', error);
  const email = cleanEmail(data.email);
  const password = String(data.password || '');
  const user = email ? await getUser(env, email) : null;
  let ok = false;
  if (user && user.passHash) {
    ok = await verifyPassword(password, user.passHash);
  } else {
    /* Unknown or passwordless (Meta) account: still pay the PBKDF2
     * cost so the response time does not say which case it was. */
    await pbkdf2(password || 'x', new Uint8Array(16));
  }
  if (!user || !ok) {
    return err(request, 401, 'bad_credentials', 'Invalid email or password.');
  }
  const token = await signSession(env, user);
  return json(request, 200, { token, user: publicUser(user) });
}

async function handleAuthMe(request, env) {
  if (!authConfigured(env)) return authOff(request);
  const user = await sessionUser(request, env);
  if (!user) return err(request, 401, 'unauthorized', 'Sign in first.');
  return json(request, 200, { user: publicUser(user) });
}

function handleAuthLogout(request) {
  /* Stateless sessions: logging out is the client dropping the token. */
  return json(request, 200, { ok: true });
}

function handleAuthConfig(request, env) {
  const providers = {};
  for (const id of Object.keys(OAUTH_PROVIDERS)) {
    providers[id] = oauthConfigured(id, env);
  }
  /* metaLogin stays as the top-level alias the site first shipped
   * with; providers is the full picture. */
  return json(request, 200, { metaLogin: providers.meta, providers });
}

function oauthRedirectUri(request, id) {
  return new URL(request.url).origin + '/auth/' + id + '/callback';
}

function oauthNotConfigured(request, id) {
  const p = OAUTH_PROVIDERS[id];
  return err(request, 501, id + '_not_configured',
    p.label + ' login is not configured yet — the founder still needs to ' +
    'create the ' + p.label + ' app and add its secrets.');
}

async function handleOAuthStart(id, request, env) {
  if (!oauthConfigured(id, env)) return oauthNotConfigured(request, id);
  const p = OAUTH_PROVIDERS[id];
  const state = bytesToB64Url(crypto.getRandomValues(new Uint8Array(16)));
  if (env.RF_LIVE_KV) {
    /* The nonce remembers which provider minted it, so a state
     * from one provider's flow cannot be replayed at another's
     * callback. */
    await env.RF_LIVE_KV.put('auth:state:' + state, id, { expirationTtl: 600 });
  }
  const q = new URLSearchParams({
    client_id: env[p.idEnv],
    redirect_uri: oauthRedirectUri(request, id),
    scope: p.scope, state, response_type: 'code',
  });
  return new Response(null, {
    status: 302,
    headers: { Location: p.authorizeUrl + '?' + q.toString() },
  });
}

async function handleOAuthCallback(id, request, env) {
  const p = OAUTH_PROVIDERS[id];
  const fail = () => new Response(null, {
    status: 302,
    headers: { Location: SITE_HOME + '/#auth_error=' + id + '_login_failed' },
  });
  if (!oauthConfigured(id, env)) return oauthNotConfigured(request, id);
  if (!authConfigured(env)) return authOff(request);
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) return fail();
  const stateKey = 'auth:state:' + state;
  if ((await env.RF_LIVE_KV.get(stateKey)) !== id) return fail();
  await env.RF_LIVE_KV.delete(stateKey);
  try {
    const accessToken = await p.exchange(env, code, oauthRedirectUri(request, id));
    if (!accessToken) return fail();
    const profile = await p.profile(accessToken);
    if (!profile) return fail();
    const email = cleanEmail(profile.email);
    if (!EMAIL_RE.test(email)) return fail();
    let user = await getUser(env, email);
    if (!user) {
      user = {
        email, name: String(profile.name || '').trim().slice(0, 80) || email.split('@')[0],
        passHash: null,
        role: email === FOUNDER_EMAIL ? 'founder' : 'user',
        provider: id, providerId: profile.providerId || '',
        createdAt: new Date().toISOString(),
      };
      await putUser(env, user);
    }
    const token = await signSession(env, user);
    return new Response(null, {
      status: 302,
      headers: { Location: SITE_HOME + '/#auth=' + token },
    });
  } catch (e) {
    return fail();
  }
}

/* ---------------- operator (admin) routes ----------------
 * Guarded by the OPERATOR_TOKEN Worker secret, sent as the
 * X-Operator-Token header. This is how Muse administers
 * accounts from the owner's machines: list users, seed the
 * founder, grant roles. */

function operatorAuthorized(request, env) {
  const provided = request.headers.get('X-Operator-Token') || '';
  return Boolean(env.OPERATOR_TOKEN) && provided.length > 0 &&
    timingSafeEqualStr(provided, String(env.OPERATOR_TOKEN));
}

function operatorOff(request) {
  return err(request, 401, 'unauthorized', 'Operator token required.');
}

async function handleAdminUsers(request, env) {
  if (!operatorAuthorized(request, env)) return operatorOff(request);
  if (!env.RF_LIVE_KV) return authOff(request);
  const users = [];
  let cursor;
  do {
    const page = await env.RF_LIVE_KV.list({ prefix: 'auth:user:', cursor, limit: 256 });
    for (const k of page.keys) {
      const u = await getUser(env, k.name.slice('auth:user:'.length));
      if (u) users.push(publicUser(u));
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor && users.length < 1000);
  users.sort((a, b) => a.email.localeCompare(b.email));
  return json(request, 200, { users, count: users.length });
}

async function handleAdminSeedFounder(request, env) {
  if (!operatorAuthorized(request, env)) return operatorOff(request);
  if (!authConfigured(env)) return authOff(request);
  const { data, error } = await readJsonBody(request, MAX_BODY_BYTES);
  if (error) return err(request, 400, 'bad_request', error);
  const password = String(data.password || '');
  if (password.length < 8 || password.length > 200) {
    return err(request, 400, 'weak_password',
      'Founder password must be between 8 and 200 characters.');
  }
  const existing = await getUser(env, FOUNDER_EMAIL);
  const user = {
    email: FOUNDER_EMAIL,
    name: (existing && existing.name) || 'Abel Mendoza',
    passHash: await hashPassword(password),
    role: 'founder',
    provider: (existing && existing.provider) || 'password',
    providerId: (existing && existing.providerId) || '',
    createdAt: (existing && existing.createdAt) || new Date().toISOString(),
  };
  await putUser(env, user);
  return json(request, 200, { ok: true, user: publicUser(user) });
}

async function handleAdminGrantRole(request, env) {
  if (!operatorAuthorized(request, env)) return operatorOff(request);
  if (!authConfigured(env)) return authOff(request);
  const { data, error } = await readJsonBody(request, MAX_BODY_BYTES);
  if (error) return err(request, 400, 'bad_request', error);
  const email = cleanEmail(data.email);
  const role = String(data.role || '');
  if (!['user', 'admin', 'founder'].includes(role)) {
    return err(request, 400, 'bad_role', 'Role must be "user", "admin" or "founder".');
  }
  const user = await getUser(env, email);
  if (!user) return err(request, 404, 'no_such_user', 'No account with that email.');
  user.role = role;
  await putUser(env, user);
  return json(request, 200, { ok: true, user: publicUser(user) });
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
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Operator-Token',
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
    const fireworks = Boolean(env.FIREWORKS_API_KEY);
    const textProvider = baseten || fireworks || Boolean(env.META_API_KEY);
    return json(request, 200, {
      ok: true,
      mode: String(env.LIVE_ENABLED ?? '1') === '0' ? 'off' : 'live',
      configured: textProvider,
      kv: Boolean(env.RF_LIVE_KV),
      budget,
      /* Which providers hold keys: the text routes run the
       * Baseten -> Meta -> Fireworks chain (any one key lights
       * them); photo/part/transcribe need the Meta key. */
      providers: { baseten, fireworks, meta: Boolean(env.META_API_KEY) },
      /* Accounts: on when the JWT secret + KV exist. Each social
       * login stays off until the founder adds that provider's
       * app secrets. */
      auth: authConfigured(env),
      metaLogin: metaConfigured(env),
      githubLogin: oauthConfigured('github', env),
      googleLogin: oauthConfigured('google', env),
      routes: {
        describe: textProvider, chat: textProvider, list: textProvider,
        fix: textProvider, part_chat: textProvider,
        photo: Boolean(env.META_API_KEY), part: Boolean(env.META_API_KEY),
        transcribe: Boolean(env.META_API_KEY),
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
  if (url.pathname === '/fix' && request.method === 'POST') {
    return handleFix(request, env);
  }
  if (url.pathname === '/part' && request.method === 'POST') {
    return handlePart(request, env);
  }
  if (url.pathname === '/part-chat' && request.method === 'POST') {
    return handlePartChat(request, env);
  }
  if (url.pathname === '/transcribe' && request.method === 'POST') {
    return handleTranscribe(request, env);
  }
  if (url.pathname === '/auth/register' && request.method === 'POST') {
    return handleAuthRegister(request, env);
  }
  if (url.pathname === '/auth/login' && request.method === 'POST') {
    return handleAuthLogin(request, env);
  }
  if (url.pathname === '/auth/me' && request.method === 'GET') {
    return handleAuthMe(request, env);
  }
  if (url.pathname === '/auth/logout' && request.method === 'POST') {
    return handleAuthLogout(request);
  }
  if (url.pathname === '/auth/config' && request.method === 'GET') {
    return handleAuthConfig(request, env);
  }
  const oauthMatch = url.pathname.match(/^\/auth\/(meta|github|google)\/(start|callback)$/);
  if (oauthMatch && request.method === 'GET') {
    return oauthMatch[2] === 'start'
      ? handleOAuthStart(oauthMatch[1], request, env)
      : handleOAuthCallback(oauthMatch[1], request, env);
  }
  if (url.pathname === '/admin/users' && request.method === 'GET') {
    return handleAdminUsers(request, env);
  }
  if (url.pathname === '/admin/seed-founder' && request.method === 'POST') {
    return handleAdminSeedFounder(request, env);
  }
  if (url.pathname === '/admin/grant-role' && request.method === 'POST') {
    return handleAdminGrantRole(request, env);
  }
  return err(request, 404, 'not_found', 'No such route. Try /health, /describe, /chat, /list, /photo, /fix, /part, /part-chat, /transcribe or /auth/*.');
}

export default { fetch: handle };
