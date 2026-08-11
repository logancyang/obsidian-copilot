import type { Meta, StoryObj } from "@/lib/story";
import {
  ProviderDisplayNameField,
  type ProviderDisplayNameFieldProps,
} from "./ProviderDisplayNameField";

const meta = {
  title: "Model Management/Provider Display Name Field",
  component: ProviderDisplayNameField,
  args: { onChange: () => {} },
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<ProviderDisplayNameFieldProps>;
export default meta;

export const Valid: StoryObj<ProviderDisplayNameFieldProps> = {
  args: { value: "OpenRouter 2" },
};

export const DuplicateName: StoryObj<ProviderDisplayNameFieldProps> = {
  args: {
    value: "OpenRouter",
    errorMessage: "A provider with this name already exists. Choose a different name.",
  },
};
