'use client';
/* Voice input — one shared mic button for both chat composers
 * (the ForgeThread composer on /forge and docked in the Workshop,
 * and the global ChatBar's bottom bar).
 *
 * Records with MediaRecorder, decodes/resamples the clip to a
 * 24 kHz mono WAV in the browser (the Meta batch transcription
 * endpoint rejects browser containers like WebM/MP3 — verified
 * 2026-10-31 — so the browser encodes WAV with the pure encoder
 * in lib/wavEncode.ts), and sends it to the live endpoint's
 * /transcribe route (Muse Voice Transcribe).
 * The transcript lands in the composer for review — it is never
 * auto-sent, so the user sees exactly what was heard before it
 * becomes a design or a message.
 *
 * The button renders only when the browser can record AND the
 * endpoint reports the transcribe route on (Meta key present).
 * The route itself is account-gated: a signed-out visitor who
 * records gets the endpoint's own "sign in first" refusal back
 * as the error line. In demo mode the health probe never runs,
 * so the button stays hidden — the demo makes no Worker calls.
 * Audio goes to the endpoint only; nothing is stored anywhere. */
import { useEffect, useRef, useState } from 'react';
import { liveHealth, postJSON, routeOn } from '../forge/live';
import type { LiveHealth } from '../forge/model';
import { encodeWavPcm16 } from '@/lib/wavEncode';

const TARGET_RATE = 24000;
const MAX_SECONDS = 60;

async function blobToBase64(blob: Blob): Promise<string> {
  const url = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('could not read the recording'));
    r.readAsDataURL(blob);
  });
  return url.slice(url.indexOf(',') + 1);
}

type Phase = 'idle' | 'recording' | 'transcribing';

export default function VoiceButton({
  onText,
}: {
  onText: (transcript: string) => void;
}) {
  const [health, setHealth] = useState<LiveHealth | null | undefined>(undefined);
  const [supported, setSupported] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');
  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const startedRef = useRef(0);

  useEffect(() => {
    setSupported(
      typeof navigator !== 'undefined' &&
        !!navigator.mediaDevices?.getUserMedia &&
        typeof MediaRecorder !== 'undefined' &&
        typeof AudioContext !== 'undefined',
    );
    let live = true;
    liveHealth().then((h) => {
      if (live) setHealth(h);
    });
    return () => {
      live = false;
      if (timerRef.current) window.clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  if (!supported || health === undefined || !routeOn(health ?? null, 'transcribe')) {
    return null;
  }

  const stopTracks = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const finish = async (blob: Blob) => {
    setPhase('transcribing');
    try {
      const ctx = new AudioContext();
      const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
      await ctx.close();
      const offline = new OfflineAudioContext(
        1,
        Math.max(1, Math.ceil(decoded.duration * TARGET_RATE)),
        TARGET_RATE,
      );
      const src = offline.createBufferSource();
      src.buffer = decoded;
      src.connect(offline.destination);
      src.start();
      const rendered = await offline.startRendering();
      const wav = new Blob(
        [encodeWavPcm16(rendered.getChannelData(0), TARGET_RATE)],
        { type: 'audio/wav' },
      );
      const audio_b64 = await blobToBase64(wav);
      const reply = await postJSON<{ transcript?: string }>('/transcribe', {
        audio_b64,
      });
      if (reply && typeof reply.transcript === 'string' && reply.transcript.trim()) {
        onText(reply.transcript.trim());
        setError('');
      } else {
        setError('The transcription came back empty — try again, closer to the mic.');
      }
    } catch (e) {
      setError(
        'Voice transcription failed (' +
          (e instanceof Error ? e.message : 'unknown error') +
          '). Typing still works.',
      );
    }
    setPhase('idle');
  };

  const start = async () => {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const rec = new MediaRecorder(stream);
      recRef.current = rec;
      const chunks: Blob[] = [];
      rec.ondataavailable = (ev) => {
        if (ev.data.size) chunks.push(ev.data);
      };
      rec.onstop = () => {
        stopTracks();
        const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
        void finish(blob);
      };
      rec.start();
      startedRef.current = Date.now();
      setSeconds(0);
      setPhase('recording');
      timerRef.current = window.setInterval(() => {
        const s = Math.floor((Date.now() - startedRef.current) / 1000);
        setSeconds(s);
        if (s >= MAX_SECONDS && recRef.current?.state === 'recording') {
          recRef.current.stop();
        }
      }, 250);
    } catch {
      setError('Microphone access was denied — voice input needs the mic. Typing still works.');
      setPhase('idle');
    }
  };

  const toggle = () => {
    if (phase === 'recording') recRef.current?.stop();
    else if (phase === 'idle') void start();
  };

  return (
    <>
      <button
        type="button"
        className="chat-bar-attach"
        onClick={toggle}
        disabled={phase === 'transcribing'}
        aria-label={
          phase === 'recording'
            ? 'Stop recording'
            : 'Voice input (Muse Voice Transcribe)'
        }
        title={
          phase === 'recording'
            ? `Recording… ${seconds}s — tap to stop (max ${MAX_SECONDS}s)`
            : phase === 'transcribing'
              ? 'Transcribing…'
              : 'Speak instead of typing — Muse Voice Transcribe writes it into the box for you to check before sending'
        }
        style={phase === 'recording' ? { color: '#e5484d' } : undefined}
      >
        {phase === 'transcribing' ? (
          <span aria-hidden="true">…</span>
        ) : (
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="2.5" width="6" height="11" rx="3" />
            <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
            <path d="M12 18v3.5" />
          </svg>
        )}
      </button>
      {phase === 'recording' && (
        <span className="faint" role="status" aria-live="polite">
          {seconds}s
        </span>
      )}
      {error && (
        <span className="faint" role="alert" style={{ color: '#e5484d' }}>
          {error}
        </span>
      )}
    </>
  );
}
