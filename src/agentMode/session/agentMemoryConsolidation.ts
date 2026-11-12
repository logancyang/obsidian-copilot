import { buildAgentMemorySkeleton } from "@/agents/agentFile";
import {
  boundConsolidationNotes,
  buildAgentMemoryConsolidationPrompt,
  formatMemoryEntryDate,
  previousMemoryDay,
  reviewMemoryUpdate,
  type MemoryUpdateRejection,
} from "@/agents/agentMemory";
import type { AgentMemoryPassDeps } from "@/agentMode/session/agentMemoryPass";
import type { BackendId } from "@/agentMode/session/types";
import { logInfo, logWarn } from "@/logger";
import { err2String } from "@/utils";

export interface AgentMemoryConsolidationRequest {
  agentSlug: string;
  sessionBackendId: BackendId;
  signal: AbortSignal;
  now?: Date;
}

export type AgentMemoryConsolidationOutcome =
  | { status: "written"; agentName: string; memoryPath: string; consolidatedThrough: string }
  | { status: "skipped"; reason: "no-agent" | "memory-off" | "no-new-notes" }
  | { status: "rejected"; reason: MemoryUpdateRejection }
  | { status: "conflict" }
  | { status: "failed"; error: string };

export async function runAgentMemoryConsolidation(
  deps: AgentMemoryPassDeps,
  request: AgentMemoryConsolidationRequest
): Promise<AgentMemoryConsolidationOutcome> {
  try {
    const record = await deps.files.readAgent(request.agentSlug);
    if (!record) return { status: "skipped", reason: "no-agent" };
    const { agent } = record;
    if (!agent.memoryEnabled) return { status: "skipped", reason: "memory-off" };

    const stored = await deps.files.readMemoryDocument(agent.slug);
    const currentMemory = stored?.body.trim() || buildAgentMemorySkeleton(agent.name);
    const expectedHash = stored?.hash ?? null;

    const today = formatMemoryEntryDate(request.now ?? new Date());
    const pending = await deps.files.readDailyNotesAfter(
      agent.slug,
      readNotesAfter(stored?.consolidatedThrough ?? null, today)
    );
    if (pending.length === 0) return { status: "skipped", reason: "no-new-notes" };
    const consolidatedThrough = pending[pending.length - 1].date;
    const notes = boundConsolidationNotes(pending);

    const prompt = buildAgentMemoryConsolidationPrompt({
      agentName: agent.name,
      currentMemory,
      notes,
      today: request.now ?? new Date(),
    });

    let returned = "";
    const outcome = await deps.subSessions.run({
      backendId: agent.backendId || request.sessionBackendId,
      prompt: [{ type: "text", text: prompt }],
      signal: request.signal,
      onText: (text) => {
        returned += text;
      },
    });
    if (outcome === "aborted") return { status: "failed", error: "Consolidation was cancelled." };

    const review = reviewMemoryUpdate(currentMemory, returned);
    if (!review.accepted) {
      logWarn(
        `[Agents] Rejected a consolidation for "${agent.slug}" (${review.reason}); keeping the existing file`
      );
      return { status: "rejected", reason: review.reason };
    }

    const written = await deps.files.writeConsolidatedMemory(
      agent.slug,
      review.text,
      consolidatedThrough,
      expectedHash
    );
    if (written === "conflict") {
      logInfo(
        `[Agents] Discarded a consolidation for "${agent.slug}": MEMORY.md changed while it ran`
      );
      return { status: "conflict" };
    }

    logInfo(`[Agents] Consolidated memory at ${record.memoryPath} through ${consolidatedThrough}`);
    return {
      status: "written",
      agentName: agent.name,
      memoryPath: record.memoryPath,
      consolidatedThrough,
    };
  } catch (error) {
    logWarn(`[Agents] Consolidation failed for "${request.agentSlug}"`, error);
    return { status: "failed", error: err2String(error) };
  }
}

export function readNotesAfter(consolidatedThrough: string | null, today: string): string | null {
  if (!consolidatedThrough) return null;
  return consolidatedThrough >= today ? previousMemoryDay(today) : consolidatedThrough;
}

export async function hasUnconsolidatedNotes(
  files: AgentMemoryPassDeps["files"],
  slug: string
): Promise<boolean> {
  const dates = files.listDailyNoteDates(slug);
  if (dates.length === 0) return false;
  const stored = await files.readMemoryDocument(slug);
  if (!stored?.consolidatedThrough) return true;
  const newestDate = dates[dates.length - 1];
  if (newestDate > stored.consolidatedThrough) return true;
  const newest = await files.readDailyNote(slug, newestDate);
  return newest !== null && newest.modifiedAtMs > stored.modifiedAtMs;
}
