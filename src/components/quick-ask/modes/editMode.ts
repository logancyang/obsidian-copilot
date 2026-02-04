/**
 * Edit mode configuration for Quick Ask.
 * Generate edits with preview - Future implementation.
 */

import type { QuickAskModeConfig } from "../types";

export const editModeConfig: QuickAskModeConfig = {
  id: "edit",
  label: "Edit",
  icon: "pencil",
  description: "Generate edits with preview",
  requiresSelection: true,
  implemented: false,
};
