import { ConfiguredModelEnableList } from "./ConfiguredModelEnableList";
import type { BackendDescriptor } from "@/agentMode";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const setSelectedTab = jest.fn();
jest.mock("@/contexts/TabContext", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the public hook
  useTab: () => ({ setSelectedTab }),
}));
jest.mock("@/agentMode", () => ({
  ModelEnableList: jest.requireActual<typeof import("@/components/ui/ModelEnableList")>(
    "@/components/ui/ModelEnableList"
  ).ModelEnableList,
  mapProviderToOpencodeId: () => null,
}));
jest.mock("@/settings/model", () => ({ settingsStore: {} }));
jest.mock("@/logger", () => ({ logError: jest.fn() }));
jest.mock("@/lib/lockedCopilotEntries", () => ({ shouldPreviewCopilotModels: () => false }));
jest.mock("@/modelManagement", () => ({
  configuredModelsAtom: "models",
  providersAtom: "providers",
  backendsAtom: "backends",
  COPILOT_PLUS_MODELS: [],
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the public hook
  useModelManagement: () => ({ backendConfigRegistry: {} }),
}));
const emptyRegistry = { models: [], providers: {}, backends: {} };
jest.mock("jotai", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the public hook
  useAtomValue: (atom: keyof typeof emptyRegistry) => emptyRegistry[atom],
}));

describe("ConfiguredModelEnableList", () => {
  describe("ConfiguredModelEnableList()", () => {
    it.each([
      ["opencode", "OpenCode"],
      ["codex", "Codex"],
    ])(
      "offers the existing configuration route for empty %s models and reserves provider settings for OpenCode (https://github.com/Brevilabs/obsidian-copilot-private/issues/418)",
      (id, displayName) => {
        const onConfigure = jest.fn();
        render(
          <ConfiguredModelEnableList
            descriptor={{ id, displayName } as BackendDescriptor}
            loading={false}
            onConfigure={onConfigure}
          />
        );
        if (id === "opencode") {
          fireEvent.click(screen.getByRole("button", { name: "Open provider settings" }));
          expect(setSelectedTab).toHaveBeenCalledWith("byok");
        } else {
          fireEvent.click(screen.getByRole("button", { name: `Configure ${displayName}` }));
          expect(onConfigure).toHaveBeenCalledTimes(1);
          expect(screen.queryByRole("button", { name: "Open provider settings" })).toBeNull();
        }
      }
    );
  });
});
