"use client";
/* Paperclip for Wrench on every page: picks a file, works out which
 * ingestion flow it belongs to, and hands it to Wrench in the Workshop (/garage/)
 * with whatever was typed alongside it. */
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { HANDOFF_ACCEPT, handoffKind, setHandoff } from "@/lib/handoff";

export default function AttachButton({ text, className, onSent, request = 0 }: { request?:number; text: string; className?: string; onSent?: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const pathname=usePathname();
  useEffect(()=>{if(request>0)ref.current?.click();},[request]);
  const [err, setErr] = useState("");
  return (
    <>
      <button
        type="button"
        className={className ?? "chat-bar-attach"}
        onClick={() => ref.current?.click()}
        aria-label="Attach a photo, document, spec file or scan"
        title="Attach a photo, parts list, spec (.json) or scan (.glb/.obj/.ply)"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 11.5 12.6 19.9a5.5 5.5 0 0 1-7.8-7.8l8.5-8.5a3.7 3.7 0 0 1 5.2 5.2l-8.5 8.5a1.8 1.8 0 0 1-2.6-2.6l7.8-7.8" />
        </svg>
      </button>
      {err && <span className="chat-attach-err" role="status">{err}</span>}
      <input
        ref={ref}
        type="file"
        accept={HANDOFF_ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          const f = files[0];
          e.target.value = "";
          if (!f) return;
          if (files.length > 1 && !files.every((file) => handoffKind(file) === 'photo')) { setErr('Attach photos together, or one model, spec or parts list at a time.'); return; }
          const kind = handoffKind(f);
          if (!kind) {
            setErr("Wrench reads photos, .json specs, .txt/.csv parts lists and GLB, OBJ or PLY scans.");
            return;
          }
          setErr("");
          setHandoff({ kind, file: f, files, text: text.trim() || (pathname.startsWith('/inventory')?'Identify this part photo for My Parts and Tools.':'') });
          onSent?.();
          router.push("/garage/#wrench");
        }}
      />
    </>
  );
}
