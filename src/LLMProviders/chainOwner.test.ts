import type { ModelManagementApi } from "@/modelManagement";
import type { App } from "obsidian";

const mockCreateChainWithNewModel = jest.fn();
jest.mock("./chainManager", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    createChainWithNewModel: mockCreateChainWithNewModel,
  })),
}));

const mockSubscribeToModelKeyChange = jest.fn<() => void, [() => void]>();
const mockSubscribeToChainTypeChange = jest.fn<() => void, [() => void]>();
jest.mock("@/aiParams", () => ({
  subscribeToModelKeyChange: (cb: () => void): void => {
    mockSubscribeToModelKeyChange(cb);
  },
  subscribeToChainTypeChange: (cb: () => void): void => {
    mockSubscribeToChainTypeChange(cb);
  },
}));

import ChainOwner from "./chainOwner";
import ChainManager from "./chainManager";

const APP = {} as App;
const MODEL_MANAGEMENT = {} as ModelManagementApi;

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
      it("rebuilds the chain without asking for a removed client-side index refresh", () => {
        const { onChainTypeChange } = createOwner();

        onChainTypeChange();

        expect(mockCreateChainWithNewModel).toHaveBeenCalledWith();
      });
    });
  });
});
