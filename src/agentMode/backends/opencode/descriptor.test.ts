import { OPENCODE_PINNED_VERSION, OPENCODE_MIN_VERSION } from "./ui/opencodeVersion";
import { getOpencodeBinaryManager, OpencodeBackendDescriptor } from "./descriptor";
import { legacyVaultDataDir } from "./OpencodeBinaryManager";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { FileSystemAdapter } from "obsidian";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import type { BackendState, ModelEntry } from "@/agentMode/session/types";
import { getSettings, setSettings, type CopilotSettings } from "@/settings/model";

jest.mock("@/settings/model", () => ({
  ...jest.requireActual("@/settings/model"),
  subscribeToSettingsChange: jest.fn(),
}));

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

describe("descriptor", () => {
  describe("OpencodeBackendDescriptor", () => {
    describe("dataDestination()", () => {
      const settings = {
        providers: {
          local: {
            providerId: "local",
            providerType: "openai-compatible",
            displayName: "LM Box",
            baseUrl: "http://localhost:1234/v1",
            origin: { kind: "byok" },
            addedAt: 0,
          },
        },
      } as unknown as CopilotSettings;

      it.each([
        ["local/qwen3", "LM Box (http://localhost:1234/v1)"],
        ["zen/big-pickle", "zen, as set in OpenCode"],
        ["__preload_pending__", null],
      ])(
        "names where %s is sent for https://github.com/logancyang/obsidian-copilot/issues/2889",
        (baseModelId, expected) => {
          expect(OpencodeBackendDescriptor.dataDestination?.(settings, baseModelId)).toBe(expected);
        }
      );
    });

    describe("managedInstall.getState()", () => {
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/578 reports the shared manager's install progress", () => {
        const plugin = vaultPlugin(os.tmpdir());
        const manager = getOpencodeBinaryManager(plugin);
        const getState = jest.spyOn(manager, "getRuntimeState").mockReturnValue({
          kind: "installing",
          progress: { label: "Downloading opencode — 1.0 KB / 2.0 KB", percent: 42 },
        });

        expect(OpencodeBackendDescriptor.managedInstall?.getState(plugin)).toEqual({
          kind: "running",
          label: "Downloading opencode — 1.0 KB / 2.0 KB",
          percent: 42,
        });
        getState.mockRestore();
      });
    });

    describe("managedInstall.subscribe()", () => {
      it("forwards the listener to the shared manager and returns its unsubscribe function", () => {
        const plugin = vaultPlugin(os.tmpdir());
        const manager = getOpencodeBinaryManager(plugin);
        const cleanup = jest.fn();
        const subscribe = jest.spyOn(manager, "subscribeRuntimeState").mockReturnValue(cleanup);
        const listener = jest.fn();
        expect(OpencodeBackendDescriptor.managedInstall?.subscribe(plugin, listener)).toBe(cleanup);
        expect(subscribe).toHaveBeenCalledWith(listener);
        subscribe.mockRestore();
      });
    });

    describe("managedInstall.run()", () => {
      it("upgrades a custom binary through upgradeCustomBinary and a managed one through upgradeManaged", async () => {
        const manager = getOpencodeBinaryManager(vaultPlugin(os.tmpdir()));
        const upgradeCustom = jest.spyOn(manager, "upgradeCustomBinary").mockResolvedValue({
          version: "1.0.0",
          path: process.execPath,
        });
        const upgradeManaged = jest.spyOn(manager, "upgradeManaged").mockResolvedValue({
          version: "1.0.0",
          path: process.execPath,
        });
        const original = getSettings().agentMode;

        try {
          for (const source of ["custom", "managed"] as const) {
            setSettings((current) => ({
              agentMode: {
                ...current.agentMode,
                backends: {
                  ...current.agentMode.backends,
                  opencode: {
                    ...current.agentMode.backends?.opencode,
                    binaryPath: process.execPath,
                    binaryVersion: "1.0.0",
                    binarySource: source,
                  },
                },
              },
            }));
            await OpencodeBackendDescriptor.managedInstall?.run(vaultPlugin(os.tmpdir()));
          }

          expect(upgradeCustom).toHaveBeenCalledTimes(1);
          expect(upgradeManaged).toHaveBeenCalledTimes(1);
        } finally {
          setSettings({ agentMode: original });
          upgradeCustom.mockRestore();
          upgradeManaged.mockRestore();
        }
      });
    });

    describe("wire.decode()", () => {
      const decode = OpencodeBackendDescriptor.wire.decode;

      it("decodes a provider/model id as a selection with no effort", () => {
        expect(decode("anthropic/claude-sonnet-4-5")).toEqual({
          selection: { baseModelId: "anthropic/claude-sonnet-4-5", effort: null },
          provider: "anthropic",
        });
      });

      it("decodes every effort suffix from none through max as the effort of its base model id", () => {
        for (const effort of ["none", "minimal", "low", "medium", "high", "xhigh", "max"]) {
          expect(decode(`anthropic/claude-opus-4-7/${effort}`)).toEqual({
            selection: { baseModelId: "anthropic/claude-opus-4-7", effort },
            provider: "anthropic",
          });
        }
      });

      it("decodes a three-segment id whose last segment is not an effort as a base model id with no effort", () => {
        expect(decode("openrouter/anthropic/claude-sonnet-4-5")).toEqual({
          selection: { baseModelId: "openrouter/anthropic/claude-sonnet-4-5", effort: null },
          provider: "openrouterai",
        });
        expect(decode("openrouter/anthropic/claude-3.5-haiku")).toEqual({
          selection: { baseModelId: "openrouter/anthropic/claude-3.5-haiku", effort: null },
          provider: "openrouterai",
        });
      });

      it("decodes a four-segment umbrella id with a known effort suffix as a base model id plus effort", () => {
        expect(decode("openrouter/anthropic/claude-sonnet-4.5/high")).toEqual({
          selection: { baseModelId: "openrouter/anthropic/claude-sonnet-4.5", effort: "high" },
          provider: "openrouterai",
        });
        expect(decode("openrouter/anthropic/claude-sonnet-4.5/none")).toEqual({
          selection: { baseModelId: "openrouter/anthropic/claude-sonnet-4.5", effort: "none" },
          provider: "openrouterai",
        });
        expect(decode("openrouter/openai/gpt-5/xhigh")).toEqual({
          selection: { baseModelId: "openrouter/openai/gpt-5", effort: "xhigh" },
          provider: "openrouterai",
        });
        expect(decode("openrouter/openai/gpt-oss-120b:exacto/none")).toEqual({
          selection: { baseModelId: "openrouter/openai/gpt-oss-120b:exacto", effort: "none" },
          provider: "openrouterai",
        });
      });

      it("decodes a single-segment id or an unknown trailing segment as a base model id with no effort", () => {
        expect(decode("just-a-name")).toEqual({
          selection: { baseModelId: "just-a-name", effort: null },
          provider: null,
        });
        expect(decode("anthropic/foo/bar/baz")).toEqual({
          selection: { baseModelId: "anthropic/foo/bar/baz", effort: null },
          provider: "anthropic",
        });
        expect(decode("a/b/c/d")).toEqual({
          selection: { baseModelId: "a/b/c/d", effort: null },
          provider: null,
        });
      });
    });

    describe("wire.encode()", () => {
      const encode = OpencodeBackendDescriptor.wire.encode;

      it("encodes a selection without effort as its base model id", () => {
        expect(encode({ baseModelId: "anthropic/claude-sonnet-4-5", effort: null })).toBe(
          "anthropic/claude-sonnet-4-5"
        );
      });

      it("encodes a selection with effort as the base model id plus the effort suffix", () => {
        expect(encode({ baseModelId: "anthropic/claude-sonnet-4-5", effort: "high" })).toBe(
          "anthropic/claude-sonnet-4-5/high"
        );
      });

      it("encodes every decoded id back to the original wire id", () => {
        const ids = [
          "anthropic/claude-sonnet-4-5",
          "anthropic/claude-sonnet-4-5/low",
          "openai/gpt-5/high",
          "anthropic/claude-opus-4-7/max",
          "openrouter/anthropic/claude-sonnet-4.5",
          "openrouter/anthropic/claude-sonnet-4.5/none",
          "openrouter/anthropic/claude-sonnet-4.5/high",
          "lmstudio-byok-id/lmstudio-community/Qwen2.5-7B-Instruct-GGUF",
          "ollama-byok-id/llama3.2",
        ];
        for (const id of ids) {
          const decoded = OpencodeBackendDescriptor.wire.decode(id);
          expect(encode(decoded.selection)).toBe(id);
        }
      });

      it("round-trips a catalog-less BYOK wire id whose model name contains slashes", () => {
        const wireId = "byok-uuid-abc/lmstudio-community/Qwen2.5-7B-Instruct-GGUF";
        const decoded = OpencodeBackendDescriptor.wire.decode(wireId);
        expect(decoded).toEqual({
          selection: { baseModelId: wireId, effort: null },
          provider: null,
        });
        expect(OpencodeBackendDescriptor.wire.encode(decoded.selection)).toBe(wireId);
      });
    });

    describe("applySelection()", () => {
      function entryOffering(baseModelId: string, efforts: string[]): ModelEntry {
        return {
          baseModelId,
          name: baseModelId,
          provider: null,
          effortOptions: efforts.map((effort) => ({ value: effort, label: effort })),
        };
      }

      function makeSession(state: BackendState): {
        session: AgentSession;
        applyModelWireId: jest.Mock;
        setConfigOption: jest.Mock;
      } {
        let currentState = state;
        const applyModelWireId = jest.fn(async () => {
          currentState = {
            ...currentState,
            model: currentState.model
              ? {
                  ...currentState.model,
                  current: { baseModelId: "openai/gpt-5", effort: "low" },
                  apply: {
                    kind: "setConfigOption",
                    configId: "model",
                    effortConfigId: "effort",
                  },
                }
              : null,
          };
        });
        const setConfigOption = jest.fn(async () => undefined);
        return {
          session: {
            getState: () => currentState,
            applyModelWireId,
            setConfigOption,
          } as unknown as AgentSession,
          applyModelWireId,
          setConfigOption,
        };
      }

      it.each(["high", null])(
        "https://github.com/Brevilabs/obsidian-copilot-private/issues/219 resolves missing effort on the active model without resetting it: %s",
        async (effort) => {
          const { session, applyModelWireId, setConfigOption } = makeSession({
            model: {
              current: { baseModelId: "openai/gpt-5", effort },
              availableModels: [entryOffering("openai/gpt-5", ["high", "low"])],
              apply: { kind: "setConfigOption", configId: "model", effortConfigId: "effort" },
            },
            mode: null,
          });
          await OpencodeBackendDescriptor.applySelection(session, {
            baseModelId: "openai/gpt-5",
            effort: null,
          });
          expect(applyModelWireId).not.toHaveBeenCalled();
          expect(setConfigOption).toHaveBeenCalledWith("effort", "low");
        }
      );

      it("sets the effort config option without switching the model when only the effort changes", async () => {
        const { session, applyModelWireId, setConfigOption } = makeSession({
          model: {
            current: { baseModelId: "openai/gpt-5", effort: "low" },
            availableModels: [entryOffering("openai/gpt-5", ["low", "high"])],
            apply: { kind: "setConfigOption", configId: "model", effortConfigId: "effort" },
          },
          mode: null,
        });
        await OpencodeBackendDescriptor.applySelection(session, {
          baseModelId: "openai/gpt-5",
          effort: "high",
        });
        expect(applyModelWireId).not.toHaveBeenCalled();
        expect(setConfigOption).toHaveBeenCalledWith("effort", "high");
      });

      it("switches the base model before applying its config-option-backed effort", async () => {
        const { session, applyModelWireId, setConfigOption } = makeSession({
          model: {
            current: { baseModelId: "anthropic/claude-sonnet", effort: "low" },
            availableModels: [entryOffering("openai/gpt-5", ["low", "high"])],
            apply: { kind: "setConfigOption", configId: "model", effortConfigId: "effort" },
          },
          mode: null,
        });
        await OpencodeBackendDescriptor.applySelection(session, {
          baseModelId: "openai/gpt-5",
          effort: "high",
        });
        expect(applyModelWireId).toHaveBeenCalledWith("openai/gpt-5");
        expect(setConfigOption).toHaveBeenCalledWith("effort", "high");
        expect(applyModelWireId.mock.invocationCallOrder[0]).toBeLessThan(
          setConfigOption.mock.invocationCallOrder[0]
        );
      });

      it("activates the bare model when the catalog is config-option backed but publishes no effort option, dropping a saved level instead of suffixing it (https://github.com/Brevilabs/obsidian-copilot-private/issues/364)", async () => {
        const { session, applyModelWireId, setConfigOption } = makeSession({
          model: {
            current: { baseModelId: "opencode/big-pickle", effort: null },
            availableModels: [entryOffering("copilot-plus/copilot-plus-flash", [])],
            apply: { kind: "setConfigOption", configId: "model" },
          },
          mode: null,
        });

        await OpencodeBackendDescriptor.applySelection(session, {
          baseModelId: "copilot-plus/copilot-plus-flash",
          effort: "high",
        });

        expect(applyModelWireId).toHaveBeenCalledTimes(1);
        expect(applyModelWireId).toHaveBeenCalledWith("copilot-plus/copilot-plus-flash");
        expect(setConfigOption).not.toHaveBeenCalled();
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/219 applies the lowest effort when the saved level is no longer offered (https://github.com/logancyang/obsidian-copilot/issues/2917)", async () => {
        const { session, applyModelWireId, setConfigOption } = makeSession({
          model: {
            current: { baseModelId: "anthropic/claude-sonnet", effort: null },
            availableModels: [entryOffering("openai/gpt-5", ["low", "high"])],
            apply: { kind: "setConfigOption", configId: "model", effortConfigId: "effort" },
          },
          mode: null,
        });

        await OpencodeBackendDescriptor.applySelection(session, {
          baseModelId: "openai/gpt-5",
          effort: "medium",
        });

        expect(applyModelWireId).toHaveBeenCalledWith("openai/gpt-5");
        expect(setConfigOption).toHaveBeenCalledWith("effort", "low");
      });
    });

    describe("onPluginLoad()", () => {
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/530 reconciles disk state then checks the pin before allowing startup", async () => {
        const plugin = vaultPlugin(os.tmpdir());
        const manager = getOpencodeBinaryManager(plugin);
        const refresh = jest.spyOn(manager, "refreshInstallState").mockResolvedValue();
        const automatic = jest.spyOn(manager, "autoUpgrade").mockResolvedValue();
        try {
          await OpencodeBackendDescriptor.onPluginLoad?.(plugin);
          expect(refresh).toHaveBeenCalledTimes(1);
          expect(automatic).toHaveBeenCalledWith(
            OPENCODE_PINNED_VERSION,
            OPENCODE_MIN_VERSION,
            expect.any(Function)
          );
        } finally {
          refresh.mockRestore();
          automatic.mockRestore();
        }
      });
      it("rebinds the shared manager to the vault of the plugin lifecycle that loads", async () => {
        const emptyVault = await fs.promises.mkdtemp(path.join(os.tmpdir(), "opencode-load-a-"));
        const legacyVault = await vaultWithLegacyInstall("opencode-load-b-", 12);
        try {
          await OpencodeBackendDescriptor.onPluginLoad?.(vaultPlugin(emptyVault));
          const manager = getOpencodeBinaryManager(vaultPlugin(emptyVault));
          const before = await manager.downloadsSize();

          await OpencodeBackendDescriptor.onPluginLoad?.(vaultPlugin(legacyVault));

          expect((await manager.downloadsSize()) - before).toBe(12);
        } finally {
          await fs.promises.rm(emptyVault, { recursive: true, force: true });
          await fs.promises.rm(legacyVault, { recursive: true, force: true });
        }
      });
    });

    describe("subscribeInstallState()", () => {
      it("ignores model and probe writes while reporting binary changes (https://github.com/logancyang/obsidian-copilot-preview/issues/103)", () => {
        const unsubscribe = jest.fn();
        const { subscribeToSettingsChange } = jest.requireMock<{
          subscribeToSettingsChange: jest.Mock;
        }>("@/settings/model");
        subscribeToSettingsChange.mockReturnValue(unsubscribe);

        const callback = jest.fn();
        expect(OpencodeBackendDescriptor.subscribeInstallState({} as never, callback)).toBe(
          unsubscribe
        );
        const settingsChangeHandler = subscribeToSettingsChange.mock.calls[0][0] as (
          prev: CopilotSettings,
          next: CopilotSettings
        ) => void;
        const settings = (opencode: Record<string, unknown>): CopilotSettings =>
          ({ agentMode: { backends: { opencode } } }) as unknown as CopilotSettings;
        const previousOpencode = {
          binaryPath: "/bin/opencode",
          binaryVersion: "1.0.0",
          binarySource: "managed",
          defaultModel: { baseModelId: "openai/gpt-5", effort: null },
          probeSessionId: "probe-1",
        };
        const previous = settings(previousOpencode);

        for (const change of [
          { defaultModel: { baseModelId: "anthropic/claude-sonnet-4-5", effort: null } },
          { probeSessionId: "probe-2" },
        ]) {
          settingsChangeHandler(previous, settings({ ...previousOpencode, ...change }));
        }
        expect(callback).not.toHaveBeenCalled();

        for (const opencode of [
          { ...previousOpencode, binaryPath: "/new/opencode" },
          { ...previousOpencode, binaryVersion: "2.0.0" },
          { ...previousOpencode, binarySource: "custom" },
        ]) {
          settingsChangeHandler(previous, settings(opencode));
        }
        expect(callback).toHaveBeenCalledTimes(3);
      });
    });
  });

  const CONFIG_DIR = "my-config";

  function vaultPlugin(vaultBase: string): never {
    const adapter = new FileSystemAdapter();
    adapter.getBasePath = () => vaultBase;
    return {
      app: { vault: { adapter, configDir: CONFIG_DIR } },
      manifest: { id: "copilot-test" },
    } as never;
  }

  async function vaultWithLegacyInstall(prefix: string, bytes: number): Promise<string> {
    const vaultBase = await fs.promises.mkdtemp(path.join(os.tmpdir(), prefix));
    const bin = path.join(
      legacyVaultDataDir(vaultBase, CONFIG_DIR, "copilot-test"),
      "1.14.0",
      "bin",
      "opencode"
    );
    await fs.promises.mkdir(path.dirname(bin), { recursive: true });
    await fs.promises.writeFile(bin, "z".repeat(bytes));
    return vaultBase;
  }

  describe("getOpencodeBinaryManager()", () => {
    it("hands back the one manager without repointing it at the asking vault", async () => {
      const emptyVault = await fs.promises.mkdtemp(path.join(os.tmpdir(), "opencode-desc-a-"));
      const legacyVault = await vaultWithLegacyInstall("opencode-desc-b-", 12);
      try {
        const first = getOpencodeBinaryManager(vaultPlugin(emptyVault));
        const before = await first.downloadsSize();
        const second = getOpencodeBinaryManager(vaultPlugin(legacyVault));

        expect(second).toBe(first);
        expect((await second.downloadsSize()) - before).toBe(0);
      } finally {
        await fs.promises.rm(emptyVault, { recursive: true, force: true });
        await fs.promises.rm(legacyVault, { recursive: true, force: true });
      }
    });
  });
});
