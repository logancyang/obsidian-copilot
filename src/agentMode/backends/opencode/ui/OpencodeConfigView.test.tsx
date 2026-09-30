import type { InstallState } from "@/agentMode/session/types";
import { render, screen } from "@testing-library/react";
import React from "react";
import {
  OpencodeConfigView,
  type OpencodeConfigActions,
  type OpencodeConfigViewProps,
  type OpencodeManagedInfo,
} from "./OpencodeConfigView";

const MANAGED: OpencodeManagedInfo = {
  platform: "darwin-arm64",
  version: "2.0.3",
  destination: "~/.obsidian-copilot/opencode",
  run: { kind: "idle" },
};

const OUTDATED: InstallState = {
  kind: "incompatible",
  source: "managed",
  currentVersion: "1.18.31",
  minVersion: "2.0.3",
  message: "opencode v1.18.31 is not supported. Copilot requires opencode v2.0.3 or newer.",
};

const makeActions = (): jest.Mocked<OpencodeConfigActions> => ({
  install: jest.fn(),
  cancelInstall: jest.fn(),
  uninstall: jest.fn(),
  upgrade: jest.fn(),
  saveCustomPath: jest.fn().mockResolvedValue(null),
  clearCustomPath: jest.fn().mockResolvedValue(undefined),
  detectCustomPath: jest.fn().mockResolvedValue(null),
});

const renderView = (
  overrides: Partial<OpencodeConfigViewProps> = {}
): { actions: jest.Mocked<OpencodeConfigActions>; onSourceChange: jest.Mock } => {
  const actions = overrides.actions ?? makeActions();
  const onSourceChange = jest.fn();
  render(
    <OpencodeConfigView
      state={{ kind: "absent" }}
      source="managed"
      onSourceChange={onSourceChange}
      activeSource={null}
      managed={MANAGED}
      customPath=""
      upgradeRun={{ kind: "idle" }}
      actions={actions}
      onClose={jest.fn()}
      {...overrides}
    />
  );
  return { actions: actions as jest.Mocked<OpencodeConfigActions>, onSourceChange };
};

describe("OpencodeConfigView", () => {
  describe("OpencodeConfigView()", () => {
    it("labels the upgrade button with the opencode upgrade command when the custom binary is the active source", () => {
      renderView({ state: { ...OUTDATED, source: "custom" }, activeSource: "custom" });

      expect(screen.getByRole("button", { name: "Run opencode upgrade" })).toBeTruthy();
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/569 labels the upgrade button with the managed version it will install when the managed binary is outdated", () => {
      renderView({
        state: OUTDATED,
        activeSource: "managed",
      });

      expect(screen.getByRole("button", { name: "Upgrade to v2.0.3" })).toBeTruthy();
    });
  });
});
