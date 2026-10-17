import { byteLength, headOfText, tailOfText } from "@/utils/logTail";

const HEADER_PREFIX = '{"frameSink":"conversation",';
const OMITTED_LINE = `${JSON.stringify({ frameSink: "elided" })}\n`;

function fitFrames(text: string, maxBytes: number): string {
  if (byteLength(text) <= maxBytes) return text;
  const markerBytes = byteLength(OMITTED_LINE);
  if (maxBytes < markerBytes) throw new Error("Frame-log budget cannot hold an omission marker");
  const room = maxBytes - markerBytes;
  const headBudget = Math.floor(room / 3);
  const tailBudget = room - headBudget;
  let head = headBudget === 0 ? "" : headOfText(text, headBudget).text;
  const lastHeadNewline = head.lastIndexOf("\n");
  head = lastHeadNewline < 0 ? "" : head.slice(0, lastHeadNewline + 1);
  let suffix = tailBudget === 0 ? "" : tailOfText(text, tailBudget).text;
  const suffixStart = text.length - suffix.length;
  if (suffixStart > 0 && text[suffixStart - 1] !== "\n") {
    const firstNewline = suffix.indexOf("\n");
    suffix = firstNewline < 0 ? "" : suffix.slice(firstNewline + 1);
  }
  if (suffix && !suffix.endsWith("\n")) {
    const finalNewline = suffix.lastIndexOf("\n");
    suffix = finalNewline < 0 ? "" : suffix.slice(0, finalNewline + 1);
  }
  return head + OMITTED_LINE + suffix;
}

export function fitConversationFrames(text: string, maxBytes: number): string {
  if (byteLength(text) <= maxBytes) return text;
  const lines = text.split("\n");
  const sections: { header: string; body: string }[] = [];
  let current: { header: string; body: string } | null = null;
  let body = "";
  for (const [index, value] of lines.entries()) {
    const line = value + (index < lines.length - 1 ? "\n" : "");
    if (line.startsWith(HEADER_PREFIX)) {
      if (current) {
        current.body = body;
        sections.push(current);
      }
      current = { header: line, body: "" };
      body = "";
    } else {
      body += line;
    }
  }
  if (current) {
    current.body = body;
    sections.push(current);
  }
  if (sections.length === 0) return fitFrames(text, maxBytes);
  const headers = sections.reduce((sum, section) => sum + byteLength(section.header), 0);
  const bodyBudget = maxBytes - headers;
  if (
    bodyBudget < 0 ||
    (bodyBudget < sections.length * byteLength(OMITTED_LINE) &&
      sections.some(
        (section) => byteLength(section.body) > Math.floor(bodyBudget / sections.length)
      ))
  ) {
    throw new Error("Frame-log budget cannot hold every section header and omission marker");
  }
  const share = Math.floor(bodyBudget / sections.length);
  try {
    return sections.map((section) => section.header + fitFrames(section.body, share)).join("");
  } catch {
    throw new Error("Frame-log budget cannot hold every section header and omission marker");
  }
}
