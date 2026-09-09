import type { Meta, StoryObj } from "@/lib/story";
import {
  ProviderVerificationProgress,
  ProviderVerificationStatus,
  type ProviderVerificationStatusProps,
} from "./ProviderVerificationStatus";
import React from "react";
import { Button } from "@/components/ui/button";

const meta = {
  title: "Settings/Provider Verification",
  component: ProviderVerificationStatus,
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<ProviderVerificationStatusProps>;
export default meta;

export const Checking: StoryObj<ProviderVerificationStatusProps> = {};
export const Verified: StoryObj<ProviderVerificationStatusProps> = {
  args: { result: { ok: true, checkedAt: 0 } },
};
export const MissingKey: StoryObj<ProviderVerificationStatusProps> = {
  args: {
    result: {
      ok: false,
      code: "missing_api_key",
      message: "API key is missing. Configure this provider to enter it again.",
      checkedAt: 0,
    },
  },
};
export const InvalidKey: StoryObj<ProviderVerificationStatusProps> = {
  args: {
    result: {
      ok: false,
      code: "invalid_api_key",
      message: "The provider rejected this API key.",
      checkedAt: 0,
    },
  },
};
export const Offline: StoryObj<ProviderVerificationStatusProps> = {
  args: {
    result: { ok: false, code: "network", message: "Could not reach this provider.", checkedAt: 0 },
  },
};
export const Progress: StoryObj<ProviderVerificationStatusProps> = {
  render: () => (
    <div className="tw-relative tw-flex tw-flex-col tw-gap-4 tw-py-4">
      <ProviderVerificationProgress pending={2} />
      <div className="tw-flex tw-items-start tw-justify-between tw-gap-4">
        <div className="tw-text-xl tw-font-bold">Bring Your Own Key</div>
        <Button className="tw-shrink-0">Add a provider</Button>
      </div>
      <div className="tw-text-sm tw-text-muted">
        Set up your own providers and models to use in Copilot.
      </div>
      <div className="tw-flex tw-items-center tw-justify-between tw-rounded-lg tw-border tw-border-solid tw-p-4">
        OpenAI <ProviderVerificationStatus />
      </div>
    </div>
  ),
};
