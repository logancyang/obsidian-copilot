import { logWarn } from "@/logger";
import { err2String } from "@/utils";
import {
  ReadOnlySubSessionRunner,
  type ReadOnlySubSessionHost,
} from "@/agentMode/session/readOnlySubSession";
import type { BackendId, PromptContent } from "@/agentMode/session/types";
import {
  buildSummaryUserPrompt,
  FANOUT_ALL_FAILED_SUMMARY,
  selectSummaryInputs,
  type AgentAnswer,
  type FanoutTurn,
} from "./fanoutTypes";

export interface FanoutHost extends ReadOnlySubSessionHost {
  getDisplayName(backendId: BackendId): string;
}

export interface FanoutRunInput {
  agents: ReadonlyArray<BackendId>;
  mainAgent: BackendId;
  prompt: PromptContent[];
  originalPromptText: string;
  signal: AbortSignal;
  onChange: (turn: FanoutTurn) => void;
}

export function createFanoutTurn(agents: ReadonlyArray<BackendId>): FanoutTurn {
  const answers: Record<BackendId, AgentAnswer> = {};
  for (const backendId of agents) {
    answers[backendId] = { backendId, status: "running", text: "" };
  }
  return { answers, summary: { status: "pending", text: "" } };
}

export class FanoutOrchestrator {
  private readonly subSessions: ReadOnlySubSessionRunner;

  constructor(private readonly host: FanoutHost) {
    this.subSessions = new ReadOnlySubSessionRunner(host);
  }

  async run(input: FanoutRunInput): Promise<FanoutTurn> {
    const turn = createFanoutTurn(input.agents);
    input.onChange(turn);

    await Promise.all(input.agents.map((backendId) => this.runAgent(backendId, turn, input)));

    // A sole mentioned agent is already the complete response; invoking the main
    // agent would add an unwanted second voice to a direct request.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/481
    if (input.agents.length === 1) {
      turn.summary.status = "done";
      input.onChange(turn);
    } else if (!input.signal.aborted) {
      await this.runSummary(turn, input);
    }

    return turn;
  }

  private async runAgent(
    backendId: BackendId,
    turn: FanoutTurn,
    input: FanoutRunInput
  ): Promise<void> {
    const slot = turn.answers[backendId];
    const mutateIfRunning = (apply: () => void) => {
      if (slot.status !== "running") return;
      apply();
      input.onChange(turn);
    };
    try {
      const outcome = await this.subSessions.run({
        backendId,
        prompt: input.prompt,
        signal: input.signal,
        onText: (text) => mutateIfRunning(() => (slot.text += text)),
      });
      mutateIfRunning(() => (slot.status = outcome === "aborted" ? "cancelled" : "done"));
    } catch (err) {
      mutateIfRunning(() => {
        logWarn(`[AgentMode] fan-out agent ${backendId} failed`, err);
        slot.status = "error";
        slot.error = err2String(err);
      });
    }
  }

  private async runSummary(turn: FanoutTurn, input: FanoutRunInput): Promise<void> {
    const inputs = selectSummaryInputs(turn);
    const summaryPrompt = buildSummaryUserPrompt(input.originalPromptText, inputs, (backendId) =>
      this.host.getDisplayName(backendId)
    );
    if (!summaryPrompt) {
      turn.summary.status = "done";
      turn.summary.text = FANOUT_ALL_FAILED_SUMMARY;
      turn.summary.complete = true;
      input.onChange(turn);
      return;
    }

    turn.summary.status = "streaming";
    input.onChange(turn);
    try {
      const outcome = await this.subSessions.run({
        backendId: input.mainAgent,
        prompt: summaryPrompt,
        signal: input.signal,
        onText: (text) => {
          turn.summary.text += text;
          input.onChange(turn);
        },
      });
      if (outcome === "done") turn.summary.complete = true;
    } catch (err) {
      // Keep setup failures actionable even when only the summary session fails.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/219
      turn.summary.error = err2String(err);
      logWarn(`[AgentMode] fan-out summary failed`, err);
    } finally {
      turn.summary.status = "done";
      input.onChange(turn);
    }
  }
}
