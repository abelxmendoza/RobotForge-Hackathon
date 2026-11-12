/** View-only assembly practice. Never changes a robot record or test verdict. */
export interface BenchState { active: boolean; off: number; direction: 1 | -1 }
export type BenchCommand = 'assemble' | 'disassemble' | 'next' | 'back' | 'reset' | 'hint' | 'explain';
export const BENCH_EVENT = 'rf-workshop-bench';
export const BENCH_PROGRESS_KEY = 'rf.bench-progress.v1';
export interface BenchResult { command: BenchCommand; handled: boolean; message: string }

export function benchTransition(state: BenchState, command: BenchCommand, count: number): BenchState {
  if (!count) return state;
  if (command === 'assemble') return { active: true, off: count, direction: -1 };
  if (command === 'disassemble') return { active: true, off: 0, direction: 1 };
  if (command === 'reset') return { active: false, off: 0, direction: 1 };
  if (!state.active) return state;
  const delta = command === 'next' ? state.direction : command === 'back' ? -state.direction : 0;
  return { ...state, off: Math.min(count, Math.max(0, state.off + delta)) };
}

export function restoreBench(value: unknown, identity: string, count: number): BenchState | null {
  if (!value || typeof value !== 'object') return null;
  const entry = value as { identity?: unknown; state?: Partial<BenchState> };
  const s = entry.state;
  return entry.identity === identity && s && typeof s.active === 'boolean' &&
    Number.isInteger(s.off) && s.off! >= 0 && s.off! <= count && (s.direction === 1 || s.direction === -1)
    ? { active: s.active, off: s.off!, direction: s.direction } : null;
}

export function parseBenchCommand(text: string): BenchCommand | null {
  const q = text.trim().toLowerCase().replace(/[.!]+$/, '');
  const commands: Record<string, BenchCommand> = {
    'start guided assembly': 'assemble', 'assemble step by step': 'assemble',
    'walk me through building this robot': 'assemble',
    'take it apart': 'disassemble', 'start teardown': 'disassemble',
    'next assembly step': 'next', 'next part': 'next',
    'previous assembly step': 'back', 'undo assembly step': 'back',
    'reset assembly': 'reset', 'assembly hint': 'hint',
    'explain this part': 'explain',
  };
  return commands[q] ?? null;
}

export function requestBench(command: BenchCommand): BenchResult {
  const result: BenchResult = { command, handled: false, message: '' };
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(BENCH_EVENT, { detail: result }));
  return result;
}
