import type { Meta, StoryObj } from "@/lib/story";
import {
  SelfHostWebSearchSettings,
  type SelfHostWebSearchSettingsProps,
} from "./SelfHostWebSearchSettings";

const apiKeys = {
  firecrawl: "fc-example",
  perplexity: "pplx-example",
  parallel: "parallel-example",
  exa: "exa-example",
};

const meta = {
  title: "Settings/Self-Host Web Search",
  component: SelfHostWebSearchSettings,
  args: {
    apiKeys,
    disabled: false,
    onApiKeyChange: () => {},
    onProviderChange: () => {},
  },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<SelfHostWebSearchSettingsProps>;
export default meta;

export const Parallel: StoryObj<SelfHostWebSearchSettingsProps> = {
  args: { provider: "parallel" },
};

export const Exa: StoryObj<SelfHostWebSearchSettingsProps> = {
  args: { provider: "exa" },
};
