'use client';
import { useState } from 'react';
import type { TaPart } from '@/components/kit/takeapart';

/** Lessons derive from the exact schematic part cards in this bench. */
export default function BenchLearning({parts, onSelect}: {parts: TaPart[]; onSelect: (id: string) => void}) {
  const [question, setQuestion] = useState(0);
  const [answer, setAnswer] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const available = parts.filter(p => p.does);
  const part = available[question];
  if (available.length < 2) return null;
  return <details className="ws-disclosure ws-learn"><summary>Learn how this robot works</summary>
    <p className="faint g-small">Explore the same schematic part groups shown on the bench. These descriptions explain the concept, not verified manufacturer internals.</p>
    <div className="ws-part-picks">{available.map(p => <button type="button" className="chip" key={p.id} onClick={() => onSelect(p.id)}>{p.name}</button>)}</div>
    <h4>Parts quiz</h4>
    {part ? <><p>Question {question + 1} of {available.length} · Score {score}</p><p><strong>Which part has this job?</strong> {part.does}</p>
      <div className="ws-part-picks">{available.map(p => <button type="button" className="chip" key={p.id} disabled={answer !== null} onClick={() => {setAnswer(p.id); onSelect(part.id); if(p.id === part.id) setScore(n => n + 1);}}>{p.name}</button>)}</div>
      {answer && <div role="status"><p>{answer === part.id ? 'Correct.' : `The answer is ${part.name}.`} {part.does}</p><button type="button" className="btn btn-sm" onClick={() => {setQuestion(n => n + 1);setAnswer(null);}}>Next question</button></div>}
    </> : <p role="status">Quiz complete · {score} of {available.length}. <button type="button" className="btn btn-sm" onClick={() => {setQuestion(0);setScore(0);setAnswer(null);}}>Try again</button></p>}
  </details>;
}
