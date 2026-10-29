/* A word with its plain-English meaning one hover or tap away. The
 * meaning comes from lib/glossary.ts. */
import type { ReactNode } from 'react';
import { GLOSSARY, type GlossaryKey } from '@/lib/glossary';

export default function Term({ k, children }: { k: GlossaryKey; children?: ReactNode }) {
  const g = GLOSSARY[k];
  const id = 'term-' + String(k);
  return (
    <span className="term" tabIndex={0} aria-describedby={id}>
      {children ?? g.term}
      <span className="term-tip" role="tooltip" id={id}>{g.plain}</span>
    </span>
  );
}

export function Glossary({ keys }: { keys?: GlossaryKey[] }) {
  const list = keys ?? (Object.keys(GLOSSARY) as GlossaryKey[]);
  return (
    <dl className="glossary">
      {list.map((k) => (
        <div key={String(k)}>
          <dt>{GLOSSARY[k].term}</dt>
          <dd>{GLOSSARY[k].plain}</dd>
        </div>
      ))}
    </dl>
  );
}
