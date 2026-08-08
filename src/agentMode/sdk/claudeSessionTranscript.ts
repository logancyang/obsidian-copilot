import { AI_SENDER, USER_SENDER } from "@/constants";
import { formatDateTime } from "@/utils";
import type { AgentChatMessage } from "@/agentMode/session/types";

/**
 * Parse a Claude Code CLI session transcript (`<sessionId>.jsonl` under
 * `~/.claude/projects/<encoded-cwd>/`) into display-only Agent Mode messages.
 *
 * The Claude Agent SDK has no session-list/transcript API, and `resumeSession`
 * only re-feeds context to the model on the next turn — it returns no prior
 * messages. So for a native (autosave-off) Claude chat, this on-disk transcript
 * is the only way to rebuild the visible conversation when the user reopens it
 * from recent chats. Mirrors the markdown loader: sender + text only, no tool
 * calls / thoughts.
 *
 * Each line is one JSON record. We keep only genuine user prompts and assistant
 * prose, skipping everything else the CLI logs:
 *  - `type: "user"` with a **string** content → a typed prompt.
 *  - `type: "user"` with **array** content → either a multimodal prompt (text +
 *    image blocks, e.g. an attached image) or a `tool_result`. We keep the text
 *    blocks (images are dropped from the display) and skip the record only when
 *    it carries a `tool_result` block, which is agent output rather than input.
 *  - `type: "assistant"` → concatenated `text` blocks (tool_use / thinking
 *    blocks dropped); skipped entirely when the turn was pure tool use.
 *  - `isMeta` / `isSidechain` records, summaries, attachments, queue ops,
 *    ai-title, system → skipped.
 *
 * Best-effort: unparseable lines are ignored rather than aborting the parse.
 */
export function parseClaudeTranscript(jsonlText: string): AgentChatMessage[] {
  const messages: AgentChatMessage[] = [];
  const lines = jsonlText.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    let entry: ClaudeTranscriptEntry;
    try {
      entry = JSON.parse(line) as ClaudeTranscriptEntry;
    } catch {
      continue;
    }
    if (entry.isMeta === true || entry.isSidechain === true) continue;
    const content = entry.message?.content;

    let sender: string | null = null;
    let text = "";
    if (entry.type === "user" && typeof content === "string") {
      sender = USER_SENDER;
      text = stripUserMessageWrapper(content).trim();
    } else if (entry.type === "user" && Array.isArray(content)) {
      // A tool_result is agent output the CLI logs as a user record — skip it.
      // Anything else (text + image blocks) is a genuine multimodal prompt;
      // keep its text and drop the images from the display.
      if (!content.some((b) => b?.type === "tool_result")) {
        sender = USER_SENDER;
        text = stripUserMessageWrapper(joinTextBlocks(content)).trim();
      }
    } else if (entry.type === "assistant" && Array.isArray(content)) {
      sender = AI_SENDER;
      text = joinTextBlocks(content);
    }
    if (!sender || !text) continue;

    messages.push({
      id: `claude-loaded-${messages.length}`,
      sender,
      message: text,
      isVisible: true,
      timestamp: toTimestamp(entry.timestamp),
    });
  }
  return messages;
}

interface ClaudeTranscriptEntry {
  type?: string;
  isMeta?: boolean;
  isSidechain?: boolean;
  timestamp?: unknown;
  message?: {
    role?: string;
    content?: string | ContentBlock[];
  };
}

interface ContentBlock {
  type?: string;
  text?: string;
}

/** Concatenate the `text` blocks of a content array, ignoring tool_use, image, etc. */
function joinTextBlocks(content: ContentBlock[]): string {
  return content
    .filter(
      (b): b is { type: "text"; text: string } => b?.type === "text" && typeof b.text === "string"
    )
    .map((b) => b.text)
    .join("\n\n")
    .trim();
}

/**
 * Unwrap the plugin's `<user-message>…</user-message>` envelope so the stored
 * prompt (which prepends a `<copilot-context>` block when notes are attached)
 * displays as just what the user typed. Returns the input unchanged when no
 * wrapper is present (prompts sent without attached context aren't wrapped).
 */
function stripUserMessageWrapper(content: string): string {
  const match = content.match(/<user-message>\n?([\s\S]*?)\n?<\/user-message>/);
  return match ? match[1] : content;
}

function toTimestamp(raw: unknown): AgentChatMessage["timestamp"] {
  if (typeof raw !== "string") return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return formatDateTime(date);
}
