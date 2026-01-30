/**
 * Edit-Direct mode configuration for Quick Ask.
 * Direct apply edits without preview - Future implementation.
 */

import type { QuickAskModeConfig } from "../types";

export const editDirectModeConfig: QuickAskModeConfig = {
  id: "edit-direct",
  label: "Edit Direct",
  icon: "zap",
  description: "Apply edits directly",
  requiresSelection: true,
  implemented: false,
};
