import type { AgentArtifactWrite } from "@/agentMode/acp/types";
import type { AgentPlanEntry, ToolCallDelta } from "@/agentMode/session/types";
import { requireNodeModule } from "@/utils/desktopRuntime";

const CHECKLIST_FILE = "todo.md";
const CHECKLIST_ITEM = /^\s*[-*]\s+\[([ xX/])\]\s+(.+?)\s*$/;

interface ArtifactInput {
  Path?: unknown;
  Content?: unknown;
  ArtifactMetadata?: { RequestFeedback?: unknown } | null;
}

export function readAntigravityArtifactWrite(update: ToolCallDelta): AgentArtifactWrite | null {
  const path = requireNodeModule<typeof import("node:path")>("path");
  const os = requireNodeModule<typeof import("node:os")>("os");
  const input = (update.rawInput ?? {}) as ArtifactInput;
  const filePath =
    update.locations?.[0]?.path ?? (typeof input.Path === "string" ? input.Path : null);
  const brain = path.join(os.homedir(), ".gemini", "antigravity-cli", "brain");
  if (!filePath || path.dirname(path.dirname(filePath)) !== brain) return null;
  const text = writtenText(update, input, filePath);
  if (path.basename(filePath) === CHECKLIST_FILE) {
    return text === undefined
      ? { kind: "checklist" }
      : { kind: "checklist", entries: checklist(text) };
  }
  if (input.ArtifactMetadata?.RequestFeedback !== true) return null;
  return { kind: "plan", plan: text, planFilePath: filePath };
}

function writtenText(
  update: ToolCallDelta,
  input: ArtifactInput,
  filePath: string
): string | undefined {
  if (typeof input.Content === "string") return input.Content;
  if (update.status !== "completed") return undefined;
  const diff = update.content?.find((item) => item.type === "diff" && item.path === filePath);
  if (diff?.type !== "diff") return undefined;
  return diff.newText.endsWith("\n") ? diff.newText.slice(0, -1) : diff.newText;
}

function checklist(text: string): AgentPlanEntry[] {
  return text.split("\n").flatMap((line) => {
    const item = CHECKLIST_ITEM.exec(line);
    if (!item) return [];
    const status =
      item[1] === " " ? "pending" : item[1] === "/" ? "in_progress" : ("completed" as const);
    return [{ content: item[2], status, priority: "medium" as const }];
  });
}
