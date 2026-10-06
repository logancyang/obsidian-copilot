import { prefetchConfigEfforts } from "@/agentMode/backends/shared/prefetchConfigEfforts";
import { Notice } from "obsidian";
import { resolveEffort } from "@/lib/model-effort";
import { codexAuth } from "./codexAuth";
import type CopilotPlugin from "@/main";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { detectBinary } from "@/utils/detectBinary";
import {
  subscribeToSettingsChange,
  updateAgentModeBackendFields,
  type CodexBackendSettings,
  type CopilotSettings,
} from "@/settings/model";
import { CodexBackend } from "./CodexBackend";
import { CodexInstallModal } from "./CodexInstallModal";
import CodexLogo from "./logo.svg";
import { CodexSettingsPanel } from "./CodexSettingsPanel";
import { agentOriginEnabledModelEntries } from "@/agentMode/backends/shared/agentEnabledModels";
import { simpleBinaryBackendProcess } from "@/agentMode/backends/shared/simpleBinaryBackend";
import type {
  EnabledModelEntry,
  ModelSelection,
  ModelWireCodec,
  PermissionOption,
} from "@/agentMode/session/types";
import type {
  BackendDescriptor,
  BackendProcess,
  InstallState,
  ModelSelectionSession,
} from "@/agentMode/session/types";
import { formatCodexModelId, parseCodexModelId } from "@/utils/codexModelId";
import { codexAcpSearchDirs, resolveCodexAcpBinary } from "./codexBinaryResolver";
import { CodexBinaryManager } from "./CodexBinaryManager";
import { CODEX_PINNED_VERSION } from "./codexArchive";
import { CODEX_BINARY_NAME } from "./cliSetup";
import { buildCodexModeMapping, buildCodexModeState } from "./codexModeMapping";
import { isSupportedCodexAcpPath, inspectCodexAcpPackage, CODEX_MIN_VERSION } from "./codexVersion";
import { classifyBinaryInstall } from "@/agentMode/backends/shared/binaryCompatibility";

const codexBinaryManager = new CodexBinaryManager();

export function getCodexBinaryManager(): CodexBinaryManager {
  return codexBinaryManager;
}

export function updateCodexFields(partial: Partial<CodexBackendSettings>): void {
  updateAgentModeBackendFields("codex", partial);
}

function codexAcpResolverEnv(): Parameters<typeof resolveCodexAcpBinary>[0] {
  const fs = requireNodeModule<typeof import("node:fs")>("fs");
  const os = requireNodeModule<typeof import("node:os")>("os");
  return {
    homeDir: os.homedir(),
    platform: process.platform,
    env: process.env,
    fs: {
      existsSync: (p) => fs.existsSync(p),
      readFileSync: (p, encoding) => fs.readFileSync(p, encoding),
      readdirSync: (p) => fs.readdirSync(p),
    },
  };
}

export async function detectCodexAcpPath(): Promise<string | null> {
  const fromKnownLocations = resolveCodexAcpBinary(codexAcpResolverEnv(), isSupportedCodexAcpPath);
  if (fromKnownLocations) return fromKnownLocations;

  // npm can install into a user-selected prefix outside the known directories;
  // retain PATH discovery while enforcing the same supported-package contract.
  // https://github.com/logancyang/obsidian-copilot/issues/2916
  const fromPath = await detectBinary(CODEX_BINARY_NAME);
  return isSupportedCodexAcpPath(fromPath ?? undefined) ? fromPath : null;
}

export function codexAcpDetectionSearchDirs(): string[] {
  return codexAcpSearchDirs(codexAcpResolverEnv());
}

const codexWire: ModelWireCodec = {
  encode: (selection: ModelSelection) =>
    formatCodexModelId(selection.baseModelId, selection.effort),
  decode: (wireId: string) => ({ selection: parseCodexModelId(wireId), provider: null }),
};

