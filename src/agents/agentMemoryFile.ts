import { readMemoryRules, sameRule } from "@/agents/memorySaves";
import { TFile, type Vault } from "obsidian";

export interface RuleToSave {
  rule: string;
  why: string;
  replaces?: string;
  contradicts?: string;
}

export interface MemoryWrite {
  text: string;
  replaced?: string;
}

const CONTRADICTS_INSTRUCTION_MARKER = "Contradicts instruction:";
const DATE = /^\d{4}-\d{2}-\d{2}/;

export function localDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Copilot writes each rule in the format models wrote by hand, so files from either read the same, and a save touches only its own rule's lines, even in a file the user reshaped by hand.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/988
export function writeMemoryRule(text: string, save: RuleToSave, date: string): MemoryWrite | null {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const notes = [date, save.why];
  if (save.contradicts) notes.push(`${CONTRADICTS_INSTRUCTION_MARKER} "${save.contradicts}"`);
  if (save.replaces !== undefined) {
    const wanted = sameRule(save.replaces);
    const old = readMemoryRules(text).find(({ rule }) => sameRule(rule) === wanted);
    if (!old) return null;
    const oldDate = DATE.exec(old.context)?.[0];
    notes.splice(1, 0, `Replaces "${old.rule}"${oldDate ? ` (${oldDate})` : ""}`);
    lines.splice(old.line, old.context ? 2 : 1, save.rule, notes.join(" · "));
    return { text: lines.join(eol), replaced: old.rule };
  }
  while (lines.length > 0 && !lines[lines.length - 1].trim()) lines.pop();
  if (lines.length > 0) lines.push("");
  lines.push(save.rule, notes.join(" · "), "");
  return { text: lines.join(eol) };
}

export async function saveMemoryRule(
  vault: Vault,
  path: string,
  save: RuleToSave,
  date: string
): Promise<MemoryWrite | null> {
  const file = vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) {
    const written = writeMemoryRule("", save, date);
    if (written) await vault.create(path, written.text);
    return written;
  }
  let written: MemoryWrite | null = null;
  await vault.process(file, (text) => {
    written = writeMemoryRule(text, save, date);
    return written?.text ?? text;
  });
  return written;
}
