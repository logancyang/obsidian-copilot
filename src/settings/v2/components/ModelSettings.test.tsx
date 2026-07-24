import { CustomModel } from "@/aiParams";
import { EmbeddingModelProviders } from "@/constants";
import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const mockUpdateSetting = jest.fn();
const mockSetSettings = jest.fn();
const mockIndexVaultToVectorStore = jest.fn();
const mockEditModalOpen = jest.fn();
const mockRebuildModalOpen = jest.fn();
let mockModelUpdate:
  | ((isEmbeddingModel: boolean, originalModel: CustomModel, updatedModel: CustomModel) => void)
  | undefined;
let mockConfirmRebuild: (() => void | Promise<void>) | undefined;

const selectedEmbeddingModel: CustomModel = {
  name: "custom-embedding",
  provider: EmbeddingModelProviders.OPENAI_FORMAT,
  enabled: true,
  isEmbeddingModel: true,
  dimensions: 512,
};

const mockSettings = {
  activeModels: [] as CustomModel[],
  activeEmbeddingModels: [selectedEmbeddingModel],
  embeddingModelKey: `${selectedEmbeddingModel.name}|${selectedEmbeddingModel.provider}`,
  enableSemanticSearchV3: true,
  contextTurns: 15,
  autoCompactThreshold: 128000,
};

jest.mock("@/components/ui/setting-item", () => ({ SettingItem: () => null }));
jest.mock("@/context", () => ({
  // This mock must retain the production hook name even though it does not need React state.
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix
  useApp: () => ({}),
}));
jest.mock("@/LLMProviders/embeddingManager", () => ({
  __esModule: true,
  default: { getInstance: jest.fn(() => ({ ping: jest.fn() })) },
}));
jest.mock("@/LLMProviders/projectManager", () => ({
  __esModule: true,
  default: { instance: { getCurrentChainManager: jest.fn() } },
}));
jest.mock("@/settings/model", () => ({
  getModelKeyFromModel: (model: CustomModel) => `${model.name}|${model.provider}`,
  setSettings: mockSetSettings,
  updateSetting: mockUpdateSetting,
  // This mock must retain the production hook name even though it returns fixed test data.
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix
  useSettingsValue: () => mockSettings,
}));
jest.mock("@/settings/v2/components/ModelAddDialog", () => ({
  ModelAddDialog: () => null,
}));
jest.mock("@/settings/v2/components/ModelEditDialog", () => ({
  ModelEditModal: class {
    constructor(
      _app: unknown,
      _model: CustomModel,
      _isEmbeddingModel: boolean,
      onUpdate: typeof mockModelUpdate
    ) {
      mockModelUpdate = onUpdate;
    }

    open(): void {
      mockEditModalOpen();
    }
  },
}));
jest.mock("@/settings/v2/components/ModelTable", () => ({
  ModelTable: ({
    models,
    onEdit,
    title,
  }: {
    models: CustomModel[];
    onEdit?: (model: CustomModel) => void;
    title: string;
  }) =>
    models[0] ? (
      <button type="button" onClick={() => onEdit?.(models[0])}>
        Edit {title}
      </button>
    ) : null,
}));
jest.mock("@/components/modals/RebuildIndexConfirmModal", () => ({
  RebuildIndexConfirmModal: class {
    constructor(_app: unknown, onConfirm: typeof mockConfirmRebuild) {
      mockConfirmRebuild = onConfirm;
    }

    open(): void {
      mockRebuildModalOpen();
    }
  },
}));
jest.mock("@/search/vectorStoreManager", () => ({
  __esModule: true,
  default: {
    getInstance: jest.fn(() => ({
      indexVaultToVectorStore: mockIndexVaultToVectorStore,
    })),
  },
}));
jest.mock("obsidian", () => ({ Notice: jest.fn() }));

import { ModelSettings } from "./ModelSettings";

describe("ModelSettings embedding dimension updates", () => {
  beforeEach(() => {
    mockModelUpdate = undefined;
    mockConfirmRebuild = undefined;
    jest.clearAllMocks();
  });

  it("confirms before saving and rebuilding changed dimensions for the selected model", async () => {
    render(<ModelSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Embedding Models" }));

    const updatedModel = { ...selectedEmbeddingModel, dimensions: 1024 };
    act(() => {
      mockModelUpdate?.(true, selectedEmbeddingModel, updatedModel);
    });

    expect(mockRebuildModalOpen).toHaveBeenCalledTimes(1);
    expect(mockUpdateSetting).not.toHaveBeenCalled();
    expect(mockIndexVaultToVectorStore).not.toHaveBeenCalled();

    await act(async () => {
      await mockConfirmRebuild?.();
    });

    expect(mockUpdateSetting).toHaveBeenCalledWith("activeEmbeddingModels", [updatedModel]);
    expect(mockIndexVaultToVectorStore).toHaveBeenCalledWith(false, {
      userInitiated: true,
    });

    act(() => {
      mockModelUpdate?.(true, selectedEmbeddingModel, updatedModel);
    });

    expect(mockRebuildModalOpen).toHaveBeenCalledTimes(1);
    expect(mockUpdateSetting).toHaveBeenCalledTimes(2);
    expect(mockIndexVaultToVectorStore).toHaveBeenCalledTimes(1);
  });
});
