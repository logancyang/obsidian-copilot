/**
 * Ask mode configuration for Quick Ask.
 * Multi-turn conversation mode - the default and primary mode.
 */

import type { QuickAskModeConfig } from "../types";

export const askModeConfig: QuickAskModeConfig = {
  id: "ask",
  label: "Ask",
  icon: "message-circle",
  description: "Multi-turn conversation",
  requiresSelection: false,
  // systemPrompt is undefined - modeRegistry.getSystemPrompt() will use default
  implemented: true,
};
