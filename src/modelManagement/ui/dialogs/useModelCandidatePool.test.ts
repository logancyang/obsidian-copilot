import { act, renderHook } from "@testing-library/react";
import type { ModelManagementApi } from "@/modelManagement/createModelManagement";
import { listProviderModels } from "@/modelManagement/providers/adapters/listProviderModels";
import { useModelCandidatePool, type UseModelCandidatePoolArgs } from "./useModelCandidatePool";

jest.mock("@/modelManagement/providers/adapters/listProviderModels", () => ({
  listProviderModels: jest.fn(),
}));

const mockListProviderModels = jest.mocked(listProviderModels);

describe("useModelCandidatePool", () => {
  describe("useModelCandidatePool()", () => {
    it("reuses a frozen empty pool across distinct embedding-only fetches and catalog updates (https://github.com/Brevilabs/obsidian-copilot-private/issues/386)", async () => {
      const args: UseModelCandidatePoolArgs = {
        mode: "new",
        providerId: undefined,
        providerType: "openai-compatible",
        effectiveBaseUrl: "https://provider.example/v1",
        existingModels: [],
        catalogMetadata: {},
        apiKey: "",
        extras: {},
        requiresApiKey: true,
        providerHydrated: true,
        api: {} as ModelManagementApi,
      };
      const { result, rerender } = renderHook(
        ({ catalogMetadata }) => useModelCandidatePool({ ...args, catalogMetadata }),
        { initialProps: { catalogMetadata: args.catalogMetadata } }
      );
      const empty = result.current.availableModels;
      expect(empty).toHaveLength(0);
      expect(Object.isFrozen(empty)).toBe(true);

      mockListProviderModels.mockResolvedValueOnce({
        ok: true,
        modelIds: ["text-embedding-3-small"],
      });
      await act(() => result.current.fetchModels());
      expect(result.current.availableModels).toBe(empty);

      rerender({
        catalogMetadata: {
          "text-embedding-3-small": {
            id: "text-embedding-3-small",
            displayName: "Updated catalog label",
            isEmbedding: true,
          },
        },
      });
      expect(result.current.availableModels).toBe(empty);

      mockListProviderModels.mockResolvedValueOnce({ ok: true, modelIds: ["nomic-embed-text"] });
      await act(() => result.current.fetchModels());
      expect(result.current.availableModels).toBe(empty);
      expect(mockListProviderModels).toHaveBeenCalledTimes(2);
    });
  });
});
