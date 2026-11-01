'use client';
/* Voice describe — a mic button for the Forge composer.
 *
 * Records with MediaRecorder, decodes/resamples the clip to a
 * 24 kHz mono WAV in the browser (the Meta batch transcription
 * endpoint rejects browser containers like WebM/MP3 — verified
 * 2026-10-31 — so the browser encodes WAV), and sends it to the
 * live endpoint's /transcribe route (Muse Voice Transcribe).
 * The transcript lands in the composer for review — it is never
 * auto-sent, so the user sees exactly what was heard before it
 * becomes a design or a message.
 *
 * The button renders only when the browser can record AND the
 * endpoint reports the transcribe route on (Meta key present).
 * Audio goes to the endpoint only; nothing is stored anywhere. */
import { useEffect, useRef, useState } from 'react';
import { liveHealth, postJSON, routeOn } from '../forge/live';
import type { LiveHealth } from '../forge/model';

const TARGET_RATE = 24000;
const MAX_SECONDS = 60;

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, v * (v < 0 ? 0x8000 : 0x7fff), true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

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
      const wav = encodeWav(rendered.getChannelData(0), TARGET_RATE);
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
      setError('Microphone access was denied — voice describe needs the mic. Typing still works.');
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
            : 'Describe by voice (Muse Voice Transcribe)'
        }
        title={
          phase === 'recording'
            ? `Recording… ${seconds}s — tap to stop (max ${MAX_SECONDS}s)`
            : phase === 'transcribing'
              ? 'Transcribing…'
              : 'Describe by voice — Muse Voice Transcribe writes it into the box for you to check before sending'
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
