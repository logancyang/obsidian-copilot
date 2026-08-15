import { UsageMeter, type UsageMeterProps } from "@/agentMode/ui/AgentContextMeter";
import type { Meta, StoryObj } from "@/lib/story";

/**
 * The meter has two independent inputs — context occupancy and account plan caps — and a
 * backend can report either, both, or neither. These stories pin the combinations that
 * look materially different, because the tooltip's contents change shape between them and
 * only the rendered result shows whether the layout still reads.
 */
const meta = {
  title: "Agent Mode/UsageMeter",
  component: UsageMeter,
} satisfies Meta<UsageMeterProps>;
export default meta;

const HOUR = 60 * 60 * 1000;

/**
 * The rendering instant, because the component compares every `resetsAt` against the
 * real clock. A fixed historical instant would decay: once it passed, every countdown
 * would render as already-reset and the stories could no longer audit the reset text.
 * The offsets are whole hours, so the coarse `resets in 3h` output is stable anyway.
 */
const NOW = Date.now();

const CONTEXT: UsageMeterProps["usage"] = {
  usedTokens: 48_000,
  contextWindow: 200_000,
  updatedAt: NOW,
};

/** Both windows, mid-usage: the everyday Claude Code and Copilot Plus state. */
export const ContextAndCaps: StoryObj<UsageMeterProps> = {
  args: {
    usage: CONTEXT,
    contextWindow: 200_000,
    planUsage: {
      windows: [
        { id: "five_hour", label: "5h", percent: 12, resetsAt: NOW + 3 * HOUR },
        { id: "seven_day", label: "Weekly", percent: 21, resetsAt: NOW + 52 * HOUR },
      ],
      updatedAt: NOW,
    },
  },
};

/** Context only — a key-authenticated login, which is not metered by plan caps. */
export const ContextOnly: StoryObj<UsageMeterProps> = {
  args: { usage: CONTEXT, contextWindow: 200_000, planUsage: null },
};

/**
 * Caps with no context window. Codex on a Pro plan reports a single weekly cap, and some
 * models never advertise a window, so the context row degrades to a bare count while the
 * cap rows still render.
 */
export const CapsWithoutContextWindow: StoryObj<UsageMeterProps> = {
  args: {
    usage: { usedTokens: 12_400, updatedAt: NOW },
    contextWindow: null,
    planUsage: {
      windows: [{ id: "primary", label: "Weekly", percent: 15, resetsAt: NOW + 80 * HOUR }],
      updatedAt: NOW,
    },
  },
};

/** Past the warning threshold, where the ring changes colour. */
export const ContextNearlyFull: StoryObj<UsageMeterProps> = {
  args: {
    usage: { usedTokens: 186_000, contextWindow: 200_000, updatedAt: NOW },
    contextWindow: 200_000,
    planUsage: {
      windows: [{ id: "seven_day", label: "Weekly", percent: 91, resetsAt: NOW + 4 * HOUR }],
      updatedAt: NOW,
    },
  },
};

/**
 * Over the cap. An account served past its limit on purchased credit reports above 100%,
 * and the number is deliberately not clamped — "just hit it" and "far past it" must not
 * look the same.
 */
export const OverCap: StoryObj<UsageMeterProps> = {
  args: {
    usage: CONTEXT,
    contextWindow: 200_000,
    planUsage: {
      windows: [{ id: "seven_day", label: "Weekly", percent: 143, resetsAt: NOW + 9 * HOUR }],
      updatedAt: NOW,
    },
  },
};

/** A window whose source gave no reset time: the row keeps its percentage, drops the countdown. */
export const CapWithoutReset: StoryObj<UsageMeterProps> = {
  args: {
    usage: CONTEXT,
    contextWindow: 200_000,
    planUsage: {
      windows: [{ id: "seven_day", label: "Weekly", percent: 21 }],
      updatedAt: NOW,
    },
  },
};

/** Per-model caps, which arrive alongside the account-wide ones and name their model. */
export const ModelScopedCaps: StoryObj<UsageMeterProps> = {
  args: {
    usage: CONTEXT,
    contextWindow: 200_000,
    planUsage: {
      windows: [
        { id: "seven_day", label: "Weekly", percent: 21, resetsAt: NOW + 52 * HOUR },
        {
          id: "model_scoped:Fable",
          label: "Weekly (Fable)",
          percent: 64,
          resetsAt: NOW + 52 * HOUR,
        },
      ],
      updatedAt: NOW,
    },
  },
};
