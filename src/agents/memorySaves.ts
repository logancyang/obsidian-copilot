export interface MemoryRule {
  rule: string;
  context: string;
  line: number;
}

export interface MemorySave {
  rule: string;
  replaced?: string;
  contradicts?: string;
  agentName: string;
  memoryPath: string;
}

const HEADING = /^#{1,6}\s/;
const CONTEXT_LINE = /^\d{4}-\d{2}-\d{2}\b/;
const ENDS_ON = /^Until (\d{4}-\d{2}-\d{2}):/;

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

export function sameRule(rule: string): string {
  return rule.replace(/\s+/g, " ").trim();
}

// A rule kept "Until" a date stops holding after it, so the chat's prompt leaves it out while the file keeps it for the user to tidy.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/988
export function withoutEndedRules(text: string, today: string): string {
  const ended = new Set(
    readMemoryRules(text)
      .filter(({ rule }) => (ENDS_ON.exec(rule)?.[1] ?? today) < today)
      .flatMap(({ line, context }) => (context ? [line, line + 1] : [line]))
  );
  if (ended.size === 0) return text;
  return text
    .split("\n")
    .filter((_, line) => !ended.has(line))
    .join("\n");
}
