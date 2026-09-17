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

/**
 * What the orchestrator needs from the session manager on top of the
 * read-only sub-session seam every answer and the summary run in.
 */
export interface FanoutHost extends ReadOnlySubSessionHost {
  /** Display label for `backendId`, used to label each agent's answer; falls back to the id. */
  getDisplayName(backendId: BackendId): string;
}

/** Inputs for one fan-out turn — identical prompt + context for every agent. */
export interface FanoutRunInput {
  /**
   * The `@`-mentioned installed answerers (deduped). Each gets an answer slot.
   * Decoupled from {@link mainAgent}: the multi-answer summarizer answers only
   * if itself mentioned.
   */
  agents: ReadonlyArray<BackendId>;
  /**
   * The session's main agent — the summarizer for multi-agent turns, tracked
   * separately from {@link agents}, whether or not it is one of the answerers.
   */
  mainAgent: BackendId;
  /** The identical prompt blocks (text envelope + context + images) every agent receives. */
  prompt: PromptContent[];
  /**
   * Plain text of the user's original question, fed to the summary prompt.
   * Distinct from {@link prompt}, which also carries preamble + context envelope.
   */
  originalPromptText: string;
  /** Aborts every in-flight sub-session prompt when fired. */
  signal: AbortSignal;
  /** Called whenever any slot mutates, so the UI can render live partials. */
  onChange: (turn: FanoutTurn) => void;
}

/**
 * Build the initial live turn: one `running` slot per ANSWERER (insertion order
 * preserved) plus a pending summary. Exported so the caller can seed the UI
 * before the first stream chunk lands.
 */
export function createFanoutTurn(agents: ReadonlyArray<BackendId>): FanoutTurn {
  const answers: Record<BackendId, AgentAnswer> = {};
  for (const backendId of agents) {
    answers[backendId] = { backendId, status: "running", text: "" };
  }
  return { answers, summary: { status: "pending", text: "" } };
}

/**
 * Orchestrates a multi-agent read-only QA turn. Every ANSWERER runs in an
 * ephemeral, read-only sub-session on its own backend (never a visible
 * AgentSession/tab) with the identical prompt; answers stream into per-agent
 * slots of one {@link FanoutTurn}. With multiple answerers, the main agent
 * writes the narrative summary over the survivors after every answer settles.
 *
 * One agent's error never throws out of the run — its slot goes `error`, others
 * continue. Prompts are cancellable via `signal`; every sub-session closes at
 * turn end.
 */
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
      // Every answer settled; the main agent summarizes the survivors. Cancellation
      // skips it — nothing to reconcile and the turn is ending.
      await this.runSummary(turn, input);
    }

    return turn;
  }

  /**
   * Run one agent in an ephemeral read-only sub-session. Resolves (never rejects)
   * once the slot is terminal, so one agent's failure never throws out of the run:
   *
   * - normal completion → `done`
   * - user cancel (run signal aborted) → `cancelled` (not a fault)
   * - per-agent timeout → `error` with the timeout reason
   * - any thrown backend call → `error` with the failure text
   */
  private async runAgent(
    backendId: BackendId,
    turn: FanoutTurn,
    input: FanoutRunInput
  ): Promise<void> {
    const slot = turn.answers[backendId];
    // A slot transitions only while `running`; once terminal it is frozen. Gating
    // every mutation here keeps streamed text, the status flip, and the error path
    // from racing each other.
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
      // An abort is a clean cancel, not a fault: the slot goes `cancelled`, not `done`.
      mutateIfRunning(() => (slot.status = outcome === "aborted" ? "cancelled" : "done"));
    } catch (err) {
      mutateIfRunning(() => {
        logWarn(`[AgentMode] fan-out agent ${backendId} failed`, err);
        slot.status = "error";
        slot.error = err2String(err);
      });
    }
  }

  /**
   * The main agent's narrative summary, over the agents that SUCCEEDED
   * ({@link selectSummaryInputs}). With ZERO successes it lands `done` with a
   * brief all-failed note rather than an invented summary or a hard error. Runs
   * read-only in its own ephemeral sub-session of the main backend, streaming
   * into `summary.text` while status moves pending → streaming → done.
   */
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
      // Only a clean finish is trustworthy; an aborted summary leaves partial text
      // the continuity replay must not prefer.
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
