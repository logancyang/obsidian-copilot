import { CopilotPlusExpiredModal, CopilotPlusExpiredModalContent } from "./CopilotPlusExpiredModal";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import type { App } from "obsidian";
import { navigateToPlusPage } from "@/plusUtils";
import { PLUS_UTM_MEDIUMS } from "@/constants";
import { openCopilotSettings } from "@/settings/openSettings";
import { createPluginRoot } from "@/utils/react/createPluginRoot";

jest.mock("@/plusUtils", () => ({
  isUsingLicensedModels: jest.fn(() => true),
  navigateToPlusPage: jest.fn(),
}));
jest.mock("@/settings/openSettings", () => ({ openCopilotSettings: jest.fn() }));
jest.mock("@/utils/react/createPluginRoot", () => ({
  createPluginRoot: jest.fn(() => ({ render: jest.fn(), unmount: jest.fn() })),
}));

const WARNING = /selected Copilot models are unavailable/;

describe("CopilotPlusExpiredModal", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("CopilotPlusExpiredModalContent()", () => {
    it("warns that the models will stop working when a default still points at one", () => {
      render(
        <CopilotPlusExpiredModalContent
          onCancel={jest.fn()}
          onOpenModelSettings={jest.fn()}
          isUsingPlusModels
        />
      );

      expect(screen.getByText(WARNING)).toBeTruthy();
    });

    it("omits the warning when no default depends on those models", () => {
      render(
        <CopilotPlusExpiredModalContent
          onCancel={jest.fn()}
          onOpenModelSettings={jest.fn()}
          isUsingPlusModels={false}
        />
      );

      expect(screen.queryByText(WARNING)).toBeNull();
      // The lapsed-license message itself is not conditional.
      expect(screen.getByText(/license key is no longer valid/)).toBeTruthy();
    });

    it("opens model settings independently of renewal or dismissal: https://github.com/Brevilabs/obsidian-copilot-private/issues/415", () => {
      const onCancel = jest.fn();
      const onOpenModelSettings = jest.fn();
      render(
        <CopilotPlusExpiredModalContent
          onCancel={onCancel}
          onOpenModelSettings={onOpenModelSettings}
          isUsingPlusModels={false}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: "Open model settings" }));
      expect(onOpenModelSettings).toHaveBeenCalledTimes(1);
      expect(onCancel).not.toHaveBeenCalled();
      expect(navigateToPlusPage).not.toHaveBeenCalled();
      expect(screen.getByText(/Set it up first if needed/)).toBeTruthy();
    });

    it("retains renewal without dismissing or opening settings", () => {
      const onCancel = jest.fn();
      const onOpenModelSettings = jest.fn();
      render(
        <CopilotPlusExpiredModalContent
          onCancel={onCancel}
          onOpenModelSettings={onOpenModelSettings}
          isUsingPlusModels
        />
      );
      fireEvent.click(screen.getByRole("button", { name: "Renew Now" }));
      expect(navigateToPlusPage).toHaveBeenCalledWith(PLUS_UTM_MEDIUMS.EXPIRED_MODAL);
      expect(onCancel).not.toHaveBeenCalled();
      expect(onOpenModelSettings).not.toHaveBeenCalled();
    });

    it("dismisses on Close", () => {
      const onCancel = jest.fn();
      render(
        <CopilotPlusExpiredModalContent
          onCancel={onCancel}
          onOpenModelSettings={jest.fn()}
          isUsingPlusModels
        />
      );

      fireEvent.click(screen.getByRole("button", { name: "Close" }));

      expect(onCancel).toHaveBeenCalledTimes(1);
    });
  });
  describe("CopilotPlusExpiredModal", () => {
    describe("onOpen()", () => {
      it("closes before opening Basic model settings in the initiating window: https://github.com/Brevilabs/obsidian-copilot-private/issues/415", () => {
        const events: string[] = [];
        const app = {} as App;
        const ownerWindow = {} as Window;
        const contentEl = document.createElement("div");
        Object.defineProperty(contentEl, "win", { value: ownerWindow });
        const modal = Object.assign(Object.create(CopilotPlusExpiredModal.prototype), {
          app,
          contentEl,
          close: jest.fn(() => events.push("close")),
        }) as CopilotPlusExpiredModal;
        (openCopilotSettings as jest.Mock).mockImplementation(() => events.push("settings"));
        modal.onOpen();
        const root = (createPluginRoot as jest.Mock).mock.results[0].value as {
          render: jest.Mock<
            void,
            [React.ReactElement<React.ComponentProps<typeof CopilotPlusExpiredModalContent>>]
          >;
        };
        const content = root.render.mock.calls[0][0];
        expect(openCopilotSettings).not.toHaveBeenCalled();
        content.props.onOpenModelSettings();
        expect(events).toEqual(["close", "settings"]);
        expect(openCopilotSettings).toHaveBeenCalledWith(app, ownerWindow, "basic");
        expect(navigateToPlusPage).not.toHaveBeenCalled();
      });
    });
  });
});
