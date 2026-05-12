export type StateId = string;
export type Transition = { from: StateId; to: StateId };
export type RuleKey = `${StateId}>${StateId}`;

export function keyOf(from: StateId, to: StateId): RuleKey {
  return `${from}>${to}` as RuleKey;
}

export function fromTransitions(transitions: Transition[]): Set<RuleKey> {
  const s = new Set<RuleKey>();
  for (const t of transitions) s.add(keyOf(t.from, t.to));
  return s;
}

export function toTransitions(rules: Set<RuleKey>): Transition[] {
  const out: Transition[] = [];
  for (const k of rules) {
    const i = k.indexOf(">");
    out.push({ from: k.slice(0, i), to: k.slice(i + 1) });
  }
  return out;
}

export function has(rules: Set<RuleKey>, from: StateId, to: StateId): boolean {
  return rules.has(keyOf(from, to));
}

export function countOutbound(rules: Set<RuleKey>, from: StateId): number {
  let n = 0;
  for (const k of rules) if (k.startsWith(`${from}>`)) n++;
  return n;
}
