import { GoalCreationState, GoalCreationMessage, GoalExtraction } from "@/types/projects-plus";
import { v4 as uuidv4 } from "uuid";

/**
 * Creates initial state for goal creation flow
 */
export function createInitialState(): GoalCreationState {
  return {
    messages: [],
    extraction: null,
    manualEdits: {},
    isReady: false,
    isStreaming: false,
    error: null,
  };
}

/**
 * Parse extraction block from AI response.
 * Returns null if extraction block not found or invalid JSON.
 */
export function parseGoalExtraction(response: string): GoalExtraction | null {
  const match = response.match(/<goal_extraction>([\s\S]*?)<\/goal_extraction>/);
  if (!match) return null;

  try {
    const data = JSON.parse(match[1]);
    return {
      name: typeof data.name === "string" ? data.name : "",
      description: typeof data.description === "string" ? data.description : "",
      confidence: typeof data.confidence === "number" ? data.confidence : 0,
    };
  } catch {
    return null;
  }
}

/**
 * Strip extraction block from response for display.
 * Removes the hidden XML block so users see clean text.
 */
export function stripExtractionBlock(response: string): string {
  return response.replace(/<goal_extraction>[\s\S]*?<\/goal_extraction>/g, "").trim();
}

/**
 * Get the effective extraction (manual edits override AI extraction)
 */
export function getEffectiveExtraction(state: GoalCreationState): GoalExtraction {
  const base = state.extraction || { name: "", description: "", confidence: 0 };
  return {
    name: state.manualEdits.name ?? base.name,
    description: state.manualEdits.description ?? base.description,
    confidence: base.confidence,
  };
}

/**
 * Check if goal is ready to create (has name and description)
 */
export function checkIsReady(state: GoalCreationState): boolean {
  const effective = getEffectiveExtraction(state);
  return effective.name.trim().length > 0 && effective.description.trim().length > 0;
}

/**
 * Create a new message with UUID and timestamp
 */
export function createMessage(role: "user" | "assistant", content: string): GoalCreationMessage {
  return {
    id: uuidv4(),
    role,
    content,
    timestamp: Date.now(),
  };
}
