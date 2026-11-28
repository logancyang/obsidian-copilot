import type { BackendStartServices } from "@/agentMode/session/descriptor";
import type { BackendConfigRegistry, ProviderRegistry } from "@/modelManagement";

export function fakeBackendStartServices(
  overrides: Partial<BackendStartServices> = {}
): BackendStartServices {
  return {
    clientVersion: "1.0.0",
    modelManagement: {
      providerRegistry: {} as ProviderRegistry,
      backendConfigRegistry: {} as BackendConfigRegistry,
    },
    getSelfHostWebSearchChannel: async () => ({ url: "http://127.0.0.1:1/search", token: "t" }),
    findCallingChat: () => null,
    ...overrides,
  };
}
