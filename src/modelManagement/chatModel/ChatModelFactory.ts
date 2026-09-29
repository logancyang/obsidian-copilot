import type { ConfiguredModel, Provider } from "@/modelManagement/types/persisted";
import type { BuiltChatModel } from "@/modelManagement/types/runtime";
import type { ConfiguredModelRegistry } from "@/modelManagement/models/ConfiguredModelRegistry";
import type { ProviderAdapterRegistry } from "@/modelManagement/providers/adapters/ProviderAdapterRegistry";
import type { ProviderRegistry } from "@/modelManagement/providers/ProviderRegistry";

export class ChatModelFactory {
  constructor(
    providerRegistry: ProviderRegistry,
    configuredModelRegistry: ConfiguredModelRegistry,
    adapters: ProviderAdapterRegistry
  ) {}

  build(configuredModelId: string): Promise<BuiltChatModel> {
    throw new Error("[modelManagement] ChatModelFactory.build not implemented yet");
  }

  buildFor(provider: Provider, configuredModel: ConfiguredModel): Promise<BuiltChatModel> {
    throw new Error("[modelManagement] ChatModelFactory.buildFor not implemented yet");
  }
}
