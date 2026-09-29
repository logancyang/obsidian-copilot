import { buildBackendSummary } from "@/agentMode/protocol/testBuilders";
import {
  buildEffortOptionsByModelKey,
  reportSwitchFailure,
  toModelSelectorEntry,
} from "@/agentMode/ui/agentModelPickerHelpers";
import { logError } from "@/logger";
import { Notice } from "obsidian";

jest.mock("obsidian", () => ({ Notice: jest.fn() }));
jest.mock("@/logger", () => ({ logError: jest.fn() }));

describe("agentModelPickerHelpers", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("toModelSelectorEntry()", () => {
    it("draws a picker row as an enabled, non-built-in selector entry carrying its display fields", () => {
      expect(
        toModelSelectorEntry({
          name: "opus",
          provider: "agent",
          displayName: "Opus",
          group: "Claude Code",
          backendId: "claude",
          subtitle: "Deep",
          isFree: true,
          disabledReason: "Not set up",
          needsSelfHostWarning: true,
          needsLicense: true,
        })
      ).toEqual({
        name: "opus",
        provider: "agent",
        enabled: true,
        isBuiltIn: false,
        displayName: "Opus",
        capabilities: undefined,
        _group: "Claude Code",
        _backendId: "claude",
        _subtitle: "Deep",
        _isFree: true,
        _disabledReason: "Not set up",
        _needsSelfHostWarning: true,
        _needsLicense: true,
      });
    });
  });

  describe("buildEffortOptionsByModelKey()", () => {
    it("keys each agent row's levels by the selector's model key and skips rows that are not agent models", () => {
      const backends = [
        buildBackendSummary({
          id: "claude",
          efforts: { opus: [{ value: "high", label: "High" }] },
        }),
      ];
      const out = buildEffortOptionsByModelKey(backends, [
        { name: "opus", provider: "agent", displayName: "Opus", backendId: "claude" },
        { name: "haiku", provider: "agent", displayName: "Haiku", backendId: "claude" },
        { name: "flash", provider: "copilot-plus", displayName: "Flash", backendId: "claude" },
        { name: "orphan", provider: "agent", displayName: "Orphan" },
      ]);
      expect(out).toEqual({
        "claude:opus|agent": [{ value: "high", label: "High" }],
        "claude:haiku|agent": [],
      });
    });
  });

  describe("reportSwitchFailure()", () => {
    const fail = (code: "stale" | "unsupported" | "invalid") =>
      ({ ok: false, code, message: "why" }) as const;

    it("says nothing for a stale result, since the control is about to redraw", () => {
      reportSwitchFailure(fail("stale"), "model");
      expect(Notice).not.toHaveBeenCalled();
      expect(logError).not.toHaveBeenCalled();
    });

    it("tells the user an agent cannot switch while running", () => {
      reportSwitchFailure(fail("unsupported"), "effort");
      expect(Notice).toHaveBeenCalledWith("This agent doesn't support runtime effort switching.");
    });

    it("logs the host's reason and shows a generic notice for any other failure", () => {
      reportSwitchFailure(fail("invalid"), "mode");
      expect(logError).toHaveBeenCalledWith("[AgentMode] mode apply failed (invalid): why");
      expect(Notice).toHaveBeenCalledWith("Failed to switch mode. See console for details.");
    });
  });
});
