/* Pure WAV encoder for chat voice input — no imports, no DOM, so a
 * node-driven pin test can compile and run it standalone.
 *
 * The live endpoint's /transcribe route accepts WAV only: the Meta
 * batch transcription endpoint rejects browser recording containers
 * (WebM/MP3 — verified 2026-10-31), so VoiceButton decodes and
 * resamples the recording with WebAudio and encodes the samples
 * here as 16-bit mono PCM WAV. The byte layout is the canonical
 * 44-byte RIFF header the route checks for (it reads the RIFF magic
 * and enforces the decoded-size cap server-side). */
export function encodeWavPcm16(
  samples: Float32Array,
  sampleRate: number,
): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(44 + samples.length * 2));
  const view = new DataView(bytes.buffer);
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
  return bytes;
}
