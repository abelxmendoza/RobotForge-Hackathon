"""Voice input for both chat composers (2026-11-02, Abel's pick:
the small PR right after the Omega1 Garage PR #128).

Before this PR the mic button (components/chat/VoiceButton.tsx)
existed for ONE composer only — the ForgeThread composer (/forge
+ the Workshop's docked thread). The global ChatBar had none.
What is pinned here:

- Both chat composers mount the one shared VoiceButton; the logic
  is not forked. In ChatBar it sits between AttachButton and the
  textarea, like the ForgeThread composer's attach/mic order.
- The transcript is written INTO the composer text for review and
  is NEVER auto-sent: neither composer wires onText to send/ask,
  and VoiceButton itself holds no send machinery — it only calls
  onText with what the endpoint returned.
- The WAV encoding lives in a pure module (lib/wavEncode.ts, no
  imports, no DOM) so it is driven in node below: the encoder
  emits the canonical 44-byte RIFF/WAVE header and clamps samples
  to int16 range. WAV is not a choice — the live /transcribe
  route rejects every other container (see the Worker contract
  pins at the bottom).
- Honest failure states, pinned as strings: mic denied, empty
  transcript, generic failure — each says typing still works.
  The button renders only when the browser can record AND the
  endpoint's health reports the transcribe route on; in demo
  mode the health probe never runs, so it stays hidden (the demo
  makes no Worker calls, by construction).

Skips (no node, no TypeScript) follow test_chat.py's convention:
the source assertions below still run.
"""
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web-next"
SRC = WEB / "src"

VOICE = (SRC / "components/chat/VoiceButton.tsx").read_text()
CHATBAR = (SRC / "components/chat/ChatBar.tsx").read_text()
FORGE_THREAD = (SRC / "components/forge/ForgeThread.tsx").read_text()
WAV_TS = SRC / "lib/wavEncode.ts"
WORKER = (ROOT / "live/worker.js").read_text()


# --- Both composers, one shared button --------------------------------

def test_both_composers_mount_the_shared_voice_button():
    assert 'import VoiceButton from "./VoiceButton"' in CHATBAR
    assert "<VoiceButton" in CHATBAR
    assert "import VoiceButton from '@/components/chat/VoiceButton'" in FORGE_THREAD
    assert "<VoiceButton" in FORGE_THREAD


def test_chatbar_button_sits_between_attach_and_textarea():
    attach = CHATBAR.index("<AttachButton")
    voice = CHATBAR.index("<VoiceButton")
    textarea = CHATBAR.index("<textarea")
    assert attach < voice < textarea


def test_transcript_is_never_auto_sent():
    # VoiceButton's success path hands the text to the composer
    # and nothing else: no submit, no ask, no send anywhere in it.
    assert "onText(reply.transcript.trim())" in VOICE
    for forbidden in ("requestSubmit", ".ask(", "sendMessage", "onSend"):
        assert forbidden not in VOICE, forbidden
    # ChatBar's onText only edits the draft text.
    block = CHATBAR[CHATBAR.index("<VoiceButton"):CHATBAR.index("/>", CHATBAR.index("<VoiceButton"))]
    assert "setText((prev)" in block
    assert "send(" not in block and "assistant.ask" not in block


# --- The flow, pinned at the source ------------------------------------

def test_voice_button_posts_wav_base64_to_transcribe():
    assert "postJSON" in VOICE and "'/transcribe'" in VOICE
    assert "audio_b64" in VOICE
    assert "new MediaRecorder(stream)" in VOICE
    assert "getUserMedia({ audio: true })" in VOICE
    # 60 s cap, matching the endpoint's ~4 MB decoded-WAV budget.
    assert "MAX_SECONDS = 60" in VOICE


def test_button_renders_only_when_supported_and_route_on():
    assert "navigator.mediaDevices?.getUserMedia" in VOICE
    assert "typeof MediaRecorder !== 'undefined'" in VOICE
    assert "routeOn(health ?? null, 'transcribe')" in VOICE


def test_failure_states_are_plain_and_honest():
    assert "Microphone access was denied" in VOICE
    assert "The transcription came back empty" in VOICE
    assert "Voice transcription failed" in VOICE
    assert "Typing still works" in VOICE
    # A real recording indicator while recording — no fake states.
    assert 'role="status"' in VOICE and "Recording… " in VOICE


# --- The pure WAV encoder ----------------------------------------------

