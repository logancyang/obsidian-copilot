import { ChainType } from "@/chainType";
import { VAULT_VECTOR_STORE_STRATEGY } from "@/constants";
import type { ModelManagementApi } from "@/modelManagement";
import type { App } from "obsidian";

const mockCreateChainWithNewModel = jest.fn();
jest.mock("./chainManager", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    createChainWithNewModel: mockCreateChainWithNewModel,
  })),
}));

const mockGetChainType = jest.fn<ChainType, []>();
const mockSubscribeToModelKeyChange = jest.fn<() => void, [() => void]>();
const mockSubscribeToChainTypeChange = jest.fn<() => void, [() => void]>();
jest.mock("@/aiParams", () => ({
  getChainType: (): ChainType => mockGetChainType(),
  subscribeToModelKeyChange: (cb: () => void): void => {
    mockSubscribeToModelKeyChange(cb);
  },
  subscribeToChainTypeChange: (cb: () => void): void => {
    mockSubscribeToChainTypeChange(cb);
  },
}));

const mockGetSettings = jest.fn<Record<string, unknown>, []>();
jest.mock("@/settings/model", () => ({
  getSettings: (): Record<string, unknown> => mockGetSettings(),
}));

import ChainOwner from "./chainOwner";
import ChainManager from "./chainManager";

const APP = {} as App;
const MODEL_MANAGEMENT = {} as ModelManagementApi;

/** Settings slice the chain-type subscriber reads, with auto-index fully enabled. */
function autoIndexSettings(overrides: Record<string, unknown> = {}) {
  return {
    enableSemanticSearchV3: true,
    indexVaultToVectorStore: VAULT_VECTOR_STORE_STRATEGY.ON_MODE_SWITCH,
    ...overrides,
  };
}

/** Build a fresh owner and hand back the callbacks it registered. */
function createOwner(): {
  owner: ChainOwner;
  onModelKeyChange: () => void;
  onChainTypeChange: () => void;
} {
  const owner = ChainOwner.getInstance(APP, MODEL_MANAGEMENT);
  return {
    owner,
    onModelKeyChange: mockSubscribeToModelKeyChange.mock.calls[0][0],
    onChainTypeChange: mockSubscribeToChainTypeChange.mock.calls[0][0],
  };
}

describe("chainOwner", () => {
  describe("ChainOwner", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      // Reason: the singleton outlives a test, so a stale instance would hand the
      // next case the previous one's subscriptions and chain manager.
      ChainOwner.instance = undefined as unknown as ChainOwner;
      mockGetSettings.mockReturnValue(autoIndexSettings());
      mockGetChainType.mockReturnValue(ChainType.COPILOT_PLUS_CHAIN);
    });

    describe("getInstance()", () => {
      it("builds the chain manager once and hands back the same owner on later calls", () => {
        const first = ChainOwner.getInstance(APP, MODEL_MANAGEMENT);
        const second = ChainOwner.getInstance(APP, MODEL_MANAGEMENT);

        expect(second).toBe(first);
        expect(ChainManager).toHaveBeenCalledTimes(1);
        expect(ChainManager).toHaveBeenCalledWith(APP, MODEL_MANAGEMENT);
      });

      it("subscribes to model-key and chain-type changes exactly once", () => {
        createOwner();

        expect(mockSubscribeToModelKeyChange).toHaveBeenCalledTimes(1);
        expect(mockSubscribeToChainTypeChange).toHaveBeenCalledTimes(1);
      });
    });

    describe("getCurrentChainManager()", () => {
      it("returns the same chain manager every call, so chat memory survives a mode switch", () => {
        const { owner } = createOwner();

        expect(owner.getCurrentChainManager()).toBe(owner.getCurrentChainManager());
      });
    });

    describe("model-key subscriber", () => {
      it("rebuilds the chain without asking for a vault re-index", () => {
        const { onModelKeyChange } = createOwner();

        onModelKeyChange();

        expect(mockCreateChainWithNewModel).toHaveBeenCalledTimes(1);
        expect(mockCreateChainWithNewModel).toHaveBeenCalledWith();
      });
    });

    describe("chain-type subscriber", () => {
      it.each([
        ["vault QA", ChainType.VAULT_QA_CHAIN],
        ["Copilot Plus", ChainType.COPILOT_PLUS_CHAIN],
      ])("re-indexes when switching to %s under an on-mode-switch strategy", (_label, chain) => {
        mockGetChainType.mockReturnValue(chain);
        const { onChainTypeChange } = createOwner();

        onChainTypeChange();

        expect(mockCreateChainWithNewModel).toHaveBeenCalledWith({ refreshIndex: true });
      });

      it("skips the re-index for a chain that never reads the vector store", () => {
        mockGetChainType.mockReturnValue(ChainType.LLM_CHAIN);
        const { onChainTypeChange } = createOwner();

        onChainTypeChange();

        expect(mockCreateChainWithNewModel).toHaveBeenCalledWith({ refreshIndex: false });
      });

      it("skips the re-index when semantic search is off", () => {
        mockGetSettings.mockReturnValue(autoIndexSettings({ enableSemanticSearchV3: false }));
        const { onChainTypeChange } = createOwner();

        onChainTypeChange();

        expect(mockCreateChainWithNewModel).toHaveBeenCalledWith({ refreshIndex: false });
      });

      it("skips the re-index when the vault is not set to index on mode switch", () => {
        mockGetSettings.mockReturnValue(
          autoIndexSettings({ indexVaultToVectorStore: VAULT_VECTOR_STORE_STRATEGY.NEVER })
        );
        const { onChainTypeChange } = createOwner();

        onChainTypeChange();

        expect(mockCreateChainWithNewModel).toHaveBeenCalledWith({ refreshIndex: false });
      });
    });
  });
});
