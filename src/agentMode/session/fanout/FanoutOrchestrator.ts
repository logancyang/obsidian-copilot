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
  FANOUT_MISSING_AGENT_ERROR,
  prependPromptText,
  selectSummaryInputs,
  type AgentAnswer,
  type FanoutAnswerer,
  type FanoutTurn,
} from "./fanoutTypes";

export type FanoutHost = ReadOnlySubSessionHost;

interface FanoutTurnContext {
  sessionBackendId: BackendId;
  summarizerPersonaBlock: string | null;
  prompt: PromptContent[];
  originalPromptText: string;
  signal: AbortSignal;
  onChange: (turn: FanoutTurn) => void;
}

export interface FanoutTurnRequest extends FanoutTurnContext {
  agentSlugs: ReadonlyArray<string>;
}

export interface FanoutRunInput extends FanoutTurnContext {
  answerers: ReadonlyArray<FanoutAnswerer>;
}

export function createFanoutTurn(answerers: ReadonlyArray<FanoutAnswerer>): FanoutTurn {
  const answers: Record<string, AgentAnswer> = {};
  for (const answerer of answerers) {
    answers[answerer.slug] = {
      agentSlug: answerer.slug,
      name: answerer.name,
      icon: answerer.icon,
      status: "running",
      text: "",
    };
  }
  return { answers, summary: { status: "pending", text: "" } };
}

export class FanoutOrchestrator {
  private readonly subSessions: ReadOnlySubSessionRunner;

  constructor(host: FanoutHost) {
    this.subSessions = new ReadOnlySubSessionRunner(host);
  }

  async run(input: FanoutRunInput): Promise<FanoutTurn> {
    const turn = createFanoutTurn(input.answerers);
    input.onChange(turn);

    await Promise.all(input.answerers.map((answerer) => this.runAgent(answerer, turn, input)));

    // A sole mentioned agent is already the complete response; invoking the
    // chat's own agent would add an unwanted second voice to a direct request.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/481
    if (input.answerers.length === 1) {
      turn.summary.status = "done";
      input.onChange(turn);
    } else if (!input.signal.aborted) {
      await this.runSummary(turn, input);
    }

    return turn;
  }

  private async runAgent(
    answerer: FanoutAnswerer,
    turn: FanoutTurn,
    input: FanoutRunInput
  ): Promise<void> {
    const slot = turn.answers[answerer.slug];
    const mutateIfRunning = (apply: () => void) => {
      if (slot.status !== "running") return;
      apply();
      input.onChange(turn);
    };
    if (answerer.missing) {
      mutateIfRunning(() => {
        slot.status = "error";
        slot.error = FANOUT_MISSING_AGENT_ERROR;
      });
      return;
    }
    try {
      const outcome = await this.subSessions.run({
        backendId: answerer.backendId ?? input.sessionBackendId,
        // The agent's identity leads its prompt, so it answers in character and
        // with what it remembers (`designdocs/CUSTOM_AGENTS.md` §6).
        prompt: prependPromptText(input.prompt, answerer.personaBlock ?? ""),
        signal: input.signal,
        onText: (text) => mutateIfRunning(() => (slot.text += text)),
      });
      mutateIfRunning(() => (slot.status = outcome === "aborted" ? "cancelled" : "done"));
    } catch (err) {
      mutateIfRunning(() => {
        logWarn(`[AgentMode] fan-out agent ${answerer.slug} failed`, err);
        slot.status = "error";
        slot.error = err2String(err);
      });
    }
  }

  private async runSummary(turn: FanoutTurn, input: FanoutRunInput): Promise<void> {
    const inputs = selectSummaryInputs(turn);
    const summaryPrompt = buildSummaryUserPrompt(input.originalPromptText, inputs);
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
        backendId: input.sessionBackendId,
        prompt: prependPromptText(summaryPrompt, input.summarizerPersonaBlock ?? ""),
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
