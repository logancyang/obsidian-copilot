import type { Meta, StoryObj } from "@/lib/story";
import { CommandModelSelect, type CommandModelSelectProps } from "./CommandModelSelect";
const meta = {
  title: "Commands/Model selection",
  component: CommandModelSelect,
  args: { options: [{ label: "GPT-4o (OpenRouter)", value: "gpt4o" }], onChange: () => undefined },
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<CommandModelSelectProps>;
export default meta;
export const DefaultModel: StoryObj<CommandModelSelectProps> = { args: { value: "" } };
export const ExplicitModel: StoryObj<CommandModelSelectProps> = { args: { value: "gpt4o" } };
export const UnavailableModel: StoryObj<CommandModelSelectProps> = { args: { value: "removed" } };
