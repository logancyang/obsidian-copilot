import {
  baseModelIdOf,
  buildEffortSibling,
  buildPickerEntries,
  EMPTY_EFFORT_OPTIONS,
  MISSING_KEY_LABEL,
  resolveEfforts,
  type PickerActiveSession,
} from "@/agentMode/protocol/pickerEntries";
import type { BackendSummary, PickerModel } from "@/agentMode/protocol/state";
import { buildBackendSummary } from "@/agentMode/protocol/testBuilders";
import type { ModelState } from "@/agentMode/session/types";

const enabled = (
  baseModelId: string,
  extra: Partial<NonNullable<BackendSummary["enabled"]>[number]> = {}
) => ({ baseModelId, name: baseModelId.toUpperCase(), missingKey: false, ...extra });

const reported = (baseModelId: string, description?: string) => ({
  baseModelId,
  name: `${baseModelId}-reported`,
  ...(description ? { description } : {}),
});

const backend = (overrides: Partial<BackendSummary> & { id: string }): BackendSummary =>
  buildBackendSummary({ displayName: overrides.id, ...overrides });

function modelState(current: string, available: string[] = [current]): ModelState {
  return {
    current: { baseModelId: current, effort: null },
    availableModels: available.map((baseModelId) => ({
      baseModelId,
      name: `${baseModelId}-live`,
      provider: null,
      effortOptions: [],
    })),
    apply: { kind: "setModel" },
  };
}

const active = (
  backendId: string,
  overrides: Partial<PickerActiveSession> = {}
): PickerActiveSession => ({
  backendId,
  hasHistory: false,
  modelState: null,
  ...overrides,
});

const names = (entries: PickerModel[]) => entries.map((entry) => entry.name);

