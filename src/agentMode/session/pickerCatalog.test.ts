import { buildBackendSummary, readinessOf, toPickerModel } from "@/agentMode/session/pickerCatalog";
import type { EnabledModelEntry, InstallState, ModelEntry } from "@/agentMode/session/types";
import { ModelCapability } from "@/constants";
import type { CopilotSettings } from "@/settings/model";

const mockLocked = jest.fn();
const mockShouldPreview = jest.fn();
jest.mock("@/lib/lockedCopilotEntries", () => ({
  lockedCopilotEntries: (...args: unknown[]) => mockLocked(...args),
  shouldPreviewCopilotModels: (...args: unknown[]) => mockShouldPreview(...args),
}));

const SETTINGS = { providers: {}, copilotPlusCatalog: {} } as unknown as CopilotSettings;

type SummaryInputs = Parameters<typeof buildBackendSummary>[0];

function inputs(
  overrides: Partial<Omit<SummaryInputs, "descriptor">> & {
    enabled?: EnabledModelEntry[] | null;
    routesCopilotModels?: boolean;
  } = {}
): SummaryInputs {
  const { enabled = [], routesCopilotModels = false, ...rest } = overrides;
  return {
    descriptor: {
      id: "claude",
      displayName: "Claude Code",
      selfHostable: false,
      routesCopilotModels,
      getEnabledModelEntries: () => enabled,
      getInstallState: (): InstallState => ({ kind: "ready", source: "custom" }),
    },
    settings: SETTINGS,
    selfHostWarning: false,
    catalog: null,
    effortCatalog: null,
    preload: "ready",
    defaultSelection: null,
    ...rest,
  };
}

const model = (baseModelId: string, extra: Partial<ModelEntry> = {}): ModelEntry => ({
  baseModelId,
  name: baseModelId.toUpperCase(),
  provider: null,
  effortOptions: [],
  ...extra,
});

