import type { Provider } from "@/modelManagement/types/persisted";

import { isSelfHostedProvider } from "./isSelfHostedProvider";

export interface SelfHostPolicyInput {
  enableSelfHostMode: boolean;
}

export function providerNeedsSelfHostWarning(
  provider: Provider,
  settings: SelfHostPolicyInput
): boolean {
  if (!settings.enableSelfHostMode) return false;
  switch (provider.origin.kind) {
    case "copilot-plus":
      return true;
    case "byok":
      return !isSelfHostedProvider(provider);
    case "agent":
      return false;
  }
}