export const CodexBackendDescriptor: BackendDescriptor = {
  id: "codex",
  auth: codexAuth,
  displayName: "Codex",
  Icon: CodexLogo,
  selfHostable: false,
  routesCopilotModels: false,
  setupDescription:
    "OpenAI models, billed to your ChatGPT subscription. Runs the codex-acp adapter on your machine.",
  skillsProjectDir: ".agents/skills",
  crossDiscoveredAgents: [],
  restartOnManagedSkillsChange: false,
  restartOnProviderConfigChange: false,
  restartOnSystemPromptChange: true,
  summarizesSessionTitle: false,
  // Codex ends its turn on revise_plan without acting on the deny message.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/41
  planFeedbackDelivery: "next_turn",
  wire: codexWire,
  showModelDescriptions: true,

  getEnabledModelEntries(settings: CopilotSettings): EnabledModelEntry[] {
    return [
      ...agentOriginEnabledModelEntries(settings, "codex", (wireId) => codexWire.decode(wireId)),
    ];
  },

  normalizeModelName(name: string): string {
    return name.replace(/^gpt/i, "GPT");
  },

  presentPermissionOption(option: PermissionOption, metadata: unknown): PermissionOption {
    const decision = codexPermissionDecision(metadata);
    const isExecpolicyAmendment =
      decision === "acceptWithExecpolicyAmendment" && option.kind === "allow_always";
    const isNetworkPolicyAmendment =
      decision === "applyNetworkPolicyAmendment" &&
      (option.kind === "allow_always" || option.kind === "reject_always");
    if (!isExecpolicyAmendment && !isNetworkPolicyAmendment) return option;

    return {
      ...option,
      name: option.kind === "reject_always" ? "Block Always" : "Allow Always",
      description: option.name,
    };
  },

  getInstallState(settings: CopilotSettings): InstallState {
    const configured = settings.agentMode?.backends?.codex;
    if (!configured?.binaryPath) return { kind: "absent" };
    try {
      const installed = inspectCodexAcpPackage(configured.binaryPath);
      return classifyBinaryInstall(
        {
          kind: "installed",
          version: installed.runtimeVersion,
          source: configured.binarySource ?? "custom",
        },
        CODEX_MIN_VERSION,
        "Codex"
      );
    } catch (error) {
      return classifyBinaryInstall(
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? { kind: "absent" }
          : { kind: "error", message: error instanceof Error ? error.message : String(error) },
        CODEX_MIN_VERSION,
        "Codex"
      );
    }
  },

  getResolvedBinaryPath(settings: CopilotSettings): string | null {
    return settings.agentMode?.backends?.codex?.binaryPath ?? null;
  },

  subscribeInstallState(_plugin: CopilotPlugin, cb: () => void): () => void {
    return subscribeToSettingsChange((prev, next) => {
      if (
        prev.agentMode?.backends?.codex?.binaryPath !==
          next.agentMode?.backends?.codex?.binaryPath ||
        prev.agentMode?.backends?.codex?.binaryVersion !==
          next.agentMode?.backends?.codex?.binaryVersion ||
        prev.agentMode?.backends?.codex?.binarySource !==
          next.agentMode?.backends?.codex?.binarySource
      ) {
        cb();
      }
    });
  },

  openInstallUI(plugin: CopilotPlugin): void {
    new CodexInstallModal(plugin.app).open();
  },

  async onPluginLoad(): Promise<void> {
    codexBinaryManager.forgetSettledError();
    await codexBinaryManager.autoUpgrade(CODEX_PINNED_VERSION, CODEX_MIN_VERSION, (message) => {
      new Notice(message);
    });
  },

  managedInstall: {
    getState: () => codexBinaryManager.getActionState(),
    subscribe: (_plugin, onChange) => codexBinaryManager.subscribeRuntimeState(onChange),
    run: async () => {
      await codexBinaryManager.install();
    },
  },

  async applySelection(session: ModelSelectionSession, selection: ModelSelection): Promise<void> {
    const currentBase = session.getState()?.model?.current.baseModelId;
    // Model options accept bare ids; effort belongs to the selected model's refreshed
    // config catalog. https://github.com/Brevilabs/obsidian-copilot-private/issues/550
    if (currentBase !== selection.baseModelId) {
      await session.applyModelWireId(selection.baseModelId);
    }
    const model = session.getState()?.model;
    const apply = model?.apply;
    const effort = resolveEffort(
      selection.effort,
      model?.availableModels.find((entry) => entry.baseModelId === selection.baseModelId)
        ?.effortOptions
    );
    if (apply?.kind === "setConfigOption" && apply.effortConfigId && effort !== null) {
      await session.setConfigOption(apply.effortConfigId, effort);
    }
  },

  prefetchEffortCatalog: prefetchConfigEfforts,

  createBackendProcess(args): BackendProcess {
    return simpleBinaryBackendProcess(args, new CodexBackend(args.clientVersion));
  },

  SettingsPanel: CodexSettingsPanel,

  getModeMapping() {
    return buildCodexModeMapping();
  },

  getModeState(modeState, configOptions) {
    return buildCodexModeState(modeState, configOptions);
  },
};

function codexPermissionDecision(metadata: unknown): unknown {
  if (metadata === null || typeof metadata !== "object") return undefined;
  const codex = (metadata as Record<string, unknown>).codex;
  if (codex === null || typeof codex !== "object") return undefined;
  return (codex as Record<string, unknown>).decision;
}
