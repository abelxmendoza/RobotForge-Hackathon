"use client";
/* Ground-truth trajectory chart — a faithful port of drawTraj() from
   assets/js/common.js: same bounds (origin and ±0.2 m always in frame),
   same colours, same start/end dots, same caption. Draws on mount and
   redraws (150 ms debounce) on window resize, exactly like evidence.js. */

import { useEffect, useRef } from "react";

/* One run's ground-truth path: [x, y] metre pairs from
   catalog/gate-reports.json (GateReportRun.traj, loosely typed there). */
export type TrajPoints = [number, number][];

function drawTraj(cv: HTMLCanvasElement, pts: TrajPoints | null | undefined) {
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth || 480, H = 240;
  cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + "px";
  const ctx = cv.getContext("2d");
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  ctx.font = "12px ui-monospace, Menlo, monospace";
  if (!pts || !pts.length) {
    ctx.fillStyle = "#9aa3ae";
    ctx.fillText("no trajectory recorded", 12, 20);
    return;
  }
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const minx = Math.min(...xs, 0), maxx = Math.max(...xs, 0.2);
  const miny = Math.min(...ys, -0.2), maxy = Math.max(...ys, 0.2);
  const pad = 22;
  const sc = Math.min((W - 2 * pad) / (maxx - minx || 1), (H - 2 * pad) / (maxy - miny || 1));
  const X = (x: number) => pad + (x - minx) * sc;
  const Y = (y: number) => H - pad - (y - miny) * sc;
  ctx.strokeStyle = "#2a2f38"; ctx.lineWidth = 1; ctx.beginPath();
  ctx.moveTo(X(minx), Y(0)); ctx.lineTo(X(maxx), Y(0)); ctx.stroke();
  ctx.strokeStyle = "#34d399"; ctx.lineWidth = 2.5; ctx.lineJoin = "round"; ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1]))));
  ctx.stroke();
  ctx.fillStyle = "#eceef2"; ctx.beginPath();
  ctx.arc(X(pts[0][0]), Y(pts[0][1]), 4, 0, 7); ctx.fill();
  const last = pts[pts.length - 1];
  ctx.fillStyle = "#f59e0b"; ctx.beginPath();
  ctx.arc(X(last[0]), Y(last[1]), 5, 0, 7); ctx.fill();
  ctx.fillStyle = "#6f7884"; ctx.fillText("ground-truth path, metres", 10, 16);
}

export default function TrajectoryChart({
  id,
  points,
}: {
  id: string;
  points: TrajPoints | null | undefined;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const draw = () => {
      if (ref.current) drawTraj(ref.current, points);
    };
    draw();
    let t: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(t);
      t = setTimeout(draw, 150);
    };
    addEventListener("resize", onResize);
    return () => {
      clearTimeout(t);
      removeEventListener("resize", onResize);
    };
  }, [points]);

  return <canvas className="traj" id={id} ref={ref} />;
}
