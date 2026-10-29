'use client';
/* Parts inventory: photograph the parts on your shelf, let Muse Spark
 * read each one, then confirm it in a short chat. A part counts as
 * yours-and-known only after you confirm it; confirmed batteries,
 * motors and wheels can be fitted to a robot in the Garage. */
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { liveHealth, postJSON, routeOn, LiveOffReason } from '@/components/forge/live';
import { LiveProgress, ModeBanner, offReason, useLiveMode } from '@/components/shell/LiveStatus';
import type { LiveHealth } from '@/components/forge/model';
import { downloadJSON, uid, useStore } from '@/lib/store';
import { preparePhoto } from '@/lib/image';
import {
  INVENTORY_KEY, mergeUpdate, offlinePartReply, PART_CATEGORIES, PART_SPEC_KEYS, SPEC_KEY_LABEL,
  type ChatLine, type InventoryPart,
} from '@/lib/inventory';

const now = () => new Date().toISOString();
const label = (c: string) => c.replace(/_/g, ' ');

function blankPart(source: 'photo' | 'manual', photo: string | null): InventoryPart {
  return {
    id: uid('part'), name: source === 'photo' ? 'Identifying…' : 'New part', category: 'other', quantity: 1,
    catalog_part_id: null, specs: {}, read_from_label: [], condition: 'unknown',
    confidence: source === 'manual' ? 'owner' : 'low', status: source === 'manual' ? 'confirmed' : 'needs_confirmation',
    question: '', photo, chat: [], createdAt: now(), source,
  };
}

function PartCard({ p, active, onOpen }: { p: InventoryPart; active: boolean; onOpen: () => void }) {
  return (
    <button type="button" className="inv-card" aria-pressed={active} onClick={onOpen}>
      {p.photo ? <img src={p.photo} alt="" /> : <span className="inv-noimg" aria-hidden="true">{label(p.category).slice(0, 1).toUpperCase()}</span>}
      <span className="inv-card-body">
        <strong>{p.name}</strong>
        <span className="faint">{label(p.category)} · ×{p.quantity}</span>
        <span className={'verdict ' + (p.status === 'confirmed' ? 'pass' : 'marginal')}>{p.status === 'confirmed' ? 'Confirmed' : 'Needs confirmation'}</span>
      </span>
    </button>
  );
}

