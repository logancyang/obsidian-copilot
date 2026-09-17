import type { BackendId, ModelSelection } from "@/agentMode/session/types";

/** The three optional pins an `agent.md` can carry. */
export interface AgentPins {
  backendId: string | null;
  modelId: string | null;
  effort: string | null;
}

/**
 * The (model, effort) a chat should open on because of the agent answering it.
 *
 * An agent pins a backend, a model, and an effort independently, so the three
 * combinations that matter are resolved here rather than at each call site:
 * a model pin names the model outright, an effort pin rides on whatever model
 * the chat would otherwise use, and an agent with neither leaves the selection
 * alone. A model id only means something on the backend it was pinned for, so a
 * pin for another backend is dropped rather than sent to one that has never
 * heard of it.
 *
 * See `designdocs/CUSTOM_AGENTS.md` §3 ("Choosing who you are talking to").
 *
 * @param pins - The agent's pins, or null when the answerer is the built-in Copilot.
 * @param backendId - Backend the chat is actually going to run on.
 * @param fallback - Selection the chat would use without any pin; supplies the
 *   model an effort-only pin needs, and is the reason such a pin is dropped when
 *   there is no model to hang it on.
 */
export function resolveAgentPinnedSelection(
  pins: AgentPins | null,
  backendId: BackendId,
  fallback: ModelSelection | null
): ModelSelection | null {
  if (!pins) return null;
  if (pins.backendId && pins.backendId !== backendId) return null;
  if (!pins.modelId && !pins.effort) return null;
  if (pins.modelId) return { baseModelId: pins.modelId, effort: pins.effort };
  if (!fallback) return null;
  return { baseModelId: fallback.baseModelId, effort: pins.effort };
}
