import { redactLogText } from "@/utils/redactLog";

const SERVER_ERROR_STATUS = /(?:^| )http\.status=5\d\d(?: |$)/;
const CAUSE_FIELD = ' cause="';
const STACK_FRAME = /^at /;

// OpenCode answers a failed request with a generic ACP error and logs the real reason only as a
// logfmt `cause=` on its HTTP 5xx line, which it marks `level=INFO`. Its wording is OpenCode-internal,
// so the cause is kept as logged, minus stack frames and the braces closing their inspected error
// properties, and with the home folder's user name redacted for shared screenshots.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/662
export function opencodeServerFailureCause(line: string): string | null {
  if (!SERVER_ERROR_STATUS.test(line)) return null;
  const causeAt = line.indexOf(CAUSE_FIELD);
  if (causeAt === -1) return null;
  const cause = quotedValueFrom(line, causeAt + CAUSE_FIELD.length);
  if (cause === null) return null;
  const parts = cause
    .split("\n")
    .map((part) => part.trim())
    .filter(Boolean);
  const kept = parts.filter((part) => !STACK_FRAME.test(part));
  let openWrappers = parts.filter((part) => STACK_FRAME.test(part) && part.endsWith("{")).length;
  while (openWrappers-- > 0 && kept.at(-1) === "}") kept.pop();
  const message = kept.join("\n");
  return message ? redactLogText(message) : null;
}

function quotedValueFrom(line: string, start: number): string | null {
  let value = "";
  for (let i = start; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') return value;
    if (ch === "\\") {
      i++;
      value += line[i] === "n" ? "\n" : line[i] === "t" ? "\t" : (line[i] ?? "");
    } else {
      value += ch;
    }
  }
  return null;
}
