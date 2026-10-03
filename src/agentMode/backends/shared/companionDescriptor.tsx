import { resolveEffort } from "@/lib/model-effort";
import { prefetchConfigEfforts } from "@/agentMode/backends/shared/prefetchConfigEfforts";
import { buildAgentSystemPrompt } from "@/agentMode/backends/shared/agentSystemPrompt";
import React from "react";
import { Terminal } from "lucide-react";
import { Modal, type App } from "obsidian";
import type { Root } from "react-dom/client";
import type CopilotPlugin from "@/main";
import {
  getSettings,
  subscribeToSettingsChange,
  updateAgentModeBackendFields,
  useSettingsValue,
} from "@/settings/model";
import type { BackendDescriptor, BackendProcess, InstallState } from "@/agentMode/session/types";
import type { AcpBackend } from "@/agentMode/acp/types";
import { simpleBinaryBackendProcess } from "@/agentMode/backends/shared/simpleBinaryBackend";
import {
  companionCompatibility,
  companionRuntimeConfigKey,
  companionModeMapping,
  type CompanionDefinition,
} from "@/agentMode/backends/shared/companionPolicy";
import {
  companionEnvironment,
  configureCompanion,
  installCompanion,
  resolveCompanionAdapter,
  resolveCompanionNode,
  signInCompanion,
  verifyCompanion,
} from "@/agentMode/backends/shared/companionRuntime";
import { CompanionSetupView } from "@/agentMode/backends/shared/ui/CompanionSetupView";
import { createPluginRoot } from "@/utils/react/createPluginRoot";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { agentOriginEnabledModelEntries } from "@/agentMode/backends/shared/agentEnabledModels";
import { EnvOverridesSetting } from "@/agentMode/backends/shared/EnvOverridesSetting";
import { logWarn } from "@/logger";

class CompanionBackend implements AcpBackend {
  readonly id;
  readonly displayName;
  constructor(
    private readonly definition: CompanionDefinition,
    private readonly pluginDirectory: string
  ) {
    this.id = definition.id;
    this.displayName = definition.displayName;
  }
  async buildSpawnDescriptor(ctx: { vaultBasePath: string }) {
    const config = getSettings().agentMode.backends[this.id] ?? {};
    if (this.definition.automaticTools && config.automaticToolsConsent !== true)
      throw new Error("Enable Antigravity automatic tools in Configure before starting a chat.");
    const binaryPath = config.binaryPath;
    if (!binaryPath) throw new Error(`Configure ${this.displayName} first.`);
    await verifyCompanion(this.definition, binaryPath);
    const environment = companionEnvironment(this.id, config);
    return {
      command: await resolveCompanionNode(environment),
      args: [await resolveCompanionAdapter(ctx.vaultBasePath, this.pluginDirectory, this.id)],
      cwd: ctx.vaultBasePath,
      env: {
        ...environment,
        ELECTRON_RUN_AS_NODE: "1",
        COMPANION_SYSTEM_PROMPT: buildAgentSystemPrompt(this.id),
        COMPANION_CLI_PATH: binaryPath,
        AGY_PATH: binaryPath,
        AGY_CWD: ctx.vaultBasePath,
        MUSE_CODE_EXECUTABLE: binaryPath,
        GROK_MUSE_POSTURE: JSON.stringify({ mode: "agent", shellSandbox: true }),
      },
    };
  }
}

interface SetupContainerProps {
  plugin: CopilotPlugin;
  definition: CompanionDefinition;
}