function PartDetail({ p, health, onChange, onPatch, onDelete, onLive }: { p: InventoryPart; health: LiveHealth | null | undefined; onChange: (next: InventoryPart) => void; onPatch: (id: string, fn: (latest: InventoryPart) => InventoryPart) => void; onDelete: () => void; onLive: (err?: unknown) => void }) {
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [newKey, setNewKey] = useState<string>('voltage_v');
  const [newVal, setNewVal] = useState('');
  const chatLive = routeOn(health ?? null, 'part_chat');
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [p.chat.length]);

  const send = async () => {
    const text = msg.trim();
    if (!text) return;
    setMsg('');
    const withUser: InventoryPart = { ...p, chat: [...p.chat, { role: 'user', text }] };
    onChange(withUser);
    setBusy(true);
    let reply: string, update: Partial<InventoryPart> | null, confirmed: boolean, live = false;
    if (chatLive) {
      try {
        const r = await postJSON<{ reply: string; update: Partial<InventoryPart> | null; confirmed: boolean }>('/part-chat', {
          part: { ...p, photo: undefined, chat: undefined }, message: text,
          history: p.chat.slice(-8).map((c) => ({ role: c.role, text: c.text })),
        });
        ({ reply, update, confirmed } = r);
        live = true;
        onLive();
      } catch (e) {
        onLive(e);
        ({ reply, update, confirmed } = offlinePartReply(p, text));
        reply = `The live model didn’t answer (${(e as Error).message}). ` + reply;
      }
    } else {
      ({ reply, update, confirmed } = offlinePartReply(p, text));
    }
    /* Land the reply on the record as it is now, not the snapshot the
     * request started from: edits made while waiting are kept. */
    onPatch(withUser.id, (latest) => {
      let next = mergeUpdate(latest, withUser, update);
      if (confirmed) next = { ...next, status: 'confirmed', confidence: 'owner' };
      return { ...next, chat: [...latest.chat, { role: 'assistant', text: reply || '(no reply)', live }] };
    });
    setBusy(false);
  };

  const setSpec = (k: string, raw: string) => {
    const specs = { ...p.specs };
    const t = raw.trim();
    if (!t) delete specs[k];
    else specs[k] = Number.isFinite(Number(t)) && k !== 'model_number' && k !== 'chemistry' && k !== 'interface' ? Number(t) : t;
    onChange({ ...p, specs, read_from_label: p.read_from_label.filter((x) => x !== k) });
  };

  return (
    <div className="inv-detail">
      <div className="inv-detail-head">
        {p.photo && <img src={p.photo} alt={'Photo of ' + p.name} />}
        <div className="inv-detail-fields">
          <label className="g-field"><span>Name</span><input id={'inv-name-' + p.id} value={p.name} onChange={(e) => onChange({ ...p, name: e.target.value })} /></label>
          <div className="inv-row">
            <label className="g-field"><span>Category</span>
              <select id={'inv-cat-' + p.id} value={p.category} onChange={(e) => onChange({ ...p, category: e.target.value })}>
                {PART_CATEGORIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}
              </select>
            </label>
            <label className="g-field"><span>Quantity</span><input id={'inv-qty-' + p.id} type="number" min={1} value={p.quantity} onChange={(e) => onChange({ ...p, quantity: Math.max(1, parseInt(e.target.value, 10) || 1) })} /></label>
            <label className="g-field"><span>Condition</span>
              <select id={'inv-cond-' + p.id} value={p.condition} onChange={(e) => onChange({ ...p, condition: e.target.value as InventoryPart['condition'] })}>
                {['new', 'used', 'damaged', 'unknown'].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          </div>
          <p className="g-small faint">
            {p.source === 'photo' ? `Identified from a photo · model confidence ${p.confidence === 'owner' ? 'n/a (you confirmed it)' : p.confidence}` : 'Added by hand'}
            {p.catalog_part_id ? ` · matches catalogue part ${p.catalog_part_id}` : ''}
          </p>
        </div>
      </div>

      <div className="inv-specs">
        <h4>Specs</h4>
        {Object.keys(p.specs).length === 0 && <p className="faint g-small">No specs yet. Add what the label says, or tell the chat.</p>}
        <ul>
          {Object.entries(p.specs).map(([k, v]) => (
            <li key={k}>
              <span>{SPEC_KEY_LABEL[k] ?? k}</span>
              <input id={`inv-spec-${p.id}-${k}`} defaultValue={String(v)} key={String(v)} onBlur={(e) => setSpec(k, e.target.value)} />
              <span className={p.read_from_label.includes(k) ? 'inv-src read' : 'inv-src'}>{p.read_from_label.includes(k) ? 'read from label' : p.source === 'photo' && p.status !== 'confirmed' ? 'estimate' : 'yours'}</span>
            </li>
          ))}
        </ul>
        <div className="inv-addspec">
          <select id={'inv-newkey-' + p.id} value={newKey} onChange={(e) => setNewKey(e.target.value)} aria-label="Spec">
            {PART_SPEC_KEYS.map((k) => <option key={k} value={k}>{SPEC_KEY_LABEL[k]}</option>)}
          </select>
          <input id={'inv-newval-' + p.id} value={newVal} onChange={(e) => setNewVal(e.target.value)} placeholder="value" aria-label="Value" />
          <button type="button" className="btn btn-sm" disabled={!newVal.trim()} onClick={() => { setSpec(newKey, newVal); setNewVal(''); }}>Add</button>
        </div>
      </div>

      <div className="inv-chat">
        <h4>Confirm it in chat {chatLive ? <span className="fbadge live">LIVE</span> : <span className="fbadge local">LOCAL</span>}</h4>
        {!chatLive && health !== undefined && <p className="faint g-small">The live model is off (<LiveOffReason h={health ?? null} route="chat" />). The offline helper records numbers with units and a “yes”.</p>}
        <div className="inv-log" ref={logRef}>
          {p.chat.length === 0 && (
            <p className="faint g-small">Tell it what you know: “that’s a 3S 2200 mAh LiPo, I have two”, or just “yes, that’s right”.</p>
          )}
          {p.chat.map((c: ChatLine, i) => (
            <p key={i} className={'inv-msg ' + c.role}>
              {c.role === 'assistant' && c.live && <span className="fbadge live">LIVE</span>} {c.text}
            </p>
          ))}
          {busy && (chatLive
            ? <div className="inv-msg assistant"><LiveProgress what="Muse Spark is reading your answer" next="Any change it proposes waits for your confirmation" typical="usually 5–30 s" /></div>
            : <p className="inv-msg assistant faint" role="status">Thinking…</p>)}
        </div>
        <form className="inv-compose" onSubmit={(e) => { e.preventDefault(); if (!busy) send(); }}>
          <input id={'inv-msg-' + p.id} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Correct it or confirm it…" />
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !msg.trim()}>Send</button>
        </form>
      </div>

      <div className="inv-actions">
        {p.status !== 'confirmed'
          ? <button type="button" className="btn btn-primary" onClick={() => onChange({ ...p, status: 'confirmed', confidence: 'owner' })}>Confirm this part</button>
          : <button type="button" className="btn" onClick={() => onChange({ ...p, status: 'needs_confirmation' })}>Mark as unconfirmed</button>}
        <button type="button" className="btn btn-ghost" onClick={onDelete}>Remove from inventory</button>
      </div>
    </div>
  );
}

