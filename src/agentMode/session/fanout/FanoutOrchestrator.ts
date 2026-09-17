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

/**
 * What the orchestrator needs from the session manager: just the read-only
 * sub-session seam every answer and the summary run in. Answer tabs and
 * persisted sections are labeled from each {@link FanoutAnswerer}, so nothing
 * here resolves names.
 */
export type FanoutHost = ReadOnlySubSessionHost;

/** What a fan-out turn needs on top of its resolved answerers. */
interface FanoutTurnContext {
  /**
   * Backend the visible chat runs on. It answers for an agent that pins none,
   * and it is where the chat's own agent writes the summary.
   */
  sessionBackendId: BackendId;
  /**
   * The `<agent_persona>` + `<agent_memory>` blocks of the agent this chat is
   * held with, so a DM's own persona writes the summary in its own voice. Null
   * for a chat with the built-in Copilot.
   */
  summarizerPersonaBlock: string | null;
  /** The shared prompt blocks (text envelope + context + images) every agent receives. */
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
 * A fan-out turn as the session asks for it: the `@`-mentioned slugs, which the
 * manager resolves against the agents folder before the turn runs.
 */
export interface FanoutTurnRequest extends FanoutTurnContext {
  agentSlugs: ReadonlyArray<string>;
}

/** Inputs for one fan-out turn — identical prompt and context for every agent. */
export interface FanoutRunInput extends FanoutTurnContext {
  /**
   * The mentioned agents, resolved and in mention order. Each gets an answer
   * slot, including one whose folder has gone (`missing`).
   */
  answerers: ReadonlyArray<FanoutAnswerer>;
}

/**
 * Build the initial live turn: one `running` slot per ANSWERER (mention order
 * preserved) plus a pending summary. Exported so the caller can seed the UI
 * before the first stream chunk lands.
 */
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

/**
 * Orchestrates a multi-agent read-only QA turn. Every ANSWERER runs in an
 * ephemeral, read-only sub-session (never a visible AgentSession/tab) on the
 * backend it pinned or the chat's own, carrying its own persona and memory ahead
 * of the shared prompt; answers stream into per-agent slots of one
 * {@link FanoutTurn}. With multiple answerers, the chat's own agent writes the
 * narrative summary over the survivors after every answer settles.
 *
 * One agent's error never throws out of the run — its slot goes `error`, others
 * continue. Prompts are cancellable via `signal`; every sub-session closes at
 * turn end. See `designdocs/CUSTOM_AGENTS.md` §6.
 */
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
      // Every answer settled; the chat's own agent summarizes the survivors.
      // Cancellation skips it — nothing to reconcile and the turn is ending.
      await this.runSummary(turn, input);
    }

    return turn;
  }

  /**
   * Run one agent in an ephemeral read-only sub-session, on the backend it
   * pinned or the chat's own. Resolves (never rejects) once the slot is
   * terminal, so one agent's failure never throws out of the run:
   *
   * - deleted between composing and sending → `error` saying the agent is gone
   * - normal completion → `done`
   * - user cancel (run signal aborted) → `cancelled` (not a fault)
   * - per-agent timeout → `error` with the timeout reason
   * - any thrown backend call → `error` with the failure text
   */
  private async runAgent(
    answerer: FanoutAnswerer,
    turn: FanoutTurn,
    input: FanoutRunInput
  ): Promise<void> {
    const slot = turn.answers[answerer.slug];
    // A slot transitions only while `running`; once terminal it is frozen. Gating
    // every mutation here keeps streamed text, the status flip, and the error path
    // from racing each other.
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
        // An agent answers on what it pinned, not just where it pinned it
        // (`designdocs/CUSTOM_AGENTS.md` §3).
        selection: answerer.selection,
        // The agent's identity leads its prompt, so it answers in character and
        // with what it remembers (`designdocs/CUSTOM_AGENTS.md` §6).
        prompt: prependPromptText(input.prompt, answerer.personaBlock ?? ""),
        signal: input.signal,
        onText: (text) => mutateIfRunning(() => (slot.text += text)),
      });
      // An abort is a clean cancel, not a fault: the slot goes `cancelled`, not `done`.
      mutateIfRunning(() => (slot.status = outcome === "aborted" ? "cancelled" : "done"));
    } catch (err) {
      mutateIfRunning(() => {
        logWarn(`[AgentMode] fan-out agent ${answerer.slug} failed`, err);
        slot.status = "error";
        slot.error = err2String(err);
      });
    }
  }

  /**
   * The chat's own agent's narrative summary, over the agents that SUCCEEDED
   * ({@link selectSummaryInputs}). With ZERO successes it lands `done` with a
   * brief all-failed note rather than an invented summary or a hard error. Runs
   * read-only in its own ephemeral sub-session on the chat's backend, carrying
   * that chat's persona so a DM is summarized by the agent the user is talking
   * to, streaming into `summary.text` while status moves pending → streaming →
   * done.
   */
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
