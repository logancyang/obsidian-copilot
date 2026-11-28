import type { EffortOption } from "@copilot/core/modelEffort";

export type CopilotMode = "default" | "plan" | "auto";

export interface ModeOption {
  value: CopilotMode;
  label: string;
}

export interface ModelEntry {
  baseModelId: string;
  name: string;
  description?: string;
  provider: string | null;
  effortOptions: EffortOption[];
}

export interface ModelSelection {
  baseModelId: string;
  effort: string | null;
}

export interface ModelState {
  current: ModelSelection;
  availableModels: ModelEntry[];
  apply: ModelApplySpec;
}

type ModeApplyStep =
  | { kind: "setMode"; nativeId: string }
  | { kind: "setConfigOption"; configId: string; value: string };

export type ModeApplySpec =
  | ModeApplyStep
  | { kind: "sequence"; steps: [ModeApplyStep, ...ModeApplyStep[]] };

export type ModelApplySpec =
  | { kind: "setModel" }
  | { kind: "setConfigOption"; configId: string; effortConfigId?: string };

export interface BackendState {
  model: ModelState | null;

  mode: {
    current: CopilotMode | null;
    options: ModeOption[];
    apply: Partial<Record<CopilotMode, ModeApplySpec>>;
  } | null;
}
