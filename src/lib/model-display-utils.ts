import type { CustomModel } from "@/aiParams";
import { ProviderInfo } from "@/constants";
import type { Provider } from "@/constants";

export { err2String } from "@/errorFormat";

export function getProviderLabel(provider: string, model?: CustomModel): string {
  const baseLabel = ProviderInfo[provider as Provider]?.label || provider;
  return baseLabel + (model?.believerExclusive && baseLabel === "Copilot" ? "(Believer)" : "");
}
