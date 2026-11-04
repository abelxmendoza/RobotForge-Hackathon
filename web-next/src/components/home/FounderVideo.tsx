"use client";
/* "Why I built RobotForge" — Abel's own talk-through of the app
 * (Nov 4, 2026). The phone recording's black bars are cropped off at
 * encode time (1080×640, screen area only), so the player frames just
 * the screen. A small custom player in the app's theme: window chrome,
 * a big play button, a seek bar, time, mute and fullscreen. Nothing
 * downloads until play (preload="none" + poster). */
import { useEffect, useRef, useState } from "react";
import { assetPath } from "./asset";

const fmt = (s: number) => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r < 10 ? "0" : ""}${r}`;
};

export default function FounderVideo() {
  const frame = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [muted, setMuted] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(216);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const onTime = () => setTime(v.currentTime);
    const onMeta = () => { if (Number.isFinite(v.duration)) setDuration(v.duration); };
    const onPlay = () => { setPlaying(true); setStarted(true); };
    const onPause = () => setPlaying(false);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("ended", onPause);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("ended", onPause);
    };
  }, []);

  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => undefined);
    else v.pause();
  };
  const seek = (value: number) => {
    const v = video.current;
    if (!v) return;
    v.currentTime = value;
    setTime(value);
  };
  const toggleMute = () => {
    const v = video.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  };
  const fullscreen = () => {
    const el = frame.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else if (el.requestFullscreen) void el.requestFullscreen().catch(() => undefined);
    else video.current?.requestFullscreen?.();
  };

  const pct = duration ? (time / duration) * 100 : 0;

  return (
    <div className="fv" ref={frame}>
      <div className="fv-bar" aria-hidden="true">
        <span className="fv-dots"><i /><i /><i /></span>
        <span className="fv-title">Why I built RobotForge</span>
        <span className="fv-badge">Abel Mendoza · 3:36</span>
      </div>
      <div className="fv-screen">
        <video
          ref={video}
          preload="none"
          playsInline
          poster={assetPath("assets/video/why-i-built-robotforge-poster.jpg")}
          width={1080}
          height={640}
          onClick={toggle}
          aria-label="Why I built RobotForge — Abel Mendoza walks through the app"
        >
          <source src={assetPath("assets/video/why-i-built-robotforge.mp4")} type="video/mp4" />
        </video>
        {!playing && (
          <button type="button" className={"fv-play" + (started ? " fv-play-small" : "")} onClick={toggle} aria-label={started ? "Resume video" : "Play video"}>
            <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor" /></svg>
          </button>
        )}
      </div>
      <div className="fv-controls">
        <button type="button" className="fv-btn" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
          {playing
            ? <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor" /></svg>
            : <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor" /></svg>}
        </button>
        <span className="fv-time">{fmt(time)}</span>
        <input
          className="fv-seek"
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={time}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label="Seek"
          style={{ ["--fv-pct" as string]: pct + "%" }}
        />
        <span className="fv-time">{fmt(duration)}</span>
        <button type="button" className="fv-btn" onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}>
          {muted
            ? <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9zm12.6 3 2.7-2.7-1.4-1.4-2.7 2.7-2.7-2.7-1.4 1.4 2.7 2.7-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4z" fill="currentColor" /></svg>
            : <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9zm11.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM13 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z" fill="currentColor" /></svg>}
        </button>
        <button type="button" className="fv-btn" onClick={fullscreen} aria-label="Full screen">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5 5h5v2H7v3H5zm9 0h5v5h-2V7h-3zM5 14h2v3h3v2H5zm12 0h2v5h-5v-2h3z" fill="currentColor" /></svg>
        </button>
      </div>
    </div>
  );
}
