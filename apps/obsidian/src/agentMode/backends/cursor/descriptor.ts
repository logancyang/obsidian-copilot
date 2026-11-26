import { simpleBinaryBackendProcess } from "@/agentMode/backends/shared/simpleBinaryBackend";
import { agentOriginEnabledModelEntries } from "@/agentMode/backends/shared/agentEnabledModels";
import { resolveEffort } from "@/lib/model-effort";
import { logWarn } from "@/logger";
import {
  subscribeToSettingsChange,
  updateAgentModeBackendFields,
  type CopilotSettings,
  type CursorBackendSettings,
} from "@/settings/model";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { sanitizeBuiltinSkillEnvOverrides } from "@/agentMode/backends/shared/builtinSkillEnv";
import type {
  BackendDescriptor,
  BackendProcess,
  EnabledModelEntry,
  InstallState,
  ModelSelection,
  ModelSelectionSession,
  ModelWireCodec,
} from "@/agentMode/session/types";
import type { Destination } from "@/types/destination";
import { CursorBackend, cursorResolverEnv } from "./CursorBackend";
import { CursorInstallModal } from "./CursorInstallModal";
import { CursorSettingsPanel } from "./CursorSettingsPanel";
import { getCursorAuthStatus, signInToCursor, signOutFromCursor } from "./cursorAuth";
import { cursorBinarySearchDirs, resolveCursorBinary } from "./cursorBinaryResolver";
import { buildCursorModeMapping } from "./cursorModeMapping";
import CursorLogo from "./logo.svg";

const cursorWire: ModelWireCodec = {
  encode: (selection: ModelSelection) => selection.baseModelId,
  decode: (wireId: string) => ({
    selection: { baseModelId: wireId, effort: null },
    provider: null,
  }),
};

export function updateCursorFields(partial: Partial<CursorBackendSettings>): void {
  updateAgentModeBackendFields("cursor", partial);
}

export function resolveCursorCliPath(settings: CopilotSettings): string | null {
  return resolveCursorBinary({
    override: settings.agentMode?.backends?.cursor?.binaryPath,
    ...cursorResolverEnv(),
  });
}

export function detectCursorCliPath(): string | null {
  return resolveCursorBinary({ override: undefined, ...cursorResolverEnv() });
}

export function cursorCliDetectionSearchDirs(): string[] {
  return cursorBinarySearchDirs({ override: undefined, ...cursorResolverEnv() });
}

function cursorChildEnv(settings: CopilotSettings): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...sanitizeBuiltinSkillEnvOverrides(settings.agentMode?.backends?.cursor?.envOverrides),
  };
}

export const CursorBackendDescriptor: BackendDescriptor = {
  id: "cursor",
  displayName: "Cursor",
  Icon: CursorLogo,
  selfHostable: false,
  routesCopilotModels: false,
  setupDescription:
    "Cursor models, billed to your Cursor account. Runs the Cursor agent already on your machine.",
  skillsProjectDir: ".cursor/skills",
  crossDiscoveredAgents: [],
  restartOnManagedSkillsChange: false,
  restartOnProviderConfigChange: false,
  restartOnSystemPromptChange: true,
  summarizesSessionTitle: false,
  wire: cursorWire,
  showModelDescriptions: true,

  dataDestination(): Destination {
    return { kind: "cloud", label: "Cursor" };
  },

  getEnabledModelEntries(settings: CopilotSettings): EnabledModelEntry[] {
    const entries = agentOriginEnabledModelEntries(settings, "cursor", (wireId) =>
      cursorWire.decode(wireId)
    );
    return entries.length > 0 ? [...entries] : (entries as EnabledModelEntry[]);
  },

  getInstallState(settings: CopilotSettings): InstallState {
    return resolveCursorCliPath(settings)
      ? { kind: "ready", source: "custom" }
      : { kind: "absent" };
  },

  getResolvedBinaryPath(settings: CopilotSettings): string | null {
    return resolveCursorCliPath(settings);
  },

  subscribeInstallState(cb: () => void): () => void {
    return subscribeToSettingsChange((prev, next) => {
      const previous = prev.agentMode?.backends?.cursor;
      const nextCursor = next.agentMode?.backends?.cursor;
      if (
        previous?.binaryPath !== nextCursor?.binaryPath ||
        previous?.binarySource !== nextCursor?.binarySource ||
        previous?.envOverrides !== nextCursor?.envOverrides
      ) {
        cb();
      }
    });
  },

  openInstallUI(app): void {
    new CursorInstallModal(app).open();
  },

  auth: {
    getProbeKey(settings) {
      const env = cursorChildEnv(settings);
      return requireNodeModule<typeof import("node:crypto")>("crypto")
        .createHash("sha256")
        .update(
          JSON.stringify([
            resolveCursorCliPath(settings),
            env.CURSOR_API_KEY ?? "",
            env.CURSOR_AUTH_TOKEN ?? "",
            Object.entries(settings.agentMode?.backends?.cursor?.envOverrides ?? {}).sort(
              ([left], [right]) => left.localeCompare(right)
            ),
          ])
        )
        .digest("hex");
    },
    async getStatus(settings) {
      const cursorPath = resolveCursorCliPath(settings);
      if (!cursorPath) return { signedIn: false };
      const status = await getCursorAuthStatus(cursorPath, cursorChildEnv(settings));
      return { signedIn: status.loggedIn, ...(status.label ? { label: status.label } : {}) };
    },
    async signOut(settings, options) {
      const cursorPath = resolveCursorCliPath(settings);
      if (!cursorPath) throw new Error("Set up Cursor before signing out.");
      const status = await signOutFromCursor(cursorPath, cursorChildEnv(settings), options);
      return { signedIn: status.loggedIn, ...(status.label ? { label: status.label } : {}) };
    },
    async signIn(settings, handlers) {
      const cursorPath = resolveCursorCliPath(settings);
      if (!cursorPath) return { signedIn: false };
      const status = await signInToCursor(cursorPath, cursorChildEnv(settings), handlers).done;
      if (!status.loggedIn && !handlers?.signal?.aborted) {
        logWarn("[AgentMode] Cursor browser sign-in ended without a verified account");
      }
      return { signedIn: status.loggedIn, ...(status.label ? { label: status.label } : {}) };
    },
  },

  async applySelection(session: ModelSelectionSession, selection: ModelSelection): Promise<void> {
    const currentBase = session.getState()?.model?.current.baseModelId;
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

  // Cursor puts effort in each model id, so probing the catalog keeps a new chat on "Loading agent models…".
  // https://github.com/logancyang/obsidian-copilot/issues/4671
  createBackendProcess(args): BackendProcess {
    return simpleBinaryBackendProcess(args, new CursorBackend(args.clientVersion));
  },

  SettingsPanel: CursorSettingsPanel,

  getModeMapping() {
    return buildCursorModeMapping();
  },
};
