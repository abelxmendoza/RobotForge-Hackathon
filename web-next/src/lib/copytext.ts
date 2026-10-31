/* Copy helpers for Wrench conversations: plain text out of a message,
 * a whole transcript, and a clipboard write that works without the
 * async Clipboard API (http previews, older Safari). */
import { ASSISTANT_NAME } from './handoff';

export interface CopyMsg {
  who: 'bot' | 'user';
  html?: string;
  text?: string;
}

export function htmlToText(html: string): string {
  if (typeof document === 'undefined') return html.replace(/<[^>]+>/g, '');
  const el = document.createElement('div');
  el.innerHTML = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '$&\n')
    .replace(/<li[^>]*>/gi, '$&• ');
  return (el.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}

export function msgText(m: CopyMsg): string {
  return [m.html ? htmlToText(m.html) : '', m.text?.trim() ?? ''].filter(Boolean).join('\n\n');
}

export function transcript(messages: CopyMsg[]): string {
  return messages
    .map((m) => `${m.who === 'user' ? 'You' : ASSISTANT_NAME}:\n${msgText(m)}`)
    .join('\n\n');
}

/* innerText keeps the line breaks the reader sees; buttons inside the
 * element (chips, the copy button itself) are left out. */
export function elementText(el: HTMLElement | null | undefined): string {
  if (!el) return '';
  const hidden: HTMLElement[] = [];
  el.querySelectorAll<HTMLElement>('button, [data-nocopy]').forEach((b) => {
    if (b.style.display !== 'none') { hidden.push(b); b.style.display = 'none'; }
  });
  const text = el.innerText;
  hidden.forEach((b) => (b.style.display = ''));
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the textarea route */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
