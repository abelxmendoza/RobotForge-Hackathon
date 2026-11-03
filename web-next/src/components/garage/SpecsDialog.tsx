'use client';
import { useEffect, useRef, type ReactNode } from 'react';

export default function SpecsDialog({ children, onClose, readOnly = false }: { children: ReactNode; onClose: () => void; readOnly?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => { dialog?.close(); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.ws-edit-specs')?.focus()); };
  }, []);
  return <dialog ref={ref} className="ws-specs-dialog" aria-labelledby="ws-specs-title" onCancel={onClose}>
    <div className="ws-dialog-head"><div><h2 id="ws-specs-title">Robot specs</h2><p className="faint g-small">{readOnly ? 'Estimated reference specs for the built-in twin.' : 'Review the recorded specs. Describe changes in Wrench.'}</p></div><button type="button" className="btn btn-sm" onClick={onClose}>Done</button></div>
    {children}
  </dialog>;
}
