import { CONTRADICTS_INSTRUCTION_MARKER } from "@/agents/memorySaveRules";

export interface MemoryRule {
  rule: string;
  context: string;
  line: number;
}

export interface SavedRule {
  rule: string;
  replaced?: string;
  contradicts?: string;
}

export interface MemorySave extends SavedRule {
  agentName: string;
  memoryPath: string;
}

const HEADING = /^#{1,6}\s/;
const CONTEXT_LINE = /^\d{4}-\d{2}-\d{2}\b/;
const SURROUNDING_QUOTES = /^["“]|["”]\.?$/g;

export function readMemoryRules(text: string): MemoryRule[] {
  const rules: MemoryRule[] = [];
  text.split(/\r?\n/).forEach((raw, line) => {
    const trimmed = raw.trim();
    if (!trimmed || HEADING.test(trimmed)) return;
    const previous = rules[rules.length - 1];
    if (CONTEXT_LINE.test(trimmed)) {
      if (previous?.line === line - 1 && !previous.context) previous.context = trimmed;
      return;
    }
    rules.push({ rule: trimmed, context: "", line });
  });
  return rules;
}

function sameRule(rule: string): string {
  return rule.replace(/\s+/g, " ");
}

function contradiction(context: string): string | undefined {
  const at = context.indexOf(CONTRADICTS_INSTRUCTION_MARKER);
  if (at === -1) return undefined;
  const sentence = context
    .slice(at + CONTRADICTS_INSTRUCTION_MARKER.length)
    .trim()
    .replace(SURROUNDING_QUOTES, "");
  return sentence || undefined;
}

// The chat shows exactly the sentence the agent wrote, so a save is read from the file before and after the turn
// rather than from the edit; rewording, moving or re-dating a rule is no save.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/942
export function readMemorySaves(before: string | null, after: string | null): SavedRule[] {
  const old = readMemoryRules(before ?? "");
  const next = readMemoryRules(after ?? "");
  const oldRules = new Set(old.map(({ rule }) => sameRule(rule)));
  const nextRules = new Set(next.map(({ rule }) => sameRule(rule)));
  const removed = old.filter(({ rule }) => !nextRules.has(sameRule(rule)));
  const added = next.filter(({ rule }) => !oldRules.has(sameRule(rule)));
  const quoted = added.map(({ context }) => removed.find((old) => context.includes(old.rule)));
  const unquoted = removed.filter((old) => !quoted.includes(old));
  return added.map(({ rule, context }, index) => {
    // The rules forbid rewriting other lines, so a rule removed in the same save is the one replaced, even when a
    // small model leaves out the Replaces marker. https://github.com/Brevilabs/obsidian-copilot-private/issues/767
    const replaced = quoted[index] ?? unquoted.shift();
    const contradicts = contradiction(context);
    return {
      rule,
      ...(replaced ? { replaced: replaced.rule } : {}),
      ...(contradicts ? { contradicts } : {}),
    };
  });
}

export interface MemoryOwner {
  agentName: string;
  memoryPath: string;
}

export function readTurnMemorySaves(
  changes: ReadonlyArray<{ path: string; before: string | null; after: string | null }>,
  { agentName, memoryPath }: MemoryOwner
): MemorySave[] {
  const change = changes.find((candidate) => candidate.path === memoryPath);
  if (!change) return [];
  return readMemorySaves(change.before, change.after).map((saved) => ({
    ...saved,
    agentName,
    memoryPath,
  }));
}