export default function Inventory() {
  const [parts, saveParts, ready] = useStore<InventoryPart[]>(INVENTORY_KEY, []);
  const [health, setHealth] = useState<LiveHealth | null | undefined>(undefined);
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'needs_confirmation' | 'confirmed'>('all');
  const [queue, setQueue] = useState(0);
  const [error, setError] = useState('');
  const photoRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const partsRef = useRef(parts);
  partsRef.current = parts;

  useEffect(() => { liveHealth().then(setHealth); }, []);
  const partLive = routeOn(health ?? null, 'part');
  const lm = useLiveMode('part_chat', 'mock');
  const onLive = (err?: unknown) => (err === undefined ? lm.noteSuccess() : lm.noteFailure(err));

  const commit = (next: InventoryPart[]) => {
    partsRef.current = next;
    setError(saveParts(next) ?? '');
  };
  const update = (p: InventoryPart) => commit(partsRef.current.map((x) => (x.id === p.id ? p : x)));
  const patch = (id: string, fn: (latest: InventoryPart) => InventoryPart) =>
    commit(partsRef.current.map((x) => (x.id === id ? fn(x) : x)));

  const addPhotos = async (files: FileList | null) => {
    if (!files || !files.length) return;
    const list = Array.from(files);
    setQueue((q) => q + list.length);
    for (const f of list) {
      let part: InventoryPart;
      try {
        const { full, thumb } = await preparePhoto(f);
        part = blankPart('photo', thumb);
        commit([part, ...partsRef.current]);
        setOpenId(part.id);
        const blank = part;
        let found: Partial<InventoryPart> = {};
        let opening: ChatLine;
        if (partLive) {
          try {
            const r = await postJSON<{ part: Omit<InventoryPart, 'id'> }>('/part', { image_data_url: full });
            const id = r.part;
            found = { name: id.name, category: id.category, quantity: id.quantity, condition: id.condition, specs: id.specs };
            opening = { role: 'assistant', live: true, text: `This looks like ${id.name} (${id.confidence} confidence). ${id.question || 'Is that right?'}` };
            const extra = { catalog_part_id: id.catalog_part_id, read_from_label: id.read_from_label, confidence: id.confidence, question: id.question };
            /* The owner may have edited the card while it was being
             * identified: their edits win (mergeUpdate). */
            patch(blank.id, (latest) => ({ ...mergeUpdate(latest, blank, found), ...extra, chat: [opening, ...latest.chat] }));
            continue;
          } catch (e) {
            opening = { role: 'assistant', text: `I couldn’t identify this one (${(e as Error).message}). Tell me what it is and I’ll record it.` };
          }
        } else {
          opening = { role: 'assistant', text: 'Live identification is off right now. Fill in the name and specs, or tell me what it is.' };
        }
        patch(blank.id, (latest) => ({ ...mergeUpdate(latest, blank, { name: 'Unidentified part' }), chat: [opening, ...latest.chat] }));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setQueue((q) => q - 1);
      }
    }
  };

  const importFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const doc = JSON.parse(await f.text());
      const list: InventoryPart[] = Array.isArray(doc) ? doc : doc.parts;
      if (!Array.isArray(list)) throw new Error('no parts list');
      const have = new Set(partsRef.current.map((p) => p.id));
      commit([...partsRef.current, ...list.filter((p) => p && p.id && !have.has(p.id))]);
    } catch (e) {
      setError(`${f.name} is not an inventory export (${(e as Error).message}).`);
    }
  };

  const shown = parts.filter((p) => filter === 'all' || p.status === filter);
  const summary = useMemo(() => {
    const by: Record<string, number> = {};
    for (const p of parts) by[p.category] = (by[p.category] ?? 0) + p.quantity;
    return Object.entries(by).sort((a, b) => b[1] - a[1]);
  }, [parts]);
  const pending = parts.filter((p) => p.status !== 'confirmed').length;
  const open = parts.find((p) => p.id === openId) ?? null;

  if (!ready) return <p className="muted">Loading your inventory…</p>;

  return (
    <div className="inv">
      <ModeBanner mode={lm.mode} reason={lm.reason}>
        {health === undefined ? null : partLive
          ? 'Photo identification is live too.'
          : `Photo identification is off (${offReason(health, 'part')}); photos are still saved for you to name.`}
        {lm.mode === 'mock' ? ' The part chat uses an offline helper that records numbers with units and a “yes”.' : null}
      </ModeBanner>
      <div className="inv-toolbar">
        <input ref={photoRef} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => { addPhotos(e.target.files); e.target.value = ''; }} />
        <button type="button" className="btn btn-primary" onClick={() => photoRef.current?.click()}>Photograph parts</button>
        <button type="button" className="btn" onClick={() => { const p = blankPart('manual', null); commit([p, ...parts]); setOpenId(p.id); }}>Add by hand</button>
        <span className="inv-spacer" />
        <button type="button" className="btn btn-sm" disabled={!parts.length} onClick={() => downloadJSON('robotforge-inventory.json', { parts })}>Export</button>
        <input ref={importRef} type="file" accept=".json,application/json" hidden onChange={(e) => { importFile(e.target.files?.[0]); e.target.value = ''; }} />
        <button type="button" className="btn btn-sm" onClick={() => importRef.current?.click()}>Import</button>
      </div>
      {queue > 0 && partLive && <LiveProgress what={`Muse Spark is identifying ${queue} photo${queue === 1 ? '' : 's'}`} next="Each part opens in a chat so you can confirm it" />}
      {error && <p className="g-error" role="alert">{error}</p>}

      {parts.length > 0 && (
        <div className="inv-summary">
          <span><strong>{parts.reduce((a, p) => a + p.quantity, 0)}</strong> parts</span>
          <span><strong>{pending}</strong> to confirm</span>
          {summary.slice(0, 6).map(([c, n]) => <span key={c} className="faint">{label(c)} ×{n}</span>)}
        </div>
      )}

      <div className="g-tabs" role="tablist" aria-label="Filter parts">
        {([['all', 'All'], ['needs_confirmation', 'Needs confirmation'], ['confirmed', 'Confirmed']] as const).map(([id, l]) => (
          <button key={id} type="button" className="chip" role="tab" aria-pressed={filter === id} onClick={() => setFilter(id)}>{l}</button>
        ))}
      </div>

      <div className="inv-layout">
        <div className="inv-grid">
          {shown.length === 0 && (
            <div className="inv-empty">
              <h3>{parts.length ? 'Nothing in this filter' : 'Start with what’s on your shelf'}</h3>
              <p className="muted">Photograph each part, or a few at once. Muse Spark reads the labels, guesses the rest, and asks you one question to confirm. Confirmed batteries, motors and wheels can be fitted to a robot in <Link href="/garage/">My robots</Link>.</p>
            </div>
          )}
          {shown.map((p) => <PartCard key={p.id} p={p} active={p.id === openId} onOpen={() => setOpenId(p.id)} />)}
        </div>
        {open && (
          <PartDetail key={open.id} p={open} health={health} onChange={update} onPatch={patch} onDelete={() => { commit(parts.filter((x) => x.id !== open.id)); setOpenId(null); }} onLive={onLive} />
        )}
      </div>
    </div>
  );
}