const CompanionSetupContainer: React.FC<SetupContainerProps> = ({ plugin, definition }) => {
  const settings = useSettingsValue();
  const config = settings.agentMode.backends[definition.id] ?? {};
  const [busy, setBusy] = React.useState(false);
  const [output, setOutput] = React.useState("");
  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setOutput("");
    try {
      const result = await operation();
      setOutput(
        typeof result === "string" ? result : "Finished. Start a chat to verify the connection."
      );
    } catch (error) {
      setOutput(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const consent = () =>
    new ConfirmModal(
      plugin.app,
      () => updateAgentModeBackendFields(definition.id, { automaticToolsConsent: true }),
      "Antigravity automatically approves tool execution. It can edit files and run commands through its CLI. Copilot cannot ask you before each tool or restrict these accesses to its Vault file service.",
      "Enable Antigravity automatic tools",
      "Enable"
    ).open();
  return (
    <CompanionSetupView
      displayName={definition.displayName}
      binaryPath={config.binaryPath ?? ""}
      busy={busy}
      output={output}
      automaticTools={definition.automaticTools}
      consent={config.automaticToolsConsent === true}
      onInstall={() => {
        new ConfirmModal(
          plugin.app,
          () =>
            run(() =>
              installCompanion(plugin, definition, (chunk) =>
                setOutput((previous) => previous + chunk)
              )
            ),
          `Run the official ${definition.displayName} installer? This installs or updates the CLI in your user account and stops its running Copilot sessions.`,
          "Install or update CLI",
          "Install / update"
        ).open();
      }}
      onCheck={() => {
        void run(async () => {
          const path = await configureCompanion(definition, config.binaryPath);
          await plugin.agentSessionManager?.onInstallStateChanged(definition.id);
          return `Verified ${path}. ACP startup is checked by Agent Mode.`;
        });
      }}
      onSavePath={(path) => run(() => configureCompanion(definition, path))}
      onSignIn={() => {
        void run(() => signInCompanion(definition, { onLine: (line) => setOutput(line) }));
      }}
      onTerminalSignIn={
        definition.loginArgs.length
          ? () => {
              void run(() =>
                signInCompanion(definition, { onLine: (line) => setOutput(line) }, true)
              );
            }
          : undefined
      }
      onConsent={() => {
        if (config.automaticToolsConsent) {
          void run(async () => {
            updateAgentModeBackendFields(definition.id, { automaticToolsConsent: false });
            await plugin.agentSessionManager?.restartBackend(
              definition.id,
              "automatic tool consent revoked",
              { deferWhileBusy: false }
            );
            return "Automatic tools disabled. Running Antigravity sessions have stopped; saved chats remain available.";
          });
        } else consent();
      }}
    />
  );
};

class CompanionSetupModal extends Modal {
  private root?: Root;
  constructor(
    private readonly plugin: CopilotPlugin,
    private readonly definition: CompanionDefinition
  ) {
    super(plugin.app);
  }
  onOpen(): void {
    this.titleEl.setText(`Configure ${this.definition.displayName}`);
    this.root = createPluginRoot(this.contentEl, this.plugin.app);
    this.root.render(<CompanionSetupContainer plugin={this.plugin} definition={this.definition} />);
  }
  onClose(): void {
    this.root?.unmount();
  }
}

export function createCompanionDescriptor(definition: CompanionDefinition): BackendDescriptor {
  const wire = {
    encode: (selection: { baseModelId: string }) => selection.baseModelId,
    decode: (id: string) => ({ selection: { baseModelId: id, effort: null }, provider: null }),
  };
  const SettingsPanel: React.FC<{ plugin: CopilotPlugin; app: App }> = ({ plugin }) => {
    const settings = useSettingsValue();
    return (
      <>
        <CompanionSetupContainer plugin={plugin} definition={definition} />
        <EnvOverridesSetting
          backendDisplayName={definition.displayName}
          value={settings.agentMode.backends[definition.id]?.envOverrides}
          onChange={(envOverrides) => updateAgentModeBackendFields(definition.id, { envOverrides })}
          hintExamples={["HTTP_PROXY", "HTTPS_PROXY"]}
        />
      </>
    );
  };
  return {
    id: definition.id,
    displayName: definition.displayName,
    Icon: Terminal,
    selfHostable: false,
    routesCopilotModels: false,
    setupDescription: `${definition.displayName} through its local CLI. Install, update and sign in from Configure.`,
    executionNotice: definition.automaticTools
      ? "Antigravity automatically approves tools. Its CLI can edit files and run commands without Copilot permission dialogs."
      : undefined,
    requiresExplicitNewSessionOnResumeFailure: true,
    skillsProjectDir: definition.skillsProjectDir,
    crossDiscoveredAgents: [],
    restartOnManagedSkillsChange: false,
    restartOnProviderConfigChange: false,
    restartOnSystemPromptChange: true,
    summarizesSessionTitle: false,
    wire,
    SettingsPanel,
    getInstallState(settings): InstallState {
      const config = settings.agentMode.backends[definition.id];
      if (!config?.binaryPath) return { kind: "absent" };
      if (definition.automaticTools && !config.automaticToolsConsent)
        return {
          kind: "error",
          message: "Enable automatic tools in Configure before starting Antigravity.",
        };
      const error = companionCompatibility(
        definition.id,
        config.binaryVersion ?? "",
        process.platform
      );
      return error ? { kind: "error", message: error } : { kind: "ready", source: "custom" };
    },
    getResolvedBinaryPath: (settings) =>
      settings.agentMode.backends[definition.id]?.binaryPath ?? null,
    subscribeInstallState: (_plugin, notify) =>
      subscribeToSettingsChange((prev, next) => {
        if (
          companionRuntimeConfigKey(prev.agentMode.backends[definition.id]) !==
          companionRuntimeConfigKey(next.agentMode.backends[definition.id])
        )
          notify();
      }),
    openInstallUI: (plugin) => new CompanionSetupModal(plugin, definition).open(),
    getEnabledModelEntries: (settings) => [
      ...agentOriginEnabledModelEntries(settings, definition.id, wire.decode),
    ],
    getModeMapping: (modes) => companionModeMapping(definition.id, modes?.availableModes),
    prefetchEffortCatalog: prefetchConfigEfforts,
    async applySelection(session, selection) {
      if (session.getState()?.model?.current.baseModelId !== selection.baseModelId) {
        await session.applyModelWireId(selection.baseModelId);
      }
      const model = session.getState()?.model;
      const apply = model?.apply;
      const effort = resolveEffort(
        selection.effort,
        model?.availableModels.find((entry) => entry.baseModelId === selection.baseModelId)
          ?.effortOptions
      );
      if (effort !== null && apply?.kind === "setConfigOption" && apply.effortConfigId)
        await session.setConfigOption(apply.effortConfigId, effort);
    },
    createBackendProcess(args): BackendProcess {
      return simpleBinaryBackendProcess(
        args,
        new CompanionBackend(
          definition,
          args.plugin.manifest.dir ??
            `${args.app.vault.configDir}/plugins/${args.plugin.manifest.id}`
        )
      );
    },
    async onPluginLoad() {
      if (getSettings().agentMode.backends[definition.id]?.binaryPath) return;
      try {
        await configureCompanion(definition);
      } catch (error) {
        logWarn(`[AgentMode] ${definition.displayName} detection: ${String(error)}`);
      }
    },
  };
}