describe("pickerEntries", () => {
  describe("buildPickerEntries()", () => {
    it("lists an agent's enabled models under its name, using the model names the agent reports", () => {
      const { entries } = buildPickerEntries(
        [
          backend({
            id: "claude",
            displayName: "Claude Code",
            enabled: [enabled("opus"), enabled("haiku")],
            reported: [reported("opus", "Deep"), reported("haiku")],
          }),
        ],
        null
      );
      expect(entries).toEqual([
        {
          name: "opus",
          provider: "agent",
          displayName: "opus-reported",
          group: "Claude Code",
          backendId: "claude",
          subtitle: "Deep",
        },
        {
          name: "haiku",
          provider: "agent",
          displayName: "haiku-reported",
          group: "Claude Code",
          backendId: "claude",
        },
      ]);
    });

    it("shows a licensed-model preview above a Copilot-routing agent's own models", () => {
      const locked: PickerModel = {
        name: "copilot-plus-flash",
        provider: "copilot-plus",
        displayName: "Copilot Flash",
        group: "opencode",
        backendId: "opencode",
        needsLicense: true,
        disabledReason: "Copilot license required",
      };
      const { entries } = buildPickerEntries(
        [
          backend({
            id: "opencode",
            enabled: [enabled("local")],
            reported: [reported("local")],
            lockedPreview: [locked],
          }),
        ],
        null
      );
      expect(names(entries)).toEqual(["copilot-plus-flash", "local"]);
    });

    it("shows a loading row for an agent whose model preload has not settled and no models yet", () => {
      const { entries } = buildPickerEntries(
        [backend({ id: "codex", enabled: [enabled("gpt")], reported: null, preload: "pending" })],
        null
      );
      expect(entries).toEqual([
        expect.objectContaining({
          displayName: "Loading models…",
          disabledReason: "Loading…",
          backendId: "codex",
        }),
      ]);
    });

    it("keeps enabled models selectable when a settled preload found no catalog", () => {
      const { entries } = buildPickerEntries(
        [
          backend({
            id: "codex",
            enabled: [enabled("gpt"), enabled("keyless", { missingKey: true })],
            reported: null,
            preload: "error",
          }),
        ],
        null
      );
      expect(entries.map((e) => [e.name, e.disabledReason])).toEqual([
        ["gpt", undefined],
        ["keyless", MISSING_KEY_LABEL],
      ]);
    });

    it("shows a failed-to-load row when discovery settled without a catalog and nothing is enabled", () => {
      const { entries } = buildPickerEntries(
        [backend({ id: "codex", enabled: [], reported: null, preload: "ready" })],
        null
      );
      expect(entries).toEqual([
        expect.objectContaining({ displayName: "Failed to load", disabledReason: "Unavailable" }),
      ]);
    });

    it("shows nothing for an agent that has not started loading and has no catalog", () => {
      const { entries } = buildPickerEntries(
        [backend({ id: "codex", enabled: [enabled("gpt")], reported: null, preload: "absent" })],
        null
      );
      expect(entries).toEqual([]);
    });

    it("hides other agents' sections once the active session holds a conversation", () => {
      const backends = [
        backend({ id: "claude", enabled: [enabled("opus")], reported: [reported("opus")] }),
        backend({ id: "codex", enabled: [enabled("gpt")], reported: [reported("gpt")] }),
      ];
      const fresh = buildPickerEntries(backends, active("claude"));
      const inConversation = buildPickerEntries(backends, active("claude", { hasHistory: true }));
      expect(names(fresh.entries)).toEqual(["opus", "gpt"]);
      expect(names(inConversation.entries)).toEqual(["opus"]);
    });

    it("selects the row of the active session's model", () => {
      const { entries, selected } = buildPickerEntries(
        [backend({ id: "claude", enabled: [enabled("opus")], reported: [reported("opus")] })],
        active("claude", { modelState: modelState("opus") })
      );
      expect(selected).toBe(entries[0]);
    });

    it("puts a stranded active model at the end of its own agent's section when curation removed it from every list", () => {
      const { entries, selected } = buildPickerEntries(
        [backend({ id: "claude", enabled: [enabled("opus")], reported: [reported("opus")] })],
        active("claude", { modelState: modelState("legacy", ["legacy", "opus"]) })
      );
      expect(names(entries)).toEqual(["opus", "legacy"]);
      expect(selected).toMatchObject({ name: "legacy", displayName: "legacy-live" });
    });

    it("keeps a stranded active model inside its own agent's section when other agents follow it https://github.com/Brevilabs/obsidian-copilot-private/issues/612", () => {
      const { entries } = buildPickerEntries(
        [
          backend({ id: "opencode", enabled: [enabled("local")], reported: [reported("local")] }),
          backend({ id: "codex", enabled: [enabled("gpt")], reported: [reported("gpt")] }),
        ],
        active("opencode", { modelState: modelState("azure", ["azure"]) })
      );
      expect(names(entries)).toEqual(["local", "azure", "gpt"]);
    });

    it("carries the description of a stranded active model onto its row", () => {
      const state = modelState("legacy");
      state.availableModels[0].description = "Old and slow";
      const { selected } = buildPickerEntries(
        [backend({ id: "claude", enabled: [], reported: [] })],
        active("claude", { modelState: state })
      );
      expect(selected?.subtitle).toBe("Old and slow");
    });

    it("keeps the active model in its own section when it is reported but not enabled", () => {
      const { entries, selected } = buildPickerEntries(
        [
          backend({
            id: "claude",
            enabled: [enabled("opus")],
            reported: [reported("opus"), reported("sonnet", "Fast")],
          }),
        ],
        active("claude", { modelState: modelState("sonnet", ["sonnet", "opus"]) })
      );
      expect(names(entries)).toEqual(["opus", "sonnet"]);
      expect(selected).toMatchObject({ name: "sonnet", subtitle: "Fast" });
    });

    it("keeps another agent's saved default model even when it is not enabled", () => {
      const { entries } = buildPickerEntries(
        [
          backend({
            id: "codex",
            enabled: [enabled("gpt")],
            reported: [reported("gpt"), reported("saved")],
            defaultSelection: { baseModelId: "saved", effort: null },
          }),
        ],
        null
      );
      expect(names(entries)).toEqual(["gpt", "saved"]);
    });

    it("flags a model with a missing key, one the agent does not offer, free models and self-host warnings per row", () => {
      const { entries } = buildPickerEntries(
        [
          backend({
            id: "opencode",
            enabled: [
              enabled("no-key", { missingKey: true }),
              enabled("gone"),
              enabled("zen", { isFree: true }),
              enabled("cloud", { needsSelfHostWarning: true }),
            ],
            reported: [reported("no-key"), reported("zen"), reported("cloud")],
          }),
        ],
        null
      );
      expect(entries.map((e) => e.disabledReason)).toEqual([
        MISSING_KEY_LABEL,
        "Not offered by agent",
        undefined,
        undefined,
      ]);
      expect(entries[2].isFree).toBe(true);
      expect(entries[3].needsSelfHostWarning).toBe(true);
    });

    it("carries an enabled model's capabilities onto its row and leaves them unset otherwise", () => {
      const { entries } = buildPickerEntries(
        [
          backend({
            id: "claude",
            enabled: [enabled("opus", { capabilities: ["vision" as never] }), enabled("haiku")],
            reported: [reported("opus"), reported("haiku")],
          }),
        ],
        null
      );
      expect(entries[0].capabilities).toEqual(["vision"]);
      expect(entries[1].capabilities).toBeUndefined();
    });

    it("warns on every row of a cloud agent under Self-Host Mode, including its placeholder and stranded rows", () => {
      const cloud = backend({
        id: "claude",
        selfHostWarning: true,
        enabled: [enabled("opus")],
        reported: [reported("opus")],
      });
      const loading = backend({
        id: "codex",
        selfHostWarning: true,
        enabled: [],
        reported: null,
        preload: "pending",
      });
      const { entries, selected } = buildPickerEntries(
        [cloud, loading],
        active("claude", { modelState: modelState("legacy") })
      );
      expect(entries.every((entry) => entry.needsSelfHostWarning === true)).toBe(true);
      expect(selected?.name).toBe("legacy");
    });

    it.each([
      ["not_set_up", "Not set up"],
      ["update_required", "Update required"],
      ["setup_error", "Setup error"],
    ] as const)(
      "disables another agent's rows with the reason its readiness %s gives",
      (readiness, reason) => {
        const { entries } = buildPickerEntries(
          [
            backend({ id: "claude", enabled: [enabled("opus")], reported: [reported("opus")] }),
            backend({
              id: "codex",
              readiness,
              enabled: [enabled("gpt", { missingKey: true })],
              reported: [reported("gpt")],
            }),
          ],
          active("claude")
        );
        expect(entries.find((e) => e.backendId === "codex")?.disabledReason).toBe(reason);
      }
    );

    it("leaves another agent's rows selectable while it is ready or still being checked", () => {
      for (const readiness of ["ready", "checking"] as const) {
        const { entries } = buildPickerEntries(
          [
            backend({
              id: "codex",
              readiness,
              enabled: [enabled("gpt")],
              reported: [reported("gpt")],
            }),
          ],
          null
        );
        expect(entries[0].disabledReason).toBeUndefined();
      }
    });

    it("never disables the running agent's own rows when its setup goes missing", () => {
      const { entries } = buildPickerEntries(
        [
          backend({
            id: "claude",
            readiness: "not_set_up",
            enabled: [enabled("opus")],
            reported: [reported("opus")],
          }),
        ],
        active("claude", { modelState: modelState("opus") })
      );
      expect(entries[0].disabledReason).toBeUndefined();
    });

    it("skips a backend that lists no enabled models at all", () => {
      const { entries } = buildPickerEntries(
        [backend({ id: "claude", enabled: null, reported: [reported("opus")] })],
        null
      );
      expect(entries).toEqual([]);
    });

    it("returns no selection while the active session has not reported a model", () => {
      const { selected } = buildPickerEntries(
        [backend({ id: "claude", enabled: [enabled("opus")], reported: [reported("opus")] })],
        active("claude")
      );
      expect(selected).toBeNull();
    });
  });

  describe("baseModelIdOf()", () => {
    it("names the agent model of an agent row and nothing for a preview row", () => {
      expect(baseModelIdOf({ name: "opus", provider: "agent", displayName: "Opus" })).toBe("opus");
      expect(
        baseModelIdOf({ name: "flash", provider: "copilot-plus", displayName: "Flash" })
      ).toBeUndefined();
    });
  });

  describe("resolveEfforts()", () => {
    const backends = [
      backend({ id: "claude", efforts: { opus: [{ value: "high", label: "High" }] } }),
    ];

    it("returns the levels the host knows for the model", () => {
      expect(resolveEfforts(backends, "claude", "opus")).toEqual([
        { value: "high", label: "High" },
      ]);
    });

    it("returns the shared empty list for an unknown model or agent", () => {
      expect(resolveEfforts(backends, "claude", "haiku")).toBe(EMPTY_EFFORT_OPTIONS);
      expect(resolveEfforts(backends, "codex", "opus")).toBe(EMPTY_EFFORT_OPTIONS);
    });
  });

  describe("buildEffortSibling()", () => {
    const withEfforts = (): ModelState => {
      const state = modelState("opus");
      state.availableModels[0].effortOptions = [
        { value: "low", label: "Low" },
        { value: "high", label: "High" },
      ];
      state.current.effort = "low";
      return state;
    };

    it("offers the active model's own levels with the current effort", () => {
      expect(buildEffortSibling(withEfforts(), true)).toEqual({
        options: [
          { value: "low", label: "Low" },
          { value: "high", label: "High" },
        ],
        value: "low",
        disabled: false,
      });
    });

    it("is absent when the model has no effort levels or there is no model state", () => {
      expect(buildEffortSibling(modelState("opus"), true)).toBeNull();
      expect(buildEffortSibling(null, true)).toBeNull();
    });

    it("is disabled only when the agent is known not to switch effort", () => {
      expect(buildEffortSibling(withEfforts(), false)?.disabled).toBe(true);
      expect(buildEffortSibling(withEfforts(), null)?.disabled).toBe(false);
    });
  });
});