describe("pickerCatalog", () => {
  beforeEach(() => {
    mockLocked.mockReset().mockReturnValue([]);
    mockShouldPreview.mockReset().mockReturnValue(false);
  });

  describe("toPickerModel()", () => {
    it("copies the display fields of a settings-backed model and nothing else", () => {
      const picked = toPickerModel({
        name: "sonnet",
        provider: "agent",
        displayName: "Sonnet",
        capabilities: [ModelCapability.VISION],
        _group: "Claude Code",
        _backendId: "claude",
        _subtitle: "Fast",
        _isFree: true,
        _disabledReason: "Add API key",
        _needsSelfHostWarning: true,
        _needsLicense: false,
        apiKey: "SENTINEL-KEY",
        baseUrl: "https://internal.example",
        openAIOrgId: "org-SENTINEL",
      } as Parameters<typeof toPickerModel>[0]);
      expect(picked).toEqual({
        name: "sonnet",
        provider: "agent",
        displayName: "Sonnet",
        capabilities: [ModelCapability.VISION],
        group: "Claude Code",
        backendId: "claude",
        subtitle: "Fast",
        isFree: true,
        disabledReason: "Add API key",
        needsSelfHostWarning: true,
        needsLicense: false,
      });
      expect(JSON.stringify(picked)).not.toContain("SENTINEL");
    });

    it("falls back to the name when the model has no display name and omits unset fields", () => {
      expect(toPickerModel({ name: "gpt-5", provider: "agent" })).toEqual({
        name: "gpt-5",
        provider: "agent",
        displayName: "gpt-5",
      });
    });

    it("copies the capabilities array so later edits to the source do not reach the picker", () => {
      const capabilities = [ModelCapability.VISION];
      const picked = toPickerModel({ name: "m", provider: "agent", capabilities });
      capabilities.push(ModelCapability.REASONING);
      expect(picked.capabilities).toEqual([ModelCapability.VISION]);
    });
  });

  describe("readinessOf()", () => {
    it.each<[InstallState, string]>([
      [{ kind: "checking", source: "managed" }, "checking"],
      [{ kind: "ready", source: "custom" }, "ready"],
      [{ kind: "absent" }, "not_set_up"],
      [
        {
          kind: "incompatible",
          source: "custom",
          currentVersion: "1.0.0",
          minVersion: "2.0.0",
          message: "path /Users/me/bin is too old",
        },
        "update_required",
      ],
      [{ kind: "error", message: "spawn /Users/me/bin ENOENT" }, "setup_error"],
    ])("maps %j to the label %s without carrying paths, versions or messages", (state, label) => {
      expect(readinessOf(state)).toBe(label);
    });
  });

  describe("buildBackendSummary()", () => {
    it("reduces an enabled model to display fields and turns a missing credential into a flag", () => {
      const summary = buildBackendSummary(
        inputs({
          enabled: [
            {
              baseModelId: "opus",
              name: "Opus",
              description: "Deep",
              credentialState: "missing_key",
              capabilities: [ModelCapability.REASONING],
              isFree: false,
              needsSelfHostWarning: true,
            },
            { baseModelId: "haiku", name: "Haiku", credentialState: "ok" },
          ],
        })
      );
      expect(summary.enabled).toEqual([
        {
          baseModelId: "opus",
          name: "Opus",
          description: "Deep",
          capabilities: [ModelCapability.REASONING],
          isFree: false,
          needsSelfHostWarning: true,
          missingKey: true,
        },
        { baseModelId: "haiku", name: "Haiku", missingKey: false },
      ]);
    });

    it("leaves enabled null for a backend that does not list enabled models", () => {
      expect(buildBackendSummary(inputs({ enabled: null })).enabled).toBeNull();
    });

    it("reports only the agent models that are enabled or the saved default, and null before a catalog exists", () => {
      const input = inputs({
        enabled: [{ baseModelId: "opus", name: "Opus", credentialState: "ok" }],
        catalog: {
          availableModels: [
            model("opus"),
            model("sonnet"),
            model("haiku", { description: "Quick" }),
          ],
        },
        defaultSelection: { baseModelId: "haiku", effort: "low" },
      });
      expect(buildBackendSummary(input).reported).toEqual([
        { baseModelId: "opus", name: "OPUS" },
        { baseModelId: "haiku", name: "HAIKU", description: "Quick" },
      ]);
      expect(buildBackendSummary({ ...input, catalog: null }).reported).toBeNull();
    });

    it("sorts the efforts the agent reports and falls back to the effort catalog", () => {
      const input = inputs({
        enabled: [
          { baseModelId: "opus", name: "Opus", credentialState: "ok" },
          { baseModelId: "sonnet", name: "Sonnet", credentialState: "ok" },
        ],
        catalog: {
          availableModels: [
            model("opus", {
              effortOptions: [
                { value: "high", label: "High" },
                { value: "low", label: "Low" },
              ],
            }),
          ],
        },
        effortCatalog: { haiku: [{ value: "medium", label: "Medium" }] },
      });
      expect(buildBackendSummary(input).efforts).toEqual({
        opus: [
          { value: "low", label: "Low" },
          { value: "high", label: "High" },
        ],
        haiku: [{ value: "medium", label: "Medium" }],
      });
    });

    it("carries readiness, preload state, self-host warning and default selection as plain values", () => {
      const summary = buildBackendSummary(
        inputs({
          selfHostWarning: true,
          preload: "pending",
          defaultSelection: { baseModelId: "opus", effort: null },
        })
      );
      expect(summary).toMatchObject({
        id: "claude",
        displayName: "Claude Code",
        readiness: "ready",
        preload: "pending",
        selfHostable: false,
        selfHostWarning: true,
        defaultSelection: { baseModelId: "opus", effort: null },
      });
    });

    it("previews the licensed model through the display funnel when a Copilot-routing backend has no license", () => {
      mockShouldPreview.mockReturnValue(true);
      mockLocked.mockReturnValue([
        {
          name: "copilot-plus-flash",
          provider: "copilot-plus",
          displayName: "Copilot Flash",
          enabled: true,
          _needsLicense: true,
          _disabledReason: "Copilot license required",
          apiKey: "SENTINEL-KEY",
        },
      ]);
      const summary = buildBackendSummary(inputs({ routesCopilotModels: true }));
      expect(mockLocked).toHaveBeenCalledWith(SETTINGS.copilotPlusCatalog, {
        group: "Claude Code",
        backendId: "claude",
      });
      expect(summary.lockedPreview).toEqual([
        {
          name: "copilot-plus-flash",
          provider: "copilot-plus",
          displayName: "Copilot Flash",
          disabledReason: "Copilot license required",
          needsLicense: true,
        },
      ]);
    });

    it("shows no license preview for a backend that does not route Copilot models", () => {
      mockShouldPreview.mockReturnValue(true);
      expect(buildBackendSummary(inputs()).lockedPreview).toEqual([]);
      expect(mockLocked).not.toHaveBeenCalled();
    });
  });
});
