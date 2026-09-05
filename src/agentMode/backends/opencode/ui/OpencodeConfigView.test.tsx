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
  version: "0.15.6",
  destination: "~/.obsidian-copilot/opencode",
  run: { kind: "idle" },
};

const OUTDATED: InstallState = {
  kind: "incompatible",
  source: "managed",
  currentVersion: "0.14.2",
  minVersion: "0.15.6",
  message: "opencode v0.14.2 is not supported. Copilot requires opencode v0.15.6 or newer.",
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
    it("offers the two binary sources as one mutually exclusive choice", () => {
      renderView();

      const group = screen.getByRole("radiogroup", { name: "opencode binary source" });
      const options = screen.getAllByRole("radio");
      expect(group.contains(options[0])).toBe(true);
      expect(options.map((o) => o.textContent)).toEqual(["Managed by Copilot", "My own binary"]);
      expect(options.map((o) => o.getAttribute("aria-checked"))).toEqual(["true", "false"]);
    });

    it("labels the upgrade as the custom binary's own command when that is the active source", () => {
      renderView({ state: { ...OUTDATED, source: "custom" }, activeSource: "custom" });

      expect(screen.getByRole("button", { name: "Run opencode upgrade" })).toBeTruthy();
    });
  });
});
