import { IntelligentUi, IntelligentUiProps } from "@/intelligentUi/ui/IntelligentUi";
import { UI_STORIES } from "@/intelligentUi/ui/IntelligentUi.fixtures";
import type { Meta, StoryObj } from "@/lib/story";

type StoryProps = IntelligentUiProps;
const meta = {
  title: "Intelligent UI/Primitives",
  component: IntelligentUi,
  args: { ...UI_STORIES.Stack, sourcePath: "Research.md" },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<StoryProps>;
export default meta;

export const Stack: StoryObj<StoryProps> = { args: UI_STORIES.Stack };
export const Row: StoryObj<StoryProps> = { args: UI_STORIES.Row };
export const Grid: StoryObj<StoryProps> = { args: UI_STORIES.Grid };
export const Card: StoryObj<StoryProps> = { args: UI_STORIES.Card };
export const Panel: StoryObj<StoryProps> = { args: UI_STORIES.Panel };
export const Divider: StoryObj<StoryProps> = { args: UI_STORIES.Divider };
export const Heading: StoryObj<StoryProps> = { args: UI_STORIES.Heading };
export const Text: StoryObj<StoryProps> = { args: UI_STORIES.Text };
export const Badge: StoryObj<StoryProps> = { args: UI_STORIES.Badge };
export const Icon: StoryObj<StoryProps> = { args: UI_STORIES.Icon };
export const Steps: StoryObj<StoryProps> = { args: UI_STORIES.Steps };
export const Step: StoryObj<StoryProps> = { args: UI_STORIES.Step };
export const Metric: StoryObj<StoryProps> = { args: UI_STORIES.Metric };
export const Markdown: StoryObj<StoryProps> = { args: UI_STORIES.Markdown };
export const Comparison: StoryObj<StoryProps> = { args: UI_STORIES.Comparison };
export const GoldenSteps: StoryObj<StoryProps> = { args: UI_STORIES.GoldenSteps };
export const Metrics: StoryObj<StoryProps> = { args: UI_STORIES.Metrics };
export const GroupedConcepts: StoryObj<StoryProps> = { args: UI_STORIES.GroupedConcepts };
export const Architecture: StoryObj<StoryProps> = { args: UI_STORIES.Architecture };
export const Fallback: StoryObj<StoryProps> = { args: UI_STORIES.Fallback };