def test_wav_module_is_pure_and_voice_button_uses_it():
    assert WAV_TS.exists()
    src = WAV_TS.read_text()
    assert "export function encodeWavPcm16" in src
    assert "import " not in src  # zero imports: compilable standalone
    assert "document" not in src and "window" not in src  # no DOM
    assert "from '@/lib/wavEncode'" in VOICE
    # The header writer no longer lives inline in the component.
    assert "function encodeWav(" not in VOICE
    assert "writeStr(0, 'RIFF')" not in VOICE


DRIVER = """
const { encodeWavPcm16 } = require(process.argv[2] + '/wavEncode.js');
function u32(b, o) { return b.readUInt32LE(o); }
function u16(b, o) { return b.readUInt16LE(o); }
function i16(b, o) { return b.readInt16LE(o); }
const samples = new Float32Array([0, 0.5, -0.5, 1, -1, 2.0]);
const out = Buffer.from(encodeWavPcm16(samples, 24000));
const empty = Buffer.from(encodeWavPcm16(new Float32Array(0), 16000));
console.log(JSON.stringify({
  len: out.length,
  riff: out.toString('ascii', 0, 4),
  wave: out.toString('ascii', 8, 12),
  fmt: out.toString('ascii', 12, 16),
  dataTag: out.toString('ascii', 36, 40),
  chunkSize: u32(out, 4),
  fmtSize: u32(out, 16),
  audioFormat: u16(out, 20),
  channels: u16(out, 22),
  rate: u32(out, 24),
  byteRate: u32(out, 28),
  bits: u16(out, 34),
  dataSize: u32(out, 40),
  vals: [0, 1, 2, 3, 4, 5].map((i) => i16(out, 44 + i * 2)),
  emptyLen: empty.length,
  emptyDataSize: u32(empty, 40),
  emptyRate: u32(empty, 24),
}));
"""


def _run_encoder():
    """Compile lib/wavEncode.ts and drive it in node. Returns the
    parsed result dict, or None when the toolchain is unavailable
    (test_chat.py's skip convention — source pins above still hold)."""
    node = shutil.which("node")
    tsc = WEB / "node_modules/.bin/tsc"
    if not node or not tsc.exists() or not WAV_TS.exists():
        return None
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        build = tmp / "build"
        r = subprocess.run(
            [str(tsc), str(WAV_TS),
             "--module", "commonjs", "--target", "es2020",
             "--moduleResolution", "node", "--skipLibCheck",
             "--outDir", str(build)],
            capture_output=True, text=True, timeout=300)
        if r.returncode != 0:
            raise AssertionError("tsc failed on wavEncode.ts:\n" + r.stderr[-2000:])
        script = tmp / "drive.js"
        script.write_text(DRIVER)
        r = subprocess.run([node, str(script), str(build)],
                           capture_output=True, text=True, timeout=300)
        if r.returncode != 0:
            raise AssertionError("encoder driver failed:\n" + r.stderr[-2000:])
        return json.loads(r.stdout)


def test_wav_encoder_emits_a_real_riff_header():
    out = _run_encoder()
    if out is None:
        return  # no node/tsc on this machine; source pins still hold
    assert out["riff"] == "RIFF" and out["wave"] == "WAVE"
    assert out["fmt"] == "fmt " and out["dataTag"] == "data"
    assert out["len"] == 44 + 6 * 2
    assert out["chunkSize"] == 36 + 6 * 2
    assert out["fmtSize"] == 16
    assert out["audioFormat"] == 1  # PCM
    assert out["channels"] == 1  # mono
    assert out["rate"] == 24000 and out["byteRate"] == 48000
    assert out["bits"] == 16
    assert out["dataSize"] == 6 * 2
    # int16 PCM: symmetric scale, clamped at the rails.
    assert out["vals"] == [0, 16383, -16384, 32767, -32768, 32767]
    # An empty clip is still a valid header with a zero data chunk.
    assert out["emptyLen"] == 44 and out["emptyDataSize"] == 0
    assert out["emptyRate"] == 16000


# --- The endpoint contract the button is built against ------------------

def test_worker_transcribe_contract_still_matches():
    # Account-gated model route: /transcribe sits in MODEL_PATHS,
    # which the dispatcher gates with requireAccount before the
    # handler runs (live/worker.js).
    assert "'/transcribe'" in WORKER
    assert "MODEL_PATHS" in WORKER and "requireAccount" in WORKER
    # { audio_b64 } in, { transcript, model } out; WAV or a refusal.
    assert "missing_audio" in WORKER and "audio_b64" in WORKER
    assert "transcribe_not_configured" in WORKER
    assert "TRANSCRIBE_MODEL = 'muse-voice-transcribe-1.0'" in WORKER
