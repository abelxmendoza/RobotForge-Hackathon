'use client';
/* /build/: build a four-wheel starter rover one step at a time, for an
 * Arduino UNO or an ESP32, then drive it in the browser. Steps, parts,
 * pins and sketches come from lib/buildGuide.ts. Ticks and the board
 * choice are kept in this browser only. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { BOARDS, BOM, STEPS, TOOLS, checkKeys, pick, pinRows, sketches, type BoardId, type PieceId } from '@/lib/buildGuide';
import { searchShopLink } from '@/lib/shopLinks';
import './build.css';

const StepStage = dynamic(() => import('./StepStage'), { ssr: false });
const DriveLab = dynamic(() => import('./DriveLab'), { ssr: false });
const CHECKS_KEY = 'rf.buildguide.checks.v1', BOARD_KEY = 'rf.buildguide.board.v1';

function readSet(): Set<string> { try { const v = JSON.parse(localStorage.getItem(CHECKS_KEY) || '[]'); return new Set(Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []); } catch { return new Set(); } }

export default function BuildGuide() {
  const [board, setBoard] = useState<BoardId>('uno');
  const [idx, setIdx] = useState(0);
  const [checks, setChecks] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<PieceId[]>([]);
  const [codeTab, setCodeTab] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setChecks(readSet());
    try { const b = localStorage.getItem(BOARD_KEY); if (b === 'uno' || b === 'esp32') setBoard(b); } catch { /* not saved */ }
    const fromHash = () => { const i = STEPS.findIndex((s) => '#' + s.id === location.hash); if (i >= 0) setIdx(i); };
    fromHash(); window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, []);
  const go = useCallback((i: number) => {
    const n = Math.max(0, Math.min(STEPS.length - 1, i)); setIdx(n); setHover([]); setCopied(false);
    history.replaceState(null, '', '#' + STEPS[n].id);
  }, []);
  const chooseBoard = (b: BoardId) => { setBoard(b); try { localStorage.setItem(BOARD_KEY, b); } catch { /* not saved */ } };
  const toggle = (k: string) => setChecks((prev) => {
    const next = new Set(prev); if (next.has(k)) next.delete(k); else next.add(k);
    try { localStorage.setItem(CHECKS_KEY, JSON.stringify([...next])); } catch { /* not saved */ }
    return next;
  });

  const step = STEPS[idx];
  const keys = checkKeys(step, board), done = keys.filter((k) => checks.has(k)).length;
  const files = useMemo(() => sketches(board), [board]);
  const file = files[Math.min(codeTab, files.length - 1)];
  const isDrive = step.id === 'drive';
  const stepDone = (i: number) => { const k = checkKeys(STEPS[i], board); return k.length > 0 && k.every((x) => checks.has(x)); };

  const copy = async () => { try { await navigator.clipboard.writeText(file.code); setCopied(true); } catch { setCopied(false); } };
  const download = () => {
    const url = URL.createObjectURL(new Blob([file.code], { type: 'text/plain' }));
    const a = document.createElement('a'); a.href = url; a.download = file.file; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="bg">
      <header className="bg-head">
        <div>
          <p className="eyebrow">Build guide</p>
          <h1>Build a rover, step by step</h1>
        </div>
        <div className="bg-seg" role="radiogroup" aria-label="Board">
          {(Object.keys(BOARDS) as BoardId[]).map((b) => (
            <button key={b} role="radio" aria-checked={board === b} className={board === b ? 'on' : ''} onClick={() => chooseBoard(b)}>{BOARDS[b].name}</button>
          ))}
        </div>
      </header>

      {isDrive && <p className="bg-say bg-drive-say">{pick(step.say, board)}</p>}
      <div className={'bg-main' + (isDrive ? ' drive' : '')}>
        {isDrive ? <DriveLab board={board} /> : <StepStage board={board} step={step} hover={hover} />}

        {!isDrive && (
          <article className="bg-card" aria-labelledby="bg-step-title">
            <p className="bg-kicker">Step {idx + 1} of {STEPS.length}{keys.length > 0 && <span className="bg-count">{done} / {keys.length}</span>}</p>
            <h2 id="bg-step-title">{pick(step.title, board)}</h2>
            <p className="bg-say">{pick(step.say, board)}</p>

            {step.id === 'parts' && (
              <>
                <ul className="bg-checks">
                  {BOM.map((line, i) => {
                    const k = `${board}/parts/${i}`, name = pick(line.name, board), link = searchShopLink('amazon', pick(line.search, board));
                    return (
                      <li key={k} onMouseEnter={() => setHover(line.pieces)} onMouseLeave={() => setHover([])}>
                        <label><input type="checkbox" checked={checks.has(k)} onChange={() => toggle(k)} /><span className="bg-qty">{line.qty}×</span><span>{name}</span></label>
                        {link && <a className="bg-shop" href={link.url} target="_blank" rel="noreferrer" aria-label={`Search ${link.label} for ${name}`}>Find ↗</a>}
                      </li>
                    );
                  })}
                </ul>
                <p className="bg-tools"><b>Tools</b> {TOOLS.join(' · ')}</p>
              </>
            )}

            {pick(step.do, board).length > 0 && (
              <ol className="bg-checks bg-do">
                {pick(step.do, board).map((text, i) => {
                  const k = `${board}/${step.id}/${i}`;
                  return <li key={k}><label><input type="checkbox" checked={checks.has(k)} onChange={() => toggle(k)} /><span>{text}</span></label></li>;
                })}
              </ol>
            )}

            {step.id === 'wiring' && (
              <table className="bg-pins">
                <thead><tr><th>Part</th><th>{BOARDS[board].name} pin</th></tr></thead>
                <tbody>{pinRows(board).map((r) => <tr key={r.what} onMouseEnter={() => setHover(r.pieces)} onMouseLeave={() => setHover([])}><td>{r.what}</td><td className="num">{r.pin}</td></tr>)}</tbody>
              </table>
            )}

            {step.id === 'code' && (
              <div className="bg-code">
                <div className="bg-tabs" role="tablist" aria-label="Sketches">
                  {files.map((f, i) => <button key={f.file} role="tab" aria-selected={i === codeTab} className={i === codeTab ? 'on' : ''} onClick={() => { setCodeTab(i); setCopied(false); }}>{f.tab}</button>)}
                </div>
                <pre tabIndex={0} aria-label={file.file}>{file.code}</pre>
                <div className="bg-row">
                  <button className="btn btn-sm" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
                  <button className="btn btn-sm" onClick={download}>Download {file.file}</button>
                </div>
                <p className="faint g-small">Written for this guide and not yet run on a built car. Report anything that doesn’t compile.</p>
              </div>
            )}

            {step.watch && <p className="bg-watch"><b>Watch out</b> {pick(step.watch, board)}</p>}
          </article>
        )}
      </div>

      <nav className="bg-rail" aria-label="Steps">
        <button className="btn bg-prev" onClick={() => go(idx - 1)} disabled={idx === 0}>← Back</button>
        <ol>
          {STEPS.map((s, i) => (
            <li key={s.id}>
              <button className={(i === idx ? 'on ' : '') + (stepDone(i) ? 'done' : '')} aria-current={i === idx ? 'step' : undefined} onClick={() => go(i)}>
                <span className="n">{stepDone(i) ? '✓' : String(i + 1).padStart(2, '0')}</span><span className="l">{s.label}</span>
              </button>
            </li>
          ))}
        </ol>
        <button className="btn btn-primary bg-next" onClick={() => go(idx + 1)} disabled={idx === STEPS.length - 1}>{idx < STEPS.length - 1 ? `Next: ${STEPS[idx + 1].label} →` : 'Done'}</button>
      </nav>

      <p className="faint g-small bg-foot">
        A generic hobby kit, drawn from simple shapes; sizes are typical, not measured. Own a different robot? <Link href="/garage/">Open the Workshop</Link> or try <Link href="/simulator/">Omega1’s simulator</Link>.
      </p>
    </div>
  );
}
