import { FileSystemAdapter, App, Notice, TFile } from "obsidian";
import { mockTFile } from "@/__tests__/mockObsidian";
import { join } from "node:path";
import { ClientView } from "@/agentMode/protocol/ClientView";
import { waitFor } from "@testing-library/react";
import { AgentSession } from "./AgentSession";
import type { AgentModelPreloader } from "./AgentModelPreloader";
import { buildNativeChatId } from "@/utils/nativeChatId";
import { CHAT_AGENT_VIEWTYPE } from "@/constants";
import { playNotificationSound } from "@/utils/notificationSound";
import { AgentSessionIndex } from "./AgentSessionIndex";
import { AgentSessionManager } from "./AgentSessionManager";
import { ProjectContentTracker } from "@/context/projectContentTracker";
import { GLOBAL_SCOPE } from "./scope";
import {
  getSettings as mockedGetSettings,
  setSettings as mockedSetSettings,
} from "@/settings/model";
import * as projectsState from "@/projects/state";
import {
  ensureProjectContextMaterialized,
  type ContextMaterializeProgress,
} from "@/context/projectContextMaterializer";
import { ProjectFileManager } from "@/projects/ProjectFileManager";
import {
  agentProjectContextLoadAtom,
  type AgentProjectContextLoadState,
  type ProjectConfig,
} from "@/aiParams";
import type { ProjectFileRecord } from "@/projects/type";
import { getProjectContextSignature } from "@/projects/projectContextSignature";
import { MethodUnsupportedError } from "@/agentMode/session/errors";
import { buildCodexModeMapping } from "@/agentMode/backends/codex/codexModeMapping";
import type {
  BackendProcess,
  BackendDescriptor,
  BackendId,
  BackendModelCatalog,
  BackendState,
  InstallState,
} from "./types";

const mockEnsureMaterialized = ensureProjectContextMaterialized as jest.Mock;

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

const settingsChangeCallbacks = new Set<
  (prev: { agentMode: unknown }, next: { agentMode: unknown }) => void
>();

const ensureAgentsFileForDiscoverySpy = jest.fn<Promise<void>, unknown[]>(async () => undefined);
jest.mock("@/instructions/agentsFile", () => ({
  ...jest.requireActual("@/instructions/agentsFile"),
  ensureAgentsFileForDiscovery: (...a: unknown[]): Promise<void> =>
    ensureAgentsFileForDiscoverySpy(...a),
}));

const mockTouchProjectLastUsed = jest.fn(async () => undefined);
jest.mock("@/projects/ProjectFileManager", () => ({
  ProjectFileManager: {
    getInstance: jest.fn(() => ({ touchProjectLastUsed: mockTouchProjectLastUsed })),
  },
}));

jest.mock("@/context/projectContextMaterializer", () => {
  const { getProjectContextSignature } = jest.requireActual("@/projects/projectContextSignature");
  const { getCachedProjectRecordById } = jest.requireActual("@/projects/state");
  return {
    ensureProjectContextMaterialized: jest.fn(async (_app: unknown, projectId: string) => {
      const record = getCachedProjectRecordById(projectId);
      return {
        additionalDirectories: [],
        contextSignature: record ? getProjectContextSignature(record) : undefined,
      };
    }),
    EMPTY_CONTEXT_MATERIALIZATION_RESULT: { additionalDirectories: [] },
  };
});

let mockNotificationSound = true;

jest.mock("@/utils/notificationSound", () => ({
  playNotificationSound: jest.fn(),
}));

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(() => ({
    agentMode: {
      activeBackend: "opencode",
      backends: {},
      notificationSound: mockNotificationSound,
      notificationSoundId: "piano",
    },
  })),
  setSettings: jest.fn(),
  subscribeToSettingsChange: jest.fn(
    (cb: (prev: { agentMode: unknown }, next: { agentMode: unknown }) => void) => {
      settingsChangeCallbacks.add(cb);
      return () => settingsChangeCallbacks.delete(cb);
    }
  ),
  settingsStore: { get: jest.fn(() => ({})), set: jest.fn() },
}));

function emitSettingsChange(prev: { agentMode: unknown }, next: { agentMode: unknown }): void {
  for (const cb of settingsChangeCallbacks) cb(prev, next);
}

let mockBackendIsRunning = true;
const mockBackendShutdown = jest.fn(async () => undefined);
const mockBackendStart = jest.fn(async () => undefined);
const mockBackendExitListeners = new Set<() => void>();
const mockSetPermissionPrompter = jest.fn();
let mockUnhealthyHandler: (() => void) | null = null;

function makeMockBackendProcess() {
  return {
    start: mockBackendStart,
    setPermissionPrompter: mockSetPermissionPrompter,
    setUnhealthyHandler: (handler: () => void) => {
      mockUnhealthyHandler = handler;
    },
    onExit: (fn: () => void) => {
      mockBackendExitListeners.add(fn);
      return () => mockBackendExitListeners.delete(fn);
    },
    isRunning: () => mockBackendIsRunning,
    shutdown: mockBackendShutdown,
    closeSession: jest.fn(async (_params: { sessionId: string }) => undefined),
    registerSessionHandler: jest.fn(() => () => {}),
  };
}

const mockSessionDispose = jest.fn(async () => undefined);
const mockSessionCancel = jest.fn(async () => undefined);
let nextBackendSessionId = 1;

interface MockSessionTestHandle {
  setStatus(
    status: "starting" | "idle" | "running" | "awaiting_permission" | "error" | "closed"
  ): void;
  setMessages(messages: { message: string }[], notify?: boolean): void;
  setHasUserVisibleMessages(value: boolean): void;
}

const sessionTestHandles = new Map<string, MockSessionTestHandle>();

function getSessionTestHandle(session: AgentSession): MockSessionTestHandle {
  const handle = sessionTestHandles.get(session.internalId);
  if (!handle) throw new Error(`No test handle for ${session.internalId}`);
  return handle;
}

function makeMockSession(overrides: {
  internalId: string;
  chatInputId?: string;
  backendSessionId?: string;
  backendId: string;
  backend?: BackendProcess;
  projectId?: string;
  ready?: Promise<void>;
  label?: string;
}): AgentSession {
  const sessionId = overrides.backendSessionId ?? `backend-${nextBackendSessionId++}`;
  let label: string | null = overrides.label ?? null;
  let labelSource: "user" | "agent" | null = overrides.label ? "agent" : null;
  let status: "starting" | "idle" | "running" | "awaiting_permission" | "error" | "closed" = "idle";
  let needsAttention = false;
  let displayMessages: { message: string }[] = [];
  let hasUserVisibleMessages = false;
  const listeners = new Set<{
    onMessagesChanged?: () => void;
    onStatusChanged?: (s: typeof status) => void;
    onNeedsAttentionChanged?: (v: boolean) => void;
  }>();
  const session = {
    internalId: overrides.internalId,
    chatInputId: overrides.chatInputId ?? overrides.internalId,
    backendId: overrides.backendId,
    projectId: overrides.projectId ?? GLOBAL_SCOPE,
    ready: overrides.ready ?? Promise.resolve(),
    getBackendSessionId: () => sessionId,
    getStatus: () => status,
    store: { getDisplayMessages: () => displayMessages },
    cancel: mockSessionCancel,
    backend: overrides.backend,
    backendSessionId: sessionId,
    releaseBackendSession: AgentSession.prototype.releaseBackendSession,
    dispose: mockSessionDispose,
    setModel: jest.fn(),
    setMode: jest.fn(),
    setConfigOption: jest.fn(),
    getLabel: () => label,
    getLabelSource: () => labelSource,
    restoreLabel: (next: string, source: "user" | "agent") => {
      label = next;
      labelSource = source;
    },
    setLabel: jest.fn(),
    loadDisplayMessages: jest.fn((messages) => {
      displayMessages = messages;
      hasUserVisibleMessages = messages.length > 0;
    }),
    seedSessionUsage: jest.fn(),
    getSessionUsage: () => null,
    subscribe: (l: Parameters<typeof listeners.add>[0]) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    hasUserVisibleMessages: () => hasUserVisibleMessages,
    getState: () => null,
    getRawSnapshot: () => ({ models: null, modes: null, configOptions: null }),
    getNeedsAttention: () => needsAttention,
    markNeedsAttention: () => {
      if (needsAttention) return;
      needsAttention = true;
      for (const l of listeners) l.onNeedsAttentionChanged?.(true);
    },
    clearNeedsAttention: () => {
      if (!needsAttention) return;
      needsAttention = false;
      for (const l of listeners) l.onNeedsAttentionChanged?.(false);
    },
  } as unknown as AgentSession;
  sessionTestHandles.set(overrides.internalId, {
    setStatus: (next) => {
      if (status === next) return;
      status = next;
      for (const l of listeners) l.onStatusChanged?.(next);
    },
    setMessages: (messages, notify = false) => {
      displayMessages = messages;
      if (notify) for (const l of listeners) l.onMessagesChanged?.();
    },
    setHasUserVisibleMessages: (value) => {
      hasUserVisibleMessages = value;
    },
  });
  return session;
}

const sessionCreateSpy = jest.spyOn(AgentSession, "start").mockImplementation((opts) =>
  makeMockSession({
    internalId: opts.internalId,
    chatInputId: opts.chatInputId,
    backendId: opts.backendId,
    backend: opts.backend,
    projectId: opts.projectId,
  })
);

type MockAgentChatFocus =
  | "none"
  | "inside"
  | "inside-sidebar"
  | "outside"
  | "other-leaf"
  | "unfocused-window";
let mockAgentChatFocus: MockAgentChatFocus = "none";

function buildWorkspace(): unknown {
  const inside = {} as Element;
  const outside = {} as Element;
  const ownerDocument = {
    hasFocus: () => mockAgentChatFocus !== "unfocused-window",
    get activeElement() {
      return ["inside", "inside-sidebar", "unfocused-window"].includes(mockAgentChatFocus)
        ? inside
        : outside;
    },
  } as Document;
  const containerEl = {
    doc: ownerDocument,
    ownerDocument,
    contains: (element: Element | null) => element === inside,
  } as HTMLElement;
  const chatLeaf = {
    view: {
      containerEl,
      getViewType: () => CHAT_AGENT_VIEWTYPE,
    },
  };
  const otherLeaf = {
    view: {
      containerEl: { ownerDocument } as HTMLElement,
      getViewType: () => "markdown",
    },
  };
  return {
    getMostRecentLeaf: jest.fn(() => {
      if (mockAgentChatFocus === "none") return null;
      if (["inside-sidebar", "other-leaf"].includes(mockAgentChatFocus)) return otherLeaf;
      return chatLeaf;
    }),
    getLeavesOfType: jest.fn((viewType: string) =>
      viewType === CHAT_AGENT_VIEWTYPE ? [chatLeaf] : []
    ),
    getActiveFile: jest.fn(() => null),
  };
}

function buildApp(basePath = "/vault"): App {
  const adapter = new (FileSystemAdapter as unknown as new (basePath: string) => unknown)(basePath);
  const events = {
    on: jest.fn(() => ({}) as never),
    offref: jest.fn(),
  };
  const vaultFiles = {
    getAbstractFileByPath: jest.fn(() => null),
    getFiles: jest.fn(() => []),
    create: jest.fn(),
    read: jest.fn(async () => ""),
    modify: jest.fn(),
  };
  return {
    vault: { adapter, ...events, ...vaultFiles },
    metadataCache: { ...events },
    workspace: buildWorkspace(),
  } as unknown as App;
}

function buildPlugin(): { manifest: { version: string } } {
  return { manifest: { version: "1.0.0" } };
}

function buildDescriptor(): BackendDescriptor {
  return {
    id: "opencode",
    displayName: "opencode",
    summarizesSessionTitle: true,
    getInstallState: jest.fn(() => ({ kind: "ready" })),
    subscribeInstallState: jest.fn(),
    openInstallUI: jest.fn(),
    createBackendProcess: jest.fn(() => makeMockBackendProcess()),
  } as unknown as BackendDescriptor;
}

function modelCatalog(baseModelId: string): BackendModelCatalog {
  return {
    availableModels: [{ baseModelId, name: baseModelId, provider: null, effortOptions: [] }],
  };
}

function show(mgr: AgentSessionManager, session: AgentSession): void {
  mgr["view"].activate({ id: session.internalId, projectId: session.projectId });
}

async function createShown(
  mgr: AgentSessionManager,
  ...args: Parameters<AgentSessionManager["createSession"]>
): Promise<AgentSession> {
  const session = await mgr.createSession(...args);
  show(mgr, session);
  return session;
}

function buildManager(
  modelPreloaderOverrides: Partial<AgentModelPreloader> = {},
  persistenceManager?: ConstructorParameters<typeof AgentSessionManager>[2]["persistenceManager"],
  app = buildApp()
): AgentSessionManager {
  const descriptor = buildDescriptor();
  const modelPreloader = {
    getCachedModelCatalog: jest.fn(() => null),
    getEffortCatalog: jest.fn(() => null),
    preload: jest.fn(async () => undefined),
    refresh: jest.fn(() => null),
    subscribe: jest.fn(() => () => {}),
    shutdown: jest.fn(),
    clearCached: jest.fn(),
    takeWarm: jest.fn(() => null),
    getWarmProcs: jest.fn(() => []),
    ...modelPreloaderOverrides,
  };
  return new AgentSessionManager(
    app,
    buildPlugin() as unknown as ConstructorParameters<typeof AgentSessionManager>[1],
    {
      persistenceManager,
      permissionPrompter: jest.fn(),
      resolveDescriptor: (id) => (id === descriptor.id ? descriptor : undefined),
      modelPreloader: modelPreloader as unknown as ConstructorParameters<
        typeof AgentSessionManager
      >[2]["modelPreloader"],
    }
  );
}

beforeEach(() => {
  mockBackendIsRunning = true;
  mockNotificationSound = true;
  mockAgentChatFocus = "none";
  (playNotificationSound as jest.Mock).mockClear();
  mockBackendStart.mockClear();
  mockBackendShutdown.mockClear();
  mockSetPermissionPrompter.mockClear();
  mockUnhealthyHandler = null;
  mockBackendExitListeners.clear();
  mockSessionCancel.mockClear();
  mockSessionDispose.mockClear();
  sessionCreateSpy.mockClear();
  nextBackendSessionId = 1;
  settingsChangeCallbacks.clear();
});

function setupSavedNoteTests() {
  let originalSettings: ReturnType<jest.Mock["getMockImplementation"]>;
  beforeEach(() => {
    originalSettings = (mockedGetSettings as jest.Mock).getMockImplementation();
    jest.useFakeTimers();
    (mockedGetSettings as jest.Mock).mockReturnValue({
      ...mockedGetSettings(),
      autosaveChat: false,
    });
  });
  afterEach(() => {
    (mockedGetSettings as jest.Mock).mockImplementation(originalSettings);
    jest.useRealTimers();
  });
}

function savedNoteFixture() {
  const saveSession = jest.fn(async () => ({ path: "chats/saved.md" }));
  const mgr = buildManager({}, { saveSession } as unknown as ConstructorParameters<
    typeof AgentSessionManager
  >[2]["persistenceManager"]);
  return { mgr, saveSession };
}

describe("AgentSessionManager", () => {
  describe("AgentSessionManager", () => {
    describe("getOpenChatIds()", () => {
      it("includes idle and running conversations and removes released sessions for https://github.com/Brevilabs/obsidian-copilot-private/issues/429", async () => {
        const mgr = buildManager();
        const empty = mgr.getOpenChatIds();
        expect(mgr.getOpenChatIds()).toBe(empty);
        const idle = await createShown(mgr);
        const running = await createShown(mgr);
        getSessionTestHandle(running).setStatus("running");
        const idleId = buildNativeChatId(idle.backendId, idle.getBackendSessionId()!);
        const runningId = buildNativeChatId(running.backendId, running.getBackendSessionId()!);
        expect(mgr.getOpenChatIds()).toEqual(new Set([idleId, runningId]));
        await mgr.closeChatSession(idleId);
        expect(mgr.getOpenChatIds()).toEqual(new Set([runningId]));
      });
    });

    describe("detachSessionFromTab()", () => {
      it("keeps the backend session open and discoverable in history for https://github.com/Brevilabs/obsidian-copilot-private/issues/429", async () => {
        const mgr = buildManager();
        const session = await createShown(mgr);
        const historyId = buildNativeChatId(session.backendId, session.getBackendSessionId()!);
        const proc = mgr.getBackendProcess(session.backendId)!;

        mgr.detachSessionFromTab(session.internalId);

        expect(mgr.getSessionsForScope(session.projectId)).not.toContain(session);
        expect(mgr.getSessions()).toContain(session);
        expect(mgr.getOpenChatIds()).toContain(historyId);
        expect(proc.closeSession).not.toHaveBeenCalled();
        expect(mockSessionCancel).not.toHaveBeenCalled();
        expect(mockSessionDispose).not.toHaveBeenCalled();
      });
    });

    describe("getTabSessions()", () => {
      it("lists attached sessions in creation order and omits a session detached from its tab", async () => {
        const mgr = buildManager();
        const first = await createShown(mgr);
        const second = await createShown(mgr);
        expect(mgr.getTabSessions()).toEqual([first, second]);

        mgr.detachSessionFromTab(first.internalId);

        expect(mgr.getTabSessions()).toEqual([second]);
        expect(mgr.getSessions()).toContain(first);
      });
    });

    describe("closeChatSession()", () => {
      it("closes by saved or stale native identity and retains the saved transcript for https://github.com/Brevilabs/obsidian-copilot-private/issues/429", async () => {
        for (const useNativeId of [false, true]) {
          const saved = new Map<string, unknown>();
          const persistence = {
            saveSession: jest.fn(async (messages: unknown) => {
              saved.set("chats/research.md", messages);
              return { path: "chats/research.md" };
            }),
          };
          const mgr = buildManager(
            {},
            persistence as unknown as ConstructorParameters<
              typeof AgentSessionManager
            >[2]["persistenceManager"]
          );
          const session = await createShown(mgr);
          getSessionTestHandle(session).setMessages([{ message: "Initial answer" }]);
          await mgr.saveActiveSession();
          const nativeId = buildNativeChatId(session.backendId, session.getBackendSessionId()!);
          expect(mgr.getOpenChatIds()).toEqual(new Set([nativeId, "chats/research.md"]));
          await mgr.closeChatSession(useNativeId ? nativeId : "chats/research.md");
          expect(saved.get("chats/research.md")).toEqual([{ message: "Initial answer" }]);
          expect(mgr.getOpenChatIds().size).toBe(0);
          expect(mgr.getSessions()).toEqual([]);
        }
      });

      it("releases only the selected backend session while preserving another active chat for https://github.com/Brevilabs/obsidian-copilot-private/issues/429", async () => {
        const mgr = buildManager();
        const selected = await createShown(mgr);
        const sibling = await createShown(mgr);
        const proc = mgr.getBackendProcess(selected.backendId)!;
        const id = buildNativeChatId(selected.backendId, selected.getBackendSessionId()!);
        await mgr.closeChatSession(id);
        expect(proc.closeSession).toHaveBeenCalledWith({
          sessionId: selected.getBackendSessionId(),
        });
        expect(mgr.getSessions()).toEqual([sibling]);
        expect(mgr.getActiveSession()).toBe(sibling);
        expect(proc.shutdown).not.toHaveBeenCalled();
      });
    });

    describe("noteSpawnConfigChanged()", () => {
      it("keeps an open session alive and holds the restart for the user (https://github.com/Brevilabs/obsidian-copilot-private/issues/475)", async () => {
        const mgr = buildManager();
        const session = await createShown(mgr);

        await mgr.noteSpawnConfigChanged("opencode", "managed skills changed");

        expect(mockBackendShutdown).not.toHaveBeenCalled();
        expect(mgr.getActiveSession()).toBe(session);
        expect(mgr.hasHeldConfigChange("opencode")).toBe(true);
      });

      it("restarts straight away when no session is open on the backend (https://github.com/Brevilabs/obsidian-copilot-private/issues/475)", async () => {
        const mgr = buildManager();
        const session = await createShown(mgr);
        await mgr.closeSession(session.internalId);

        await mgr.noteSpawnConfigChanged("opencode", "byok key saved");

        expect(mockBackendShutdown).toHaveBeenCalledTimes(1);
        expect(mgr.hasHeldConfigChange("opencode")).toBe(false);
      });

      it("refreshes a warm probe that no session has adopted (https://github.com/Brevilabs/obsidian-copilot-private/issues/475)", async () => {
        const refresh = jest.fn(() => Promise.resolve());
        const mgr = buildManager({ refresh });

        await mgr.noteSpawnConfigChanged("opencode", "byok key saved");

        expect(refresh).toHaveBeenCalledWith("opencode");
        expect(mgr.hasHeldConfigChange("opencode")).toBe(false);
      });

      it("reports one held change however many times config changes (https://github.com/Brevilabs/obsidian-copilot-private/issues/475)", async () => {
        const mgr = buildManager();
        await createShown(mgr);
        const listener = jest.fn();
        mgr.subscribe(listener);

        await mgr.noteSpawnConfigChanged("opencode", "managed skills changed");
        await mgr.noteSpawnConfigChanged("opencode", "provider config changed");

        expect(listener).toHaveBeenCalledTimes(1);
        expect(mgr.hasHeldConfigChange("opencode")).toBe(true);
      });

      it("leaves a privacy-boundary restart free to run immediately (https://github.com/Brevilabs/obsidian-copilot-private/issues/475)", async () => {
        const mgr = buildManager();
        await createShown(mgr);

        await mgr.noteSpawnConfigChanged("opencode", "managed skills changed");
        await mgr.restartBackend("opencode", "Miyo Search scope changed", {
          deferWhileBusy: false,
        });

        expect(mockBackendShutdown).toHaveBeenCalledTimes(1);
        expect(mgr.hasHeldConfigChange("opencode")).toBe(false);
      });
    });

    describe("applyHeldConfigChange()", () => {
      it("restarts the backend and clears the offer (https://github.com/Brevilabs/obsidian-copilot-private/issues/475)", async () => {
        const mgr = buildManager();
        const first = await createShown(mgr);
        await mgr.noteSpawnConfigChanged("opencode", "managed skills changed");

        await mgr.applyHeldConfigChange("opencode");

        expect(mockBackendShutdown).toHaveBeenCalledTimes(1);
        expect(mgr.getActiveSession()).not.toBe(first);
        expect(mgr.getActiveSession()?.backendId).toBe("opencode");
        expect(mgr.hasHeldConfigChange("opencode")).toBe(false);
      });

      it("replaces an errored session with corrected configuration (https://github.com/Brevilabs/obsidian-copilot-private/issues/475)", async () => {
        sessionCreateSpy.mockImplementationOnce((opts) =>
          makeMockSession({
            ...opts,
            ready: Promise.reject(new Error("Invalid API key")),
          })
        );
        const mgr = buildManager();
        const failed = await createShown(mgr);
        getSessionTestHandle(failed).setStatus("error");
        await new Promise((resolve) => window.setTimeout(resolve, 0));
        expect(mgr.getLastError()).toContain("Invalid API key");
        await mgr.noteSpawnConfigChanged("opencode", "key corrected");
        await mgr.applyHeldConfigChange("opencode");
        await new Promise((resolve) => window.setTimeout(resolve, 0));
        expect(mgr.getActiveSession()).not.toBe(failed);
        expect(mgr.getActiveSession()?.getStatus()).toBe("idle");
        expect(mgr.getLastError()).toBeNull();
      });

      it("preserves composers across scopes without surfacing detached conversations (https://github.com/Brevilabs/obsidian-copilot-private/issues/475)", async () => {
        const projectId = "project-with-drafts";
        const recordSpy = jest
          .spyOn(projectsState, "getCachedProjectRecordById")
          .mockImplementation((id) =>
            id === projectId
              ? ({
                  filePath: "Projects/work/project.md",
                  project: { id: projectId },
                } as unknown as ReturnType<typeof projectsState.getCachedProjectRecordById>)
              : undefined
          );
        try {
          const mgr = buildManager();
          await mgr.enterProject(projectId);
          const old = mgr.getActiveSession()!;
          getSessionTestHandle(old).setHasUserVisibleMessages(true);
          await mgr.exitProject();
          const global = mgr.getActiveSession()!;
          await mgr.enterProject(projectId);
          const landing = mgr.getActiveSession()!;
          await mgr.noteSpawnConfigChanged("opencode", "models changed");
          await mgr.applyHeldConfigChange("opencode");
          expect(new Set(mgr.getLiveChatInputIds())).toEqual(
            new Set([old.chatInputId, global.chatInputId, landing.chatInputId])
          );
          expect(mgr.getSessionsForScope(projectId).map((s) => s.chatInputId)).toEqual([
            landing.chatInputId,
          ]);
          expect(mgr.getActiveSession()?.chatInputId).toBe(landing.chatInputId);
          expect(mgr.getActiveProjectId()).toBe(projectId);
        } finally {
          recordSpy.mockRestore();
        }
      });

      it("clears the held config after a backend exit so retry does not offer another reload (https://github.com/Brevilabs/obsidian-copilot-private/issues/475)", async () => {
        const mgr = buildManager();
        await createShown(mgr);
        await mgr.noteSpawnConfigChanged("opencode", "key corrected");
        for (const exit of mockBackendExitListeners) exit();
        expect(mgr.hasHeldConfigChange("opencode")).toBe(false);
        const recovered = await mgr.getOrCreateActiveSession();
        await mgr.applyHeldConfigChange("opencode");
        expect(mgr.getActiveSession()).toBe(recovered);
        expect(mockBackendShutdown).not.toHaveBeenCalled();
      });

      it("keeps every tab's composer live throughout reload and restores the selected tab (https://github.com/Brevilabs/obsidian-copilot-private/issues/475)", async () => {
        const mgr = buildManager();
        const first = await createShown(mgr);
        const second = await createShown(mgr);
        show(mgr, first);
        const ids = [first.chatInputId, second.chatInputId];
        const drafts = new Map([
          [first.chatInputId, "First unsent draft"],
          [second.chatInputId, "Second unsent draft"],
        ]);
        mgr.subscribe(() => {
          const live = new Set(mgr.getLiveChatInputIds());
          for (const id of drafts.keys()) if (!live.has(id)) drafts.delete(id);
        });
        await mgr.noteSpawnConfigChanged("opencode", "key corrected");
        await mgr.applyHeldConfigChange("opencode");
        expect([...drafts.values()]).toEqual(["First unsent draft", "Second unsent draft"]);
        expect(mgr.getSessions().map((s) => s.chatInputId)).toEqual(ids);
        expect(mgr.getActiveSession()?.chatInputId).toBe(first.chatInputId);
      });

      it("does nothing when the backend has no held change (https://github.com/Brevilabs/obsidian-copilot-private/issues/475)", async () => {
        const mgr = buildManager();
        await createShown(mgr);

        await mgr.applyHeldConfigChange("opencode");

        expect(mockBackendShutdown).not.toHaveBeenCalled();
      });

      it("reports the restart as pending until a running turn releases it (https://github.com/Brevilabs/obsidian-copilot-private/issues/475)", async () => {
        const mgr = buildManager();
        const first = await createShown(mgr);
        await mgr.noteSpawnConfigChanged("opencode", "managed skills changed");
        getSessionTestHandle(first).setStatus("running");
        const listener = jest.fn();
        mgr.subscribe(listener);

        await mgr.applyHeldConfigChange("opencode");

        expect(mockBackendShutdown).not.toHaveBeenCalled();
        expect(mgr.isBackendRestartPending("opencode")).toBe(true);
        expect(listener).toHaveBeenCalled();

        getSessionTestHandle(first).setStatus("idle");
        await new Promise((resolve) => window.setTimeout(resolve, 0));

        expect(mockBackendShutdown).toHaveBeenCalledTimes(1);
        expect(mgr.isBackendRestartPending("opencode")).toBe(false);
        expect(mgr.hasHeldConfigChange("opencode")).toBe(false);
      });
    });

    describe("createSession()", () => {
      it.each([false, true])(
        "waits for the startup upgrade and respects shutdown=%s before launching (https://github.com/Brevilabs/obsidian-copilot-private/issues/530)",
        async (shutdown) => {
          let finish!: () => void;
          const upgrade = new Promise<void>((resolve) => {
            finish = resolve;
          });
          const beforeBackendStart = jest.fn(() => upgrade);
          const descriptor = buildDescriptor();
          const mgr = new AgentSessionManager(buildApp(), buildPlugin() as never, {
            permissionPrompter: jest.fn(),
            resolveDescriptor: () => descriptor,
            modelPreloader: {
              takeWarm: jest.fn(() => null),
              shutdown: jest.fn(),
            } as unknown as AgentModelPreloader,
            beforeBackendStart,
          });
          const creating = mgr.createSession();
          await waitFor(() => expect(beforeBackendStart).toHaveBeenCalled());
          expect(mockBackendStart).not.toHaveBeenCalled();
          if (shutdown) await mgr.shutdown();
          finish();
          if (shutdown) await expect(creating).rejects.toThrow("shut down");
          else {
            await creating;
            expect(mockBackendStart).toHaveBeenCalledTimes(1);
          }
        }
      );

      it("keeps a validated running process usable when another installation is selected (https://github.com/Brevilabs/obsidian-copilot-private/issues/531)", async () => {
        const descriptor = buildDescriptor();
        const mgr = new AgentSessionManager(buildApp(), buildPlugin() as never, {
          permissionPrompter: jest.fn(),
          resolveDescriptor: () => descriptor,
          modelPreloader: { takeWarm: jest.fn(() => null) } as unknown as AgentModelPreloader,
        });
        await createShown(mgr);
        (descriptor.getInstallState as jest.Mock).mockReturnValue({
          kind: "incompatible",
          message: "Upgrade required",
        });
        await expect(mgr.createSession()).resolves.toBeDefined();
        expect(mockBackendStart).toHaveBeenCalledTimes(1);
      });
      it("rejects an unsupported installation before starting its process (https://github.com/Brevilabs/obsidian-copilot-private/issues/531)", async () => {
        const descriptor = buildDescriptor();
        (descriptor.getInstallState as jest.Mock).mockReturnValue({
          kind: "incompatible",
          message: "Upgrade required",
        });
        const mgr = new AgentSessionManager(buildApp(), buildPlugin() as never, {
          permissionPrompter: jest.fn(),
          resolveDescriptor: () => descriptor,
          modelPreloader: { takeWarm: jest.fn(() => null) } as unknown as AgentModelPreloader,
        });
        await expect(mgr.createSession()).rejects.toThrow("Upgrade required");
        expect(mockBackendStart).not.toHaveBeenCalled();
      });
      it("creates a session and sets it as the active one", async () => {
        const mgr = buildManager();
        const session = await createShown(mgr);
        expect(mgr.getSessions()).toEqual([session]);
        expect(mgr.getActiveSession()).toBe(session);
      });

      it("creating a second session sets it as active but keeps the first in the pool", async () => {
        const mgr = buildManager();
        const a = await createShown(mgr);
        const b = await createShown(mgr);
        expect(mgr.getSessions()).toEqual([a, b]);
        expect(mgr.getActiveSession()).toBe(b);
      });

      it("two concurrent createSession calls each spawn their own session", async () => {
        const mgr = buildManager();
        const [a, b] = await Promise.all([mgr.createSession(), mgr.createSession()]);
        expect(a).not.toBe(b);
        expect(sessionCreateSpy).toHaveBeenCalledTimes(2);
        expect(mgr.getSessions()).toHaveLength(2);
      });

      it("only spawns the backend once across multiple createSession calls", async () => {
        const mgr = buildManager();
        await createShown(mgr);
        await createShown(mgr);
        await createShown(mgr);
        expect(mockBackendStart).toHaveBeenCalledTimes(1);
      });

      it("leaves the seed unset when a catalog exists but no explicit default is stored", async () => {
        const mgr = buildManager({
          getCachedModelCatalog: jest.fn(() => modelCatalog("catalog-first")),
        });

        await createShown(mgr);
        expect(sessionCreateSpy).toHaveBeenCalledWith(
          expect.objectContaining({ defaultModelSelection: undefined })
        );
      });

      it("leaves the seed unset when no default is stored and no catalog is probed", async () => {
        const mgr = buildManager();
        await createShown(mgr);
        expect(sessionCreateSpy).toHaveBeenCalledWith(
          expect.objectContaining({ defaultModelSelection: undefined })
        );
      });

      it("a concurrent create that succeeds does not wipe a sibling create's lastError", async () => {
        const mgr = buildManager();
        sessionCreateSpy
          .mockImplementationOnce((opts) =>
            makeMockSession({
              internalId: opts.internalId,
              backendId: opts.backendId,
              ready: (async () => {
                await Promise.resolve();
                await Promise.resolve();
                throw new Error("boom");
              })(),
            })
          )
          .mockImplementationOnce((opts) =>
            makeMockSession({
              internalId: opts.internalId,
              backendSessionId: "backend-ok",
              backendId: opts.backendId,
            })
          );

        const failingSession = await createShown(mgr);
        const succeedingSession = await createShown(mgr);
        await failingSession.ready.catch(() => undefined);
        await succeedingSession.ready;
        await Promise.resolve();
        for (let i = 0; i < 10; i++) await Promise.resolve();

        expect(mgr.getLastError()).toMatch(/boom/);
      });
    });

    describe("createGlobalSessionWithDraft()", () => {
      it("writes the unsent text into the new chat's own draft for https://github.com/Brevilabs/obsidian-copilot-private/issues/166", async () => {
        const mgr = buildManager();

        const session = await mgr.createGlobalSessionWithDraft("Review this repair");

        expect(mgr.getActiveSession()).toBe(session);
        expect(mgr.drafts.get(session.chatInputId)?.input).toBe("Review this repair");
      });

      it("switches directly to the requested scope without spawning an extra blank session for https://github.com/Brevilabs/obsidian-copilot-private/issues/166", async () => {
        const projectId = "project-with-no-global-session";
        const recordSpy = jest
          .spyOn(projectsState, "getCachedProjectRecordById")
          .mockImplementation((id: string) =>
            id === projectId
              ? ({
                  filePath: "Projects/project-with-no-global-session/project.md",
                  project: { id: projectId },
                } as unknown as ReturnType<typeof projectsState.getCachedProjectRecordById>)
              : undefined
          );
        try {
          const mgr = buildManager();
          await mgr.createSession(undefined, projectId);

          const session = await mgr.createGlobalSessionWithDraft("Review this repair");

          expect(mgr.getSessions()).toHaveLength(2);
          expect(
            mgr.getSessions().filter((candidate) => candidate.projectId === GLOBAL_SCOPE)
          ).toEqual([session]);
          expect(mgr.getActiveSession()).toBe(session);
        } finally {
          recordSpy.mockRestore();
        }
      });

      it("drops the drafted text when its session closes for https://github.com/Brevilabs/obsidian-copilot-private/issues/166", async () => {
        const mgr = buildManager();
        const session = await mgr.createGlobalSessionWithDraft("Review this repair");

        await mgr.closeSession(session.internalId);

        expect(mgr.drafts.get(session.chatInputId)).toBeUndefined();
      });

      it("leaves no draft behind when session creation fails for https://github.com/Brevilabs/obsidian-copilot-private/issues/166", async () => {
        const projectId = "project-before-failed-draft";
        const recordSpy = jest
          .spyOn(projectsState, "getCachedProjectRecordById")
          .mockImplementation((id: string) =>
            id === projectId
              ? ({
                  filePath: "Projects/project-before-failed-draft/project.md",
                  project: { id: projectId },
                } as unknown as ReturnType<typeof projectsState.getCachedProjectRecordById>)
              : undefined
          );
        try {
          const mgr = buildManager();
          await mgr.enterProject(projectId);
          const previousSession = mgr.getActiveSession();
          expect(previousSession).not.toBeNull();
          let failedChatInputId: string | undefined;
          sessionCreateSpy.mockImplementationOnce((opts) => {
            failedChatInputId = opts.chatInputId;
            throw new Error("session creation failed");
          });

          await expect(mgr.createGlobalSessionWithDraft("Review this repair")).rejects.toThrow(
            "session creation failed"
          );

          expect(failedChatInputId).toBeDefined();
          expect(mgr.drafts.get(failedChatInputId as string)).toBeUndefined();
          expect(mgr.getActiveSession()).toBe(previousSession);
        } finally {
          recordSpy.mockRestore();
        }
      });

      it("does not roll back across newer ABA scope navigation for https://github.com/Brevilabs/obsidian-copilot-private/issues/166", async () => {
        const recordSpy = jest
          .spyOn(projectsState, "getCachedProjectRecordById")
          .mockImplementation((id: string) =>
            ["project-a", "project-b"].includes(id)
              ? ({
                  filePath: `Projects/${id}/project.md`,
                  project: { id },
                } as unknown as ReturnType<typeof projectsState.getCachedProjectRecordById>)
              : undefined
          );
        try {
          const mgr = buildManager();
          const globalSession = await mgr.createSession(undefined, GLOBAL_SCOPE);
          const projectBSession = await mgr.createSession(undefined, "project-b");
          const projectASession = await mgr.createSession(undefined, "project-a");
          show(mgr, projectASession);

          let releaseInstructionEnsure: (() => void) | undefined;
          ensureAgentsFileForDiscoverySpy.mockImplementationOnce(
            () =>
              new Promise<void>((resolve) => {
                releaseInstructionEnsure = resolve;
              })
          );
          sessionCreateSpy.mockImplementationOnce(() => {
            throw new Error("session creation failed");
          });

          const pendingDraft = mgr.createGlobalSessionWithDraft("Review this repair");
          await waitFor(() => expect(releaseInstructionEnsure).toBeDefined());
          show(mgr, projectBSession);
          show(mgr, globalSession);
          releaseInstructionEnsure?.();

          await expect(pendingDraft).rejects.toThrow("session creation failed");
          expect(mgr.getActiveProjectId()).toBe(GLOBAL_SCOPE);
          expect(mgr.getActiveSession()).toBe(globalSession);
        } finally {
          recordSpy.mockRestore();
        }
      });
    });

    describe("addContextNoteToActiveChat()", () => {
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/579 attaches the note to the active chat's draft", async () => {
        const mgr = buildManager();
        const session = await createShown(mgr);
        const note = mockTFile({ path: "Research.md" });

        await mgr.addContextNoteToActiveChat(note);

        expect(mgr.drafts.get(session.chatInputId)?.contextNotes).toEqual([note]);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/579 starts the first chat when none exists so the note has a draft to land in", async () => {
        const mgr = buildManager();
        const note = mockTFile({ path: "Research.md" });

        await mgr.addContextNoteToActiveChat(note);

        const session = mgr.getActiveSession();
        expect(mgr.getSessions()).toEqual([session]);
        expect(mgr.drafts.get(session!.chatInputId)?.contextNotes).toEqual([note]);
      });
    });

    describe("closeSession()", () => {
      setupSavedNoteTests();
      it("never writes an unsaved chat with autosave off for https://github.com/logancyang/obsidian-copilot/issues/3225", async () => {
        const { mgr, saveSession } = savedNoteFixture();
        const session = await createShown(mgr);
        getSessionTestHandle(session).setMessages([{ message: "Unsaved turn" }], true);
        await jest.advanceTimersByTimeAsync(2000);
        await mgr.closeSession(session.internalId);
        expect(saveSession).not.toHaveBeenCalled();
        await mgr.shutdown();
      });
    });

    describe("replaceSessionInPlace()", () => {
      setupSavedNoteTests();
      it("updates the manually saved file and drains later turns on New Chat with autosave off for https://github.com/logancyang/obsidian-copilot/issues/3225", async () => {
        const { mgr, saveSession } = savedNoteFixture();
        const session = await createShown(mgr);
        const handle = getSessionTestHandle(session);
        const first = [
          { message: "Image question\n\n![](/image.png)" },
          { message: "Image answer" },
        ];
        handle.setMessages(first, true);
        await mgr.saveActiveSession();
        const later = [...first, { message: "Later question" }, { message: "Later answer" }];
        handle.setMessages(later, true);
        await jest.advanceTimersByTimeAsync(2000);
        expect(saveSession).toHaveBeenCalledTimes(2);
        expect(saveSession).toHaveBeenLastCalledWith(
          later,
          session.backendId,
          expect.objectContaining({ existingPath: "chats/saved.md" })
        );
        const final = [...later, { message: "Final question" }, { message: "Final answer" }];
        handle.setMessages(final, true);
        await mgr.replaceSessionInPlace(session.internalId);
        await jest.advanceTimersByTimeAsync(0);
        expect(saveSession).toHaveBeenCalledTimes(3);
        expect(saveSession).toHaveBeenLastCalledWith(
          final,
          session.backendId,
          expect.objectContaining({ existingPath: "chats/saved.md" })
        );
        await mgr.shutdown();
      });
    });

    describe("getSeedSelection()", () => {
      function buildManagerWithOffered(
        offered:
          | readonly (string | { baseModelId: string; credentialState: "ok" | "missing_key" })[]
          | undefined,
        saved: { baseModelId: string; effort: string | null } | null
      ): AgentSessionManager {
        const descriptor = {
          ...buildDescriptor(),
          ...(offered
            ? {
                getEnabledModelEntries: () =>
                  offered.map((entry) =>
                    typeof entry === "string"
                      ? { baseModelId: entry, name: entry, credentialState: "ok" }
                      : { ...entry, name: entry.baseModelId }
                  ),
              }
            : {}),
        } as unknown as BackendDescriptor;
        (mockedGetSettings as jest.Mock).mockReturnValue({
          agentMode: {
            activeBackend: "opencode",
            backends: { opencode: { defaultModel: saved } },
            notificationSound: false,
            notificationSoundId: "piano",
          },
        });
        return new AgentSessionManager(
          buildApp(),
          buildPlugin() as unknown as ConstructorParameters<typeof AgentSessionManager>[1],
          {
            permissionPrompter: jest.fn(),
            resolveDescriptor: (id) => (id === descriptor.id ? descriptor : undefined),
            modelPreloader: {
              getCachedModelCatalog: jest.fn(() => null),
              getEffortCatalog: jest.fn(() => null),
              preload: jest.fn(async () => undefined),
              refresh: jest.fn(() => null),
              subscribe: jest.fn(() => () => {}),
              shutdown: jest.fn(),
              clearCached: jest.fn(),
              takeWarm: jest.fn(() => null),
              getWarmProcs: jest.fn(() => []),
            } as unknown as ConstructorParameters<typeof AgentSessionManager>[2]["modelPreloader"],
          }
        );
      }

      function savedDefault(saved: { baseModelId: string; effort: string | null } | null): void {
        (mockedGetSettings as jest.Mock).mockReturnValue({
          agentMode: {
            activeBackend: "opencode",
            backends: { opencode: { defaultModel: saved } },
            notificationSound: false,
            notificationSoundId: "piano",
          },
        });
      }

      let originalGetSettings: (() => unknown) | undefined;

      beforeEach(() => {
        originalGetSettings = (mockedGetSettings as jest.Mock).getMockImplementation();
      });

      afterEach(() => {
        (Notice as unknown as jest.Mock).mockClear();
        (mockedGetSettings as jest.Mock).mockImplementation(originalGetSettings);
      });

      it("returns null when nothing has been saved", () => {
        expect(
          buildManagerWithOffered(["copilot-plus/flash"], null).getSeedSelection("opencode")
        ).toBeNull();
      });

      it("returns the saved selection while its model is still offered", () => {
        const saved = { baseModelId: "copilot-plus/glm-5.2", effort: "high" };

        expect(
          buildManagerWithOffered(
            ["copilot-plus/flash", "copilot-plus/glm-5.2"],
            saved
          ).getSeedSelection("opencode")
        ).toEqual(saved);
      });

      it("seeds the first enabled model when the saved one is no longer offered, so no prompt goes to the agent's own fallback (https://github.com/Brevilabs/obsidian-copilot-private/issues/474)", () => {
        const mgr = buildManagerWithOffered(["copilot-plus/flash", "copilot-plus/glm-5.2"], {
          baseModelId: "copilot-plus/minimax-m2.7",
          effort: "high",
        });

        expect(mgr.getSeedSelection("opencode")).toEqual({
          baseModelId: "copilot-plus/flash",
          effort: null,
        });
      });

      it("skips an enabled model whose provider key is missing (https://github.com/Brevilabs/obsidian-copilot-private/issues/474)", () => {
        const mgr = buildManagerWithOffered(
          [{ baseModelId: "byok/gpt-5.6", credentialState: "missing_key" }, "copilot-plus/flash"],
          { baseModelId: "copilot-plus/minimax-m2.7", effort: null }
        );

        expect(mgr.getSeedSelection("opencode")).toEqual({
          baseModelId: "copilot-plus/flash",
          effort: null,
        });
      });

      it("returns null when every enabled model is missing its provider key (https://github.com/Brevilabs/obsidian-copilot-private/issues/474)", () => {
        const mgr = buildManagerWithOffered(
          [{ baseModelId: "byok/gpt-5.6", credentialState: "missing_key" }],
          { baseModelId: "copilot-plus/minimax-m2.7", effort: null }
        );

        expect(mgr.getSeedSelection("opencode")).toBeNull();
        expect((Notice as unknown as jest.Mock).mock.calls.at(-1)?.[0]).toContain(
          "Pick a model to make it your default again"
        );
      });

      it("names the model new chats fall back to (https://github.com/Brevilabs/obsidian-copilot-private/issues/474)", () => {
        const mgr = buildManagerWithOffered(["copilot-plus/flash"], {
          baseModelId: "copilot-plus/minimax-m2.7",
          effort: null,
        });

        mgr.getSeedSelection("opencode");

        expect((Notice as unknown as jest.Mock).mock.calls.at(-1)?.[0]).toContain(
          "copilot-plus/flash"
        );
      });

      it("names the withdrawn model once, not on every read (https://github.com/Brevilabs/obsidian-copilot-private/issues/474)", () => {
        const mgr = buildManagerWithOffered(["copilot-plus/flash"], {
          baseModelId: "copilot-plus/minimax-m2.7",
          effort: null,
        });

        mgr.getSeedSelection("opencode");
        mgr.getSeedSelection("opencode");

        expect(Notice).toHaveBeenCalledTimes(1);
        expect((Notice as unknown as jest.Mock).mock.calls[0][0]).toContain("minimax-m2.7");
      });

      it("names each withdrawn model, not just the first one a backend loses (https://github.com/Brevilabs/obsidian-copilot-private/issues/474)", () => {
        const mgr = buildManagerWithOffered(["copilot-plus/flash"], {
          baseModelId: "copilot-plus/model-a",
          effort: null,
        });
        mgr.getSeedSelection("opencode");
        expect((Notice as unknown as jest.Mock).mock.calls.at(-1)?.[0]).toContain("model-a");

        savedDefault({ baseModelId: "copilot-plus/model-b", effort: null });
        mgr.getSeedSelection("opencode");

        expect(Notice).toHaveBeenCalledTimes(2);
        expect((Notice as unknown as jest.Mock).mock.calls.at(-1)?.[0]).toContain("model-b");
      });

      it.each([
        ["an empty curated list", [] as string[]],
        ["a backend that publishes no list at all", undefined],
      ])(
        "keeps the saved selection given %s, because an agent-native model stays routable without curation (https://github.com/Brevilabs/obsidian-copilot-private/issues/474)",
        (_case, offered) => {
          const saved = { baseModelId: "copilot-plus/glm-5.2", effort: null };

          const mgr = buildManagerWithOffered(offered, saved);

          expect(mgr.getSeedSelection("opencode")).toEqual(saved);
          expect(Notice).not.toHaveBeenCalled();
        }
      );

      it("applies the saved selection again once its model is offered once more", () => {
        const saved = { baseModelId: "copilot-plus/glm-5.2", effort: null };
        expect(
          buildManagerWithOffered(["copilot-plus/flash"], saved).getSeedSelection("opencode")
        ).toEqual({ baseModelId: "copilot-plus/flash", effort: null });

        expect(
          buildManagerWithOffered(
            ["copilot-plus/flash", "copilot-plus/glm-5.2"],
            saved
          ).getSeedSelection("opencode")
        ).toEqual(saved);
      });

      it("leaves the saved preference on disk so settings can still clear it (https://github.com/Brevilabs/obsidian-copilot-private/issues/474)", () => {
        const saved = { baseModelId: "copilot-plus/minimax-m2.7", effort: null };
        const mgr = buildManagerWithOffered(["copilot-plus/flash"], saved);

        expect(mgr.getSeedSelection("opencode")).toEqual({
          baseModelId: "copilot-plus/flash",
          effort: null,
        });
        expect(mgr.getDefaultSelection("opencode")).toEqual(saved);
      });
    });

    describe("getSessionSourcePath()", () => {
      setupSavedNoteTests();
      it("keeps unsaved sessions independent of a saved session and follows its file rename https://github.com/Brevilabs/obsidian-copilot-private/issues/539", async () => {
        const file = mockTFile({ path: "chat/Conversation.md" });
        const app = buildApp();
        jest.mocked(app.vault.getAbstractFileByPath).mockReturnValue(file);
        const saveSession = jest.fn().mockResolvedValue({ path: file.path });
        const mgr = buildManager({}, { saveSession } as never, app);
        const first = await createShown(mgr);
        expect(mgr.getSessionSourcePath(first.internalId)).toBe("");
        getSessionTestHandle(first).setMessages([{ message: "Hello" }]);
        await waitFor(() => expect(mgr.getIsStarting()).toBe(false));
        const listener = jest.fn();
        mgr.subscribe(listener);
        await mgr.saveActiveSession();
        expect(listener).toHaveBeenCalledTimes(1);
        expect(mgr.getSessionSourcePath(first.internalId)).toBe(file.path);
        file.path = "archive/Conversation.md";
        expect(mgr.getSessionSourcePath(first.internalId)).toBe(file.path);
        expect(await mgr.saveActiveSession()).toEqual({ path: file.path });
        const second = await createShown(mgr);
        expect(mgr.getSessionSourcePath(second.internalId)).toBe("");
        show(mgr, first);
        getSessionTestHandle(first).setMessages([{ message: "Changed" }]);
        saveSession.mockResolvedValue(null);
        await mgr.saveActiveSession();
        expect(mgr.getSessionSourcePath(first.internalId)).toBe(file.path);
        expect(saveSession).toHaveBeenLastCalledWith(
          expect.anything(),
          first.backendId,
          expect.objectContaining({ existingPath: file.path })
        );
        await mgr.shutdown();
      });
      it("uses the loaded conversation file before any save https://github.com/Brevilabs/obsidian-copilot-private/issues/539", async () => {
        const file = mockTFile({ path: "chat/Loaded.md" });
        const loadFile = jest.fn().mockResolvedValue({
          backendId: "opencode",
          projectId: GLOBAL_SCOPE,
          messages: [{ message: "Loaded" }],
        });
        const mgr = buildManager({}, { loadFile } as never);
        const loaded = await mgr.loadSessionFromHistory(file);
        expect(mgr.getSessionSourcePath(loaded.internalId)).toBe(file.path);
        file.path = "archive/Loaded.md";
        expect(mgr.getSessionSourcePath(loaded.internalId)).toBe(file.path);
        await mgr.shutdown();
      });
    });

    describe("saveActiveSession()", () => {
      setupSavedNoteTests();
      it("persists changes during the first manual save for https://github.com/logancyang/obsidian-copilot/issues/3225", async () => {
        const { mgr, saveSession } = savedNoteFixture();
        let finishSave!: (result: { path: string }) => void;
        saveSession.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finishSave = resolve;
            })
        );
        const session = await createShown(mgr);
        const handle = getSessionTestHandle(session);
        handle.setMessages([{ message: "Question" }, { message: "Partial answer" }], true);
        const saving = mgr.saveActiveSession();
        await jest.advanceTimersByTimeAsync(0);
        expect(saveSession).toHaveBeenCalledTimes(1);
        const completed = [{ message: "Question" }, { message: "Completed answer" }];
        handle.setMessages(completed, true);
        finishSave({ path: "chats/saved.md" });
        await saving;
        await jest.advanceTimersByTimeAsync(2000);
        expect(saveSession).toHaveBeenCalledTimes(2);
        expect(saveSession).toHaveBeenLastCalledWith(
          completed,
          session.backendId,
          expect.objectContaining({ existingPath: "chats/saved.md" })
        );
        await mgr.shutdown();
      });
    });

    describe("scheduleAutoSave()", () => {
      setupSavedNoteTests();
      it("still creates notes automatically with autosave on for https://github.com/logancyang/obsidian-copilot/issues/3225", async () => {
        (mockedGetSettings as jest.Mock).mockReturnValue({
          ...mockedGetSettings(),
          autosaveChat: true,
        });
        const { mgr, saveSession } = savedNoteFixture();
        const session = await createShown(mgr);
        const messages = [{ message: "Automatically saved turn" }];
        getSessionTestHandle(session).setMessages(messages, true);
        await jest.advanceTimersByTimeAsync(2000);
        expect(saveSession).toHaveBeenCalledTimes(1);
        expect(saveSession).toHaveBeenCalledWith(
          messages,
          session.backendId,
          expect.objectContaining({ existingPath: undefined })
        );
        await mgr.shutdown();
      });
    });
  });
});

describe("AgentSessionManager warm-backend reuse", () => {
  const probeState = {
    model: {
      current: { baseModelId: "anthropic/sonnet", effort: null },
      availableModels: [
        { baseModelId: "anthropic/sonnet", name: "Sonnet", provider: null, effortOptions: [] },
      ],
    },
    mode: null,
  };

  function buildManagerWithWarm(warmProc: ReturnType<typeof makeMockBackendProcess>) {
    const descriptor = buildDescriptor();
    const takeWarmMock = jest.fn().mockReturnValueOnce({ proc: warmProc }).mockReturnValue(null);
    const modelPreloader = {
      getCachedModelCatalog: jest.fn(() => ({
        availableModels: probeState.model.availableModels,
      })),
      preload: jest.fn(async () => undefined),
      subscribe: jest.fn(() => () => {}),
      shutdown: jest.fn(),
      clearCached: jest.fn(),
      takeWarm: takeWarmMock,
    };
    const mgr = new AgentSessionManager(
      buildApp(),
      buildPlugin() as unknown as ConstructorParameters<typeof AgentSessionManager>[1],
      {
        permissionPrompter: jest.fn(),
        resolveDescriptor: (id) => (id === descriptor.id ? descriptor : undefined),
        modelPreloader: modelPreloader as unknown as ConstructorParameters<
          typeof AgentSessionManager
        >[2]["modelPreloader"],
      }
    );
    return { mgr, descriptor };
  }

  it("reuses the preloader's warm proc instead of spawning a fresh one", async () => {
    const warmProc = makeMockBackendProcess();
    const { mgr, descriptor } = buildManagerWithWarm(warmProc);

    await createShown(mgr);

    expect(mockBackendStart).not.toHaveBeenCalled();
    expect(descriptor.createBackendProcess).not.toHaveBeenCalled();
    expect(mgr.getActiveSession()).not.toBeNull();
    expect(mgr.getActiveSession()?.backendId).toBe("opencode");
  });

  it("starts a fresh session on the warm proc instead of adopting the probe session", async () => {
    const warmProc = makeMockBackendProcess();
    const { mgr } = buildManagerWithWarm(warmProc);

    await createShown(mgr);

    expect(sessionCreateSpy).toHaveBeenCalledTimes(1);
    const opts = sessionCreateSpy.mock.calls[0][0];
    expect(opts.backend).toBe(warmProc);
    expect(opts).not.toHaveProperty("backendSessionId");
  });

  it("waits for an in-flight preload and adopts its process instead of spawning a second one", async () => {
    let resolvePreload!: () => void;
    let preloadSettled = false;
    const preloadPromise = new Promise<void>((resolve) => {
      resolvePreload = resolve;
    });
    const warmProc = makeMockBackendProcess();
    const descriptor = buildDescriptor();
    const preloader = {
      getCachedModelCatalog: jest.fn(() => null),
      getEffortCatalog: jest.fn(() => null),
      preload: jest.fn(() => preloadPromise),
      refresh: jest.fn(() => null),
      subscribe: jest.fn(() => () => {}),
      shutdown: jest.fn(),
      clearCached: jest.fn(),
      takeWarm: jest.fn(() => (preloadSettled ? { proc: warmProc } : null)),
      getWarmProcs: jest.fn(() => []),
    };
    const mgr = new AgentSessionManager(
      buildApp(),
      buildPlugin() as unknown as ConstructorParameters<typeof AgentSessionManager>[1],
      {
        permissionPrompter: jest.fn(),
        resolveDescriptor: (id) => (id === descriptor.id ? descriptor : undefined),
        modelPreloader: preloader as unknown as ConstructorParameters<
          typeof AgentSessionManager
        >[2]["modelPreloader"],
      }
    );
    mgr.registerPreload("opencode", preloadPromise);

    const sessionPromise = mgr.createSession();
    await new Promise((r) => window.setTimeout(r, 0));

    expect(preloader.preload).toHaveBeenCalledWith("opencode");
    expect(descriptor.createBackendProcess).not.toHaveBeenCalled();

    preloadSettled = true;
    resolvePreload();
    await sessionPromise;

    expect(preloader.takeWarm).toHaveBeenCalledWith("opencode");
    expect(descriptor.createBackendProcess).not.toHaveBeenCalled();
    expect(mockBackendStart).not.toHaveBeenCalled();
  });

  it("falls back to a fresh spawn when no warm entry is available", async () => {
    const mgr = buildManager();
    await createShown(mgr);

    expect(mockBackendStart).toHaveBeenCalledTimes(1);
    expect(sessionCreateSpy).toHaveBeenCalledTimes(1);
  });
});

describe("AgentSessionManager preload status", () => {
  it("isPreloadReady reports per-backend; a missing entry is treated as ready", () => {
    const mgr = buildManager();
    expect(mgr.isPreloadReady("opencode")).toBe(true);
    expect(mgr.getPreloadStatus("opencode")).toBe("absent");
  });

  it("transitions pending → ready on promise resolution and ready → ready stays ready", async () => {
    const mgr = buildManager();
    let resolve!: () => void;
    const promise = new Promise<void>((res) => {
      resolve = res;
    });
    mgr.registerPreload("opencode", promise);
    expect(mgr.getPreloadStatus("opencode")).toBe("pending");
    expect(mgr.isPreloadReady("opencode")).toBe(false);
    resolve();
    await promise;
    await Promise.resolve();
    expect(mgr.getPreloadStatus("opencode")).toBe("ready");
    expect(mgr.isPreloadReady("opencode")).toBe(true);
  });

  it("transitions pending → error on promise rejection but still reports ready (chat unblocks)", async () => {
    const mgr = buildManager();
    const rejection = new Error("preload failed");
    mgr.registerPreload(
      "opencode",
      Promise.reject(rejection).catch((e) => {
        throw e;
      })
    );
    await new Promise((r) => window.setTimeout(r, 0));
    expect(mgr.getPreloadStatus("opencode")).toBe("error");
    expect(mgr.isPreloadReady("opencode")).toBe(true);
  });
});

describe("AgentSessionManager.getCachedModelCatalog", () => {
  it("returns probe-owned discovery", () => {
    const catalog = modelCatalog("catalog");
    const mgr = buildManager({
      getCachedModelCatalog: jest.fn(() => catalog),
    });

    expect(mgr.getCachedModelCatalog("opencode")).toBe(catalog);
  });
});

describe("AgentSessionManager.getModelCacheSignature", () => {
  it("is stable when shared discovery is unchanged", () => {
    const catalog = modelCatalog("catalog");
    const first = buildManager({
      getCachedModelCatalog: jest.fn(() => catalog),
    });
    const second = buildManager({
      getCachedModelCatalog: jest.fn(() => catalog),
    });

    expect(first.getModelCacheSignature("opencode")).toBe(
      second.getModelCacheSignature("opencode")
    );
  });

  it("changes when shared model discovery changes", () => {
    const first = buildManager({
      getCachedModelCatalog: jest.fn(() => modelCatalog("first-catalog")),
    });
    const second = buildManager({
      getCachedModelCatalog: jest.fn(() => modelCatalog("second-catalog")),
    });

    expect(first.getModelCacheSignature("opencode")).not.toBe(
      second.getModelCacheSignature("opencode")
    );
  });
});

describe("AgentSessionManager.getOrCreateActiveSession", () => {
  it("dedupes concurrent auto-spawn callers into a single session", async () => {
    const mgr = buildManager();
    const [a, b] = await Promise.all([
      mgr.getOrCreateActiveSession(),
      mgr.getOrCreateActiveSession(),
    ]);
    expect(a).toBe(b);
    expect(sessionCreateSpy).toHaveBeenCalledTimes(1);
    expect(mgr.getSessions()).toHaveLength(1);
  });

  it("returns the existing active session on subsequent calls", async () => {
    const mgr = buildManager();
    const a = await mgr.getOrCreateActiveSession();
    const again = await mgr.getOrCreateActiveSession();
    expect(again).toBe(a);
    expect(sessionCreateSpy).toHaveBeenCalledTimes(1);
  });

  it("shows the session it starts in the panel's view https://github.com/Brevilabs/obsidian-copilot-private/issues/612", async () => {
    const mgr = buildManager();
    const created = await mgr.getOrCreateActiveSession();
    expect(mgr.getActiveSession()).toBe(created);
  });
});

describe("AgentSessionManager view", () => {
  it("does not change the shown tab when a session is created, so a session another client asks for never moves the panel https://github.com/Brevilabs/obsidian-copilot-private/issues/612", async () => {
    const mgr = buildManager();
    const shown = await createShown(mgr);
    const other = await mgr.createSession();
    expect(mgr.getSessions()).toEqual([shown, other]);
    expect(mgr.getActiveSession()).toBe(shown);
  });

  it("notifies subscribers when the panel's view changes", async () => {
    const mgr = buildManager();
    const a = await createShown(mgr);
    const listener = jest.fn();
    mgr.subscribe(listener);
    mgr["view"].clearActive();
    expect(mgr.getActiveSession()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    show(mgr, a);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("reads the shown project scope from the injected view https://github.com/Brevilabs/obsidian-copilot-private/issues/612", () => {
    const view = new ClientView("project-x");
    const descriptor = buildDescriptor();
    const mgr = new AgentSessionManager(buildApp(), buildPlugin() as never, {
      view,
      permissionPrompter: jest.fn(),
      resolveDescriptor: () => descriptor,
      modelPreloader: {
        takeWarm: jest.fn(() => null),
        shutdown: jest.fn(),
      } as unknown as AgentModelPreloader,
    });
    expect(mgr.getActiveProjectId()).toBe("project-x");
  });
});

describe("AgentSessionManager.closeSession", () => {
  it("removes the session from the pool and cancels + disposes it", async () => {
    const mgr = buildManager();
    const a = await createShown(mgr);
    await mgr.closeSession(a.internalId);
    expect(mgr.getSessions()).toEqual([]);
    expect(mgr.getActiveSession()).toBeNull();
    expect(mockSessionCancel).toHaveBeenCalled();
    expect(mockSessionDispose).toHaveBeenCalled();
  });

  it("does not pick another tab when the shown session closes, since each client moves its own view https://github.com/Brevilabs/obsidian-copilot-private/issues/612", async () => {
    const mgr = buildManager();
    const a = await createShown(mgr);
    const b = await createShown(mgr);
    const c = await createShown(mgr);
    show(mgr, b);
    await mgr.closeSession(b.internalId);
    expect(mgr.getSessions()).toEqual([a, c]);
    expect(mgr.getActiveSession()).toBeNull();
    expect(mgr["view"].getActiveTabId()).toBe(b.internalId);
  });

  it("closing a non-active session leaves the active pointer alone", async () => {
    const mgr = buildManager();
    const a = await createShown(mgr);
    const b = await createShown(mgr);
    await mgr.closeSession(a.internalId);
    expect(mgr.getActiveSession()).toBe(b);
    expect(mgr.getSessions()).toEqual([b]);
  });

  it("is a no-op for unknown ids", async () => {
    const mgr = buildManager();
    await mgr.closeSession("does-not-exist");
    expect(mgr.getSessions()).toEqual([]);
  });
});

describe("AgentSessionManager.openTab", () => {
  it("puts a detached session back in the tab set without selecting it https://github.com/Brevilabs/obsidian-copilot-private/issues/612", async () => {
    const mgr = buildManager();
    const a = await createShown(mgr);
    const b = await createShown(mgr);
    mgr.detachSessionFromTab(a.internalId);
    expect(mgr.getTabSessions()).toEqual([b]);

    mgr.openTab(a.internalId);

    expect(mgr.getTabSessions()).toEqual([a, b]);
    expect(mgr.getActiveSession()).toBe(b);
  });

  it("does not notify for an id that is unknown or already in the tab set", async () => {
    const mgr = buildManager();
    const a = await createShown(mgr);
    const listener = jest.fn();
    mgr.subscribe(listener);

    mgr.openTab("nope");
    mgr.openTab(a.internalId);

    expect(listener).not.toHaveBeenCalled();
  });
});

describe("AgentSessionManager.restartBackend", () => {
  it("returns false when the backend has not been started", async () => {
    const mgr = buildManager();

    await expect(mgr.restartBackend("opencode", "skills changed")).resolves.toBe(false);
    expect(mockBackendShutdown).not.toHaveBeenCalled();
  });

  it("refreshes a warm preload probe when the manager owns no process yet", async () => {
    const refresh = jest.fn(() => Promise.resolve());
    const modelPreloader = {
      getCachedModelCatalog: jest.fn(() => null),
      preload: jest.fn(async () => undefined),
      refresh,
      subscribe: jest.fn(() => () => {}),
      shutdown: jest.fn(),
      clearCached: jest.fn(),
      takeWarm: jest.fn(() => null),
      getWarmProcs: jest.fn(() => []),
    };
    const descriptor = {
      ...buildDescriptor(),
      getInstallState: jest.fn(() => ({ kind: "ready" })),
    } as unknown as BackendDescriptor;
    const mgr = new AgentSessionManager(
      buildApp(),
      buildPlugin() as unknown as ConstructorParameters<typeof AgentSessionManager>[1],
      {
        permissionPrompter: jest.fn(),
        resolveDescriptor: (id) => (id === descriptor.id ? descriptor : undefined),
        modelPreloader: modelPreloader as unknown as ConstructorParameters<
          typeof AgentSessionManager
        >[2]["modelPreloader"],
      }
    );

    await expect(mgr.restartBackend("opencode", "byok key added")).resolves.toBe(true);
    expect(refresh).toHaveBeenCalledWith("opencode");
    expect(mockBackendShutdown).not.toHaveBeenCalled();
  });

  it("does not refresh a warm probe when nothing was preloaded", async () => {
    const refresh = jest.fn(() => null);
    const modelPreloader = {
      getCachedModelCatalog: jest.fn(() => null),
      preload: jest.fn(async () => undefined),
      refresh,
      subscribe: jest.fn(() => () => {}),
      shutdown: jest.fn(),
      clearCached: jest.fn(),
      takeWarm: jest.fn(() => null),
      getWarmProcs: jest.fn(() => []),
    };
    const descriptor = {
      ...buildDescriptor(),
      getInstallState: jest.fn(() => ({ kind: "ready" })),
    } as unknown as BackendDescriptor;
    const mgr = new AgentSessionManager(
      buildApp(),
      buildPlugin() as unknown as ConstructorParameters<typeof AgentSessionManager>[1],
      {
        permissionPrompter: jest.fn(),
        resolveDescriptor: (id) => (id === descriptor.id ? descriptor : undefined),
        modelPreloader: modelPreloader as unknown as ConstructorParameters<
          typeof AgentSessionManager
        >[2]["modelPreloader"],
      }
    );

    await expect(mgr.restartBackend("opencode", "byok key added")).resolves.toBe(false);
    expect(refresh).toHaveBeenCalledWith("opencode");
  });

  it("re-probes after restart when no replacement session is created", async () => {
    const preload = jest.fn(async () => undefined);
    const modelPreloader = {
      getCachedModelCatalog: jest.fn(() => null),
      preload,
      refresh: jest.fn(() => null),
      subscribe: jest.fn(() => () => {}),
      shutdown: jest.fn(),
      clearCached: jest.fn(),
      takeWarm: jest.fn(() => null),
      getWarmProcs: jest.fn(() => []),
    };
    const descriptor = {
      ...buildDescriptor(),
      getInstallState: jest.fn(() => ({ kind: "ready" })),
    } as unknown as BackendDescriptor;
    const mgr = new AgentSessionManager(
      buildApp(),
      buildPlugin() as unknown as ConstructorParameters<typeof AgentSessionManager>[1],
      {
        permissionPrompter: jest.fn(),
        resolveDescriptor: (id) => (id === descriptor.id ? descriptor : undefined),
        modelPreloader: modelPreloader as unknown as ConstructorParameters<
          typeof AgentSessionManager
        >[2]["modelPreloader"],
      }
    );

    const session = await createShown(mgr);
    await mgr.closeSession(session.internalId);
    preload.mockClear();

    await expect(mgr.restartBackend("opencode", "byok save")).resolves.toBe(true);

    expect(mockBackendShutdown).toHaveBeenCalled();
    expect(preload).toHaveBeenCalledWith("opencode");
  });

  it("restarts an idle backend and replaces the active affected session", async () => {
    const mgr = buildManager();
    const first = await createShown(mgr);

    await expect(mgr.restartBackend("opencode", "skills changed")).resolves.toBe(true);

    expect(mockSessionCancel).toHaveBeenCalledWith();
    expect(mockSessionDispose).toHaveBeenCalledWith();
    expect(mockBackendShutdown).toHaveBeenCalledTimes(1);
    expect(mgr.getSessions()).toHaveLength(1);
    expect(mgr.getActiveSession()).not.toBe(first);
    expect(mgr.getActiveSession()?.backendId).toBe("opencode");
  });

  it("gives the replacement the replaced session's chat input so the composer draft survives (https://github.com/Brevilabs/obsidian-copilot-private/issues/473)", async () => {
    const mgr = buildManager();
    const first = await createShown(mgr);
    const chatInputId = first.chatInputId;
    mgr.drafts.update(chatInputId, (draft) => ({ ...draft, input: "half-written question" }));

    await mgr.restartBackend("opencode", "byok key saved");

    expect(mgr.getActiveSession()).not.toBe(first);
    expect(mgr.getActiveSession()?.chatInputId).toBe(chatInputId);
    expect(mgr.drafts.get(chatInputId)?.input).toBe("half-written question");
  });

  it("reports the replaced chat input as live while no session owns it (https://github.com/Brevilabs/obsidian-copilot-private/issues/473)", async () => {
    const liveDuringGap: string[][] = [];
    const mgr = buildManager({
      preload: jest.fn(async () => {
        liveDuringGap.push([...mgr.getLiveChatInputIds()]);
      }) as unknown as AgentModelPreloader["preload"],
    });
    const first = await createShown(mgr);
    const chatInputId = first.chatInputId;

    await mgr.restartBackend("opencode", "byok key saved");

    expect(liveDuringGap.at(-1)).toContain(chatInputId);
    expect(mgr.getLiveChatInputIds()).toEqual([chatInputId]);
  });

  it("re-probes before creating the replacement so the effort catalog is rebuilt", async () => {
    const preload = jest.fn(async () => undefined);
    const modelPreloader = {
      getCachedModelCatalog: jest.fn(() => null),
      preload,
      refresh: jest.fn(() => null),
      subscribe: jest.fn(() => () => {}),
      shutdown: jest.fn(),
      clearCached: jest.fn(),
      takeWarm: jest.fn(() => null),
      getWarmProcs: jest.fn(() => []),
    };
    const descriptor = {
      ...buildDescriptor(),
      getInstallState: jest.fn(() => ({ kind: "ready" })),
    } as unknown as BackendDescriptor;
    const mgr = new AgentSessionManager(
      buildApp(),
      buildPlugin() as unknown as ConstructorParameters<typeof AgentSessionManager>[1],
      {
        permissionPrompter: jest.fn(),
        resolveDescriptor: (id) => (id === descriptor.id ? descriptor : undefined),
        modelPreloader: modelPreloader as unknown as ConstructorParameters<
          typeof AgentSessionManager
        >[2]["modelPreloader"],
      }
    );

    const first = await createShown(mgr);
    preload.mockClear();
    sessionCreateSpy.mockClear();

    await expect(mgr.restartBackend("opencode", "backend enabled models changed")).resolves.toBe(
      true
    );

    expect(preload).toHaveBeenCalledTimes(1);
    expect(preload).toHaveBeenCalledWith("opencode");
    expect(sessionCreateSpy).toHaveBeenCalledTimes(1);
    expect(preload.mock.invocationCallOrder[0]).toBeLessThan(
      sessionCreateSpy.mock.invocationCallOrder[0]
    );
    expect(mgr.getActiveSession()).not.toBe(first);
    expect(mgr.getActiveSession()?.backendId).toBe("opencode");
  });

  it("defers restart until an active turn leaves running", async () => {
    const mgr = buildManager();
    const first = await createShown(mgr);
    getSessionTestHandle(first).setStatus("running");

    await expect(mgr.restartBackend("opencode", "skills changed")).resolves.toBe(true);
    expect(mockBackendShutdown).not.toHaveBeenCalled();

    getSessionTestHandle(first).setStatus("idle");
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(mockBackendShutdown).toHaveBeenCalledTimes(1);
    expect(mgr.getActiveSession()).not.toBe(first);
    expect(mgr.getActiveSession()?.backendId).toBe("opencode");
  });

  it("https://github.com/Brevilabs/obsidian-copilot-private/issues/561 restarts after the failed turn settles and keeps its user message and clear error", async () => {
    const mgr = buildManagerWithReplay({
      loadSession: jest.fn(async ({ sessionId }: { sessionId: string }) => ({
        sessionId,
        state: { model: null, mode: null },
      })),
    });
    const first = await createShown(mgr);
    const firstHandle = getSessionTestHandle(first);
    firstHandle.setStatus("running");

    mockUnhealthyHandler?.();
    expect(mockBackendShutdown).not.toHaveBeenCalled();

    const failedTurn = [
      { message: "Summarize this note" },
      { message: "OpenCode's internal service stopped. Please try again.", isErrorMessage: true },
    ];
    firstHandle.setMessages(failedTurn, true);
    firstHandle.setStatus("error");
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(mockBackendShutdown).toHaveBeenCalledTimes(1);
    expect(mgr.getActiveSession()).not.toBe(first);
    expect(
      mgr
        .getActiveSession()
        ?.store.getDisplayMessages()
        .map((m) => m.message)
    ).toEqual(failedTurn.map((m) => m.message));
    expect(mgr.getActiveSession()?.store.getDisplayMessages().at(-1)?.isErrorMessage).toBe(true);
  });

  it("https://github.com/Brevilabs/obsidian-copilot-private/issues/561 keeps failed turns from two chats sharing the same OpenCode process", async () => {
    const mgr = buildManagerWithReplay({
      loadSession: jest.fn(async ({ sessionId }: { sessionId: string }) => ({
        sessionId,
        state: { model: null, mode: null },
      })),
    });
    const first = await createShown(mgr);
    const second = await createShown(mgr);
    getSessionTestHandle(first).setStatus("running");
    getSessionTestHandle(second).setStatus("running");

    mockUnhealthyHandler?.();
    const firstMessages = [
      { message: "First question" },
      { message: "Internal error: Internal service failure", isErrorMessage: true },
    ];
    const secondMessages = [
      { message: "Second question" },
      { message: "OpenCode's internal service stopped. Please try again.", isErrorMessage: true },
    ];
    getSessionTestHandle(first).setMessages(firstMessages);
    getSessionTestHandle(first).setStatus("error");
    expect(mockBackendShutdown).not.toHaveBeenCalled();
    getSessionTestHandle(second).setMessages(secondMessages);
    getSessionTestHandle(second).setStatus("error");
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    const replaced = mgr.getSessions();
    expect(mockBackendShutdown).toHaveBeenCalledTimes(1);
    expect(
      replaced
        .find((s) => s.chatInputId === first.chatInputId)
        ?.store.getDisplayMessages()
        .map((m) => m.message)
    ).toEqual(firstMessages.map((m) => m.message));
    expect(
      replaced
        .find((s) => s.chatInputId === second.chatInputId)
        ?.store.getDisplayMessages()
        .map((m) => m.message)
    ).toEqual(secondMessages.map((m) => m.message));
  });

  it("https://github.com/Brevilabs/obsidian-copilot-private/issues/561 leaves ordinary restarts to replay the backend transcript", async () => {
    const mgr = buildManager();
    const first = await createShown(mgr);
    getSessionTestHandle(first).setMessages([{ message: "Local draft transcript" }]);

    await mgr.restartBackend("opencode", "models changed");

    expect(mgr.getActiveSession()?.store.getDisplayMessages()).toEqual([]);
  });

  it("https://github.com/Brevilabs/obsidian-copilot-private/issues/561 keeps a fresh fallback free of messages the new backend never received", async () => {
    const mgr = buildManager();
    const first = await createShown(mgr);
    const handle = getSessionTestHandle(first);
    handle.setStatus("running");
    mockUnhealthyHandler?.();
    handle.setMessages([
      { message: "Unsaved prompt" },
      { message: "OpenCode's internal service stopped. Please try again." },
    ]);
    handle.setStatus("error");
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(mgr.getActiveSession()?.getBackendSessionId()).not.toBe(first.getBackendSessionId());
    expect(mgr.getActiveSession()?.store.getDisplayMessages()).toEqual([]);
  });

  it("https://github.com/Brevilabs/obsidian-copilot-private/issues/121 interrupts a busy turn when a privacy-boundary restart cannot be deferred", async () => {
    const mgr = buildManager();
    const first = await createShown(mgr);
    getSessionTestHandle(first).setStatus("running");

    await expect(
      mgr.restartBackend("opencode", "Miyo Search scope changed", { deferWhileBusy: false })
    ).resolves.toBe(true);

    expect(mockSessionCancel).toHaveBeenCalledWith();
    expect(mockBackendShutdown).toHaveBeenCalledTimes(1);
    expect(mgr.getActiveSession()).not.toBe(first);
  });

  it("queues a second concurrent restart so the latest settings are not lost", async () => {
    const mgr = buildManager();
    await createShown(mgr);

    let releaseShutdown!: () => void;
    const shutdownStarted = new Promise<void>((resolveStarted) => {
      mockBackendShutdown.mockImplementationOnce(
        () =>
          new Promise<undefined>((resolve) => {
            resolveStarted();
            releaseShutdown = () => resolve(undefined);
          })
      );
    });

    const first = mgr.restartBackend("opencode", "byok save #1");
    await shutdownStarted;
    const second = mgr.restartBackend("opencode", "byok save #2");
    releaseShutdown();
    await Promise.all([first, second]);
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(mockBackendShutdown).toHaveBeenCalledTimes(2);
  });

  it("https://github.com/Brevilabs/obsidian-copilot-private/issues/121 keeps a queued privacy-boundary restart non-deferrable", async () => {
    const mgr = buildManager();
    await createShown(mgr);

    sessionCreateSpy.mockImplementationOnce((opts) => {
      const replacement = makeMockSession({
        internalId: opts.internalId,
        chatInputId: opts.chatInputId,
        backendId: opts.backendId,
        projectId: opts.projectId,
      });
      getSessionTestHandle(replacement).setStatus("running");
      return replacement;
    });
    let releaseShutdown!: () => void;
    const shutdownStarted = new Promise<void>((resolveStarted) => {
      mockBackendShutdown.mockImplementationOnce(
        () =>
          new Promise<undefined>((resolve) => {
            resolveStarted();
            releaseShutdown = () => resolve(undefined);
          })
      );
    });

    const ordinaryRestart = mgr.restartBackend("opencode", "managed env changed");
    await shutdownStarted;
    const privacyRestart = mgr.restartBackend("opencode", "Miyo Search scope changed", {
      deferWhileBusy: false,
    });
    releaseShutdown();
    await Promise.all([ordinaryRestart, privacyRestart]);
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(mockBackendShutdown).toHaveBeenCalledTimes(2);
  });

  function buildManagerWithReplay(backendOverrides: Record<string, unknown>): AgentSessionManager {
    const backend = { ...makeMockBackendProcess(), ...backendOverrides };
    const descriptor = {
      ...buildDescriptor(),
      getInstallState: jest.fn(() => ({ kind: "ready" })),
      createBackendProcess: jest.fn(() => backend),
    } as unknown as BackendDescriptor;
    return new AgentSessionManager(
      buildApp(),
      buildPlugin() as unknown as ConstructorParameters<typeof AgentSessionManager>[1],
      {
        permissionPrompter: jest.fn(),
        resolveDescriptor: (id) => (id === descriptor.id ? descriptor : undefined),
        modelPreloader: {
          getCachedModelCatalog: jest.fn(() => null),
          getEffortCatalog: jest.fn(() => null),
          preload: jest.fn(async () => undefined),
          refresh: jest.fn(() => null),
          subscribe: jest.fn(() => () => {}),
          shutdown: jest.fn(),
          clearCached: jest.fn(),
          takeWarm: jest.fn(() => null),
          getWarmProcs: jest.fn(() => []),
        } as unknown as ConstructorParameters<typeof AgentSessionManager>[2]["modelPreloader"],
      }
    );
  }

  it("brings the replaced tab back on its own conversation (https://github.com/Brevilabs/obsidian-copilot-private/issues/475)", async () => {
    const loadSession = jest.fn(async ({ sessionId }: { sessionId: string }) => ({
      sessionId,
      state: { model: null, mode: null },
    }));
    const mgr = buildManagerWithReplay({ loadSession });
    const first = await createShown(mgr);
    const backendSessionId = first.getBackendSessionId();
    const chatInputId = first.chatInputId;

    await mgr.restartBackend("opencode", "managed skills changed");

    expect(loadSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: backendSessionId })
    );
    const replacement = mgr.getActiveSession();
    expect(replacement).not.toBe(first);
    expect(replacement?.getBackendSessionId()).toBe(backendSessionId);
    expect(replacement?.chatInputId).toBe(chatInputId);
    expect(mgr.getSessions()).toHaveLength(1);
  });

  it("keeps the replaced tab's title across the restart (https://github.com/Brevilabs/obsidian-copilot-private/issues/475)", async () => {
    const mgr = buildManagerWithReplay({
      loadSession: jest.fn(async ({ sessionId }: { sessionId: string }) => ({
        sessionId,
        state: { model: null, mode: null },
      })),
    });
    const first = await createShown(mgr);
    first.restoreLabel("Refactor the importer", "user");

    await mgr.restartBackend("opencode", "managed skills changed");

    expect(mgr.getActiveSession()?.getLabel()).toBe("Refactor the importer");
  });

  it("opens a fresh chat when the backend cannot replay the conversation", async () => {
    const mgr = buildManagerWithReplay({
      loadSession: jest.fn(async () => {
        throw new MethodUnsupportedError("session/load");
      }),
      resumeSession: jest.fn(async () => {
        throw new MethodUnsupportedError("session/resume");
      }),
    });
    const first = await createShown(mgr);
    const chatInputId = first.chatInputId;

    await mgr.restartBackend("opencode", "managed skills changed");

    const replacement = mgr.getActiveSession();
    expect(replacement).not.toBe(first);
    expect(replacement?.getBackendSessionId()).not.toBe(first.getBackendSessionId());
    expect(replacement?.chatInputId).toBe(chatInputId);
    expect(mgr.getSessions()).toHaveLength(1);
  });
});

describe("AgentSessionManager attention tracking", () => {
  it("flags a backgrounded session that finishes a turn", async () => {
    const mgr = buildManager();
    const a = await createShown(mgr);
    const b = await createShown(mgr);
    show(mgr, a);
    const bHandle = getSessionTestHandle(b);
    bHandle.setStatus("running");
    bHandle.setStatus("idle");
    expect(b.getNeedsAttention()).toBe(true);
    expect(a.getNeedsAttention()).toBe(false);
  });

  it("flags a backgrounded session that errors out", async () => {
    const mgr = buildManager();
    const a = await createShown(mgr);
    const b = await createShown(mgr);
    show(mgr, a);
    const bHandle = getSessionTestHandle(b);
    bHandle.setStatus("running");
    bHandle.setStatus("error");
    expect(b.getNeedsAttention()).toBe(true);
  });

  it("flags a backgrounded session when it starts awaiting permission (https://github.com/logancyang/obsidian-copilot/issues/2987)", async () => {
    const mgr = buildManager();
    const a = await createShown(mgr);
    const b = await createShown(mgr);
    show(mgr, a);
    const bHandle = getSessionTestHandle(b);

    bHandle.setStatus("running");
    bHandle.setStatus("awaiting_permission");

    expect(b.getNeedsAttention()).toBe(true);
  });

  it("does not flag the active session even when its chat is not focused (https://github.com/logancyang/obsidian-copilot/issues/2987)", async () => {
    const mgr = buildManager();
    const a = await createShown(mgr);
    expect(mgr.getActiveSession()).toBe(a);
    const aHandle = getSessionTestHandle(a);
    aHandle.setStatus("running");
    aHandle.setStatus("idle");
    expect(a.getNeedsAttention()).toBe(false);
  });

  it("chimes when a turn ends (https://github.com/logancyang/obsidian-copilot/issues/2987)", async () => {
    const mgr = buildManager();
    const a = await createShown(mgr);
    expect(mgr.getActiveSession()).toBe(a);
    const aHandle = getSessionTestHandle(a);

    aHandle.setStatus("running");
    aHandle.setStatus("idle");

    expect(playNotificationSound).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["the most recent Agent Chat", "inside"],
    ["a sidebar Agent Chat whose leaf is not most recent", "inside-sidebar"],
  ] as const)(
    "stays silent when focus is inside %s (https://github.com/logancyang/obsidian-copilot/issues/2987)",
    async (_label, focus) => {
      mockAgentChatFocus = focus;
      const mgr = buildManager();
      const session = await createShown(mgr);
      const handle = getSessionTestHandle(session);

      handle.setStatus("running");
      handle.setStatus("idle");

      expect(playNotificationSound).not.toHaveBeenCalled();
      expect(session.getNeedsAttention()).toBe(false);
    }
  );

  it.each([
    ["a modal outside the chat has focus", "outside"],
    ["another workspace leaf has focus", "other-leaf"],
    ["the Obsidian window is unfocused", "unfocused-window"],
  ] as const)(
    "chimes when %s (https://github.com/logancyang/obsidian-copilot/issues/2987)",
    async (_label, focus) => {
      mockAgentChatFocus = focus;
      const mgr = buildManager();
      const session = await createShown(mgr);
      const handle = getSessionTestHandle(session);

      handle.setStatus("running");
      handle.setStatus("idle");

      expect(playNotificationSound).toHaveBeenCalledWith("piano");
      expect(session.getNeedsAttention()).toBe(false);
    }
  );

  it("chimes when a session starts awaiting permission (https://github.com/logancyang/obsidian-copilot/issues/2987)", async () => {
    const mgr = buildManager();
    const a = await createShown(mgr);
    const aHandle = getSessionTestHandle(a);

    aHandle.setStatus("running");
    aHandle.setStatus("awaiting_permission");

    expect(playNotificationSound).toHaveBeenCalledTimes(1);
    expect(a.getNeedsAttention()).toBe(false);
  });

  it("stays silent when the focused Agent Chat starts awaiting permission (https://github.com/logancyang/obsidian-copilot/issues/2987)", async () => {
    mockAgentChatFocus = "inside";
    const mgr = buildManager();
    const session = await createShown(mgr);
    const handle = getSessionTestHandle(session);

    handle.setStatus("running");
    handle.setStatus("awaiting_permission");

    expect(playNotificationSound).not.toHaveBeenCalled();
    expect(session.getNeedsAttention()).toBe(false);
  });

  it("chimes when a backgrounded session finishes (https://github.com/logancyang/obsidian-copilot/issues/2987)", async () => {
    mockAgentChatFocus = "inside";
    const mgr = buildManager();
    const a = await createShown(mgr);
    const b = await createShown(mgr);
    show(mgr, a);
    const bHandle = getSessionTestHandle(b);

    bHandle.setStatus("running");
    bHandle.setStatus("idle");

    expect(playNotificationSound).toHaveBeenCalledWith("piano");
    expect(b.getNeedsAttention()).toBe(true);
  });

  it("stays silent when the notification sound setting is off (https://github.com/logancyang/obsidian-copilot/issues/2987)", async () => {
    mockNotificationSound = false;
    const mgr = buildManager();
    const a = await createShown(mgr);
    const b = await createShown(mgr);
    show(mgr, a);
    const bHandle = getSessionTestHandle(b);

    bHandle.setStatus("running");
    bHandle.setStatus("idle");

    expect(playNotificationSound).not.toHaveBeenCalled();
    expect(b.getNeedsAttention()).toBe(true);
  });

  it("stays silent on the starting → idle transition of a fresh session (https://github.com/logancyang/obsidian-copilot/issues/2987)", async () => {
    const mgr = buildManager();
    const a = await createShown(mgr);
    const aHandle = getSessionTestHandle(a);

    aHandle.setStatus("starting");
    aHandle.setStatus("idle");

    expect(playNotificationSound).not.toHaveBeenCalled();
  });

  it("does not flag the starting → idle transition", async () => {
    const mgr = buildManager();
    const a = await createShown(mgr);
    const b = await createShown(mgr);
    show(mgr, a);
    const bHandle = getSessionTestHandle(b);
    bHandle.setStatus("starting");
    bHandle.setStatus("idle");
    expect(b.getNeedsAttention()).toBe(false);
  });

  it("clears the flag when the user opens the flagged chat from history", async () => {
    const mgr = buildManager();
    const a = await createShown(mgr);
    const b = await createShown(mgr);
    show(mgr, a);
    const bHandle = getSessionTestHandle(b);
    bHandle.setStatus("running");
    bHandle.setStatus("idle");
    expect(b.getNeedsAttention()).toBe(true);
    await mgr.loadNativeSessionFromHistory(b.backendId, b.getBackendSessionId()!);
    expect(b.getNeedsAttention()).toBe(false);
    expect(mgr.getActiveSession()).toBe(b);
  });

  it("skips the flag for a session that any client reports as focused https://github.com/Brevilabs/obsidian-copilot-private/issues/612", async () => {
    const mgr = buildManager();
    const a = await createShown(mgr);
    const b = await createShown(mgr);
    show(mgr, a);
    mgr.setFocusProbe((id) => id === b.internalId);
    const bHandle = getSessionTestHandle(b);
    bHandle.setStatus("running");
    bHandle.setStatus("idle");
    expect(b.getNeedsAttention()).toBe(false);
  });

  it("flags a finished session no client shows, even when the panel's own view is on it https://github.com/Brevilabs/obsidian-copilot-private/issues/612", async () => {
    const mgr = buildManager();
    const a = await createShown(mgr);
    mgr.setFocusProbe(() => false);
    const aHandle = getSessionTestHandle(a);
    aHandle.setStatus("running");
    aHandle.setStatus("idle");
    expect(a.getNeedsAttention()).toBe(true);
  });
});

describe("AgentSessionManager.getRunningChatIds", () => {
  function buildManagerWithPersistence(): AgentSessionManager {
    const descriptor = buildDescriptor();
    const persistence = {
      saveSession: jest.fn(async () => ({ path: "chats/agent__saved.md" })),
    };
    return new AgentSessionManager(
      buildApp(),
      buildPlugin() as unknown as ConstructorParameters<typeof AgentSessionManager>[1],
      {
        permissionPrompter: jest.fn(),
        resolveDescriptor: (id) => (id === descriptor.id ? descriptor : undefined),
        modelPreloader: {
          getCachedModelCatalog: jest.fn(() => null),
          preload: jest.fn(async () => undefined),
          refresh: jest.fn(() => null),
          subscribe: jest.fn(() => () => {}),
          shutdown: jest.fn(),
          clearCached: jest.fn(),
          takeWarm: jest.fn(() => null),
          getWarmProcs: jest.fn(() => []),
        } as unknown as ConstructorParameters<typeof AgentSessionManager>[2]["modelPreloader"],
        persistenceManager: persistence as unknown as ConstructorParameters<
          typeof AgentSessionManager
        >[2]["persistenceManager"],
      }
    );
  }

  it("returns the same frozen empty set when nothing is running", async () => {
    const mgr = buildManager();
    const a = await createShown(mgr);
    getSessionTestHandle(a).setStatus("idle");
    const first = mgr.getRunningChatIds();
    expect(first.size).toBe(0);
    expect(mgr.getRunningChatIds()).toBe(first);
  });

  it("keys a running saved session by its markdown path", async () => {
    const mgr = buildManagerWithPersistence();
    const a = await createShown(mgr);
    getSessionTestHandle(a).setMessages([{ message: "hi" }]);
    await mgr.saveActiveSession();
    getSessionTestHandle(a).setStatus("running");
    expect(mgr.getRunningChatIds().has("chats/agent__saved.md")).toBe(true);
  });

  it("keys a running native session by its native chat id", async () => {
    const mgr = buildManager();
    const a = await createShown(mgr);
    getSessionTestHandle(a).setStatus("running");
    const expected = buildNativeChatId(a.backendId, a.getBackendSessionId()!);
    expect(mgr.getRunningChatIds().has(expected)).toBe(true);
  });

  it("excludes idle / starting / closed sessions", async () => {
    const mgr = buildManager();
    const a = await createShown(mgr);
    const b = await createShown(mgr);
    getSessionTestHandle(a).setStatus("running");
    getSessionTestHandle(b).setStatus("starting");
    const ids = mgr.getRunningChatIds();
    expect(ids.has(buildNativeChatId(a.backendId, a.getBackendSessionId()!))).toBe(true);
    expect(ids.has(buildNativeChatId(b.backendId, b.getBackendSessionId()!))).toBe(false);
  });

  it("notifies subscribers when a session's running membership flips", async () => {
    const mgr = buildManager();
    const a = await createShown(mgr);
    const listener = jest.fn();
    mgr.subscribe(listener);
    getSessionTestHandle(a).setStatus("running");
    expect(listener).toHaveBeenCalledTimes(1);
    listener.mockClear();
    getSessionTestHandle(a).setStatus("idle");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("keeps both ids when a running session's first save re-keys it (dual-id)", async () => {
    const mgr = buildManagerWithPersistence();
    const a = await createShown(mgr);
    getSessionTestHandle(a).setMessages([{ message: "hi" }]);
    getSessionTestHandle(a).setStatus("running");
    const nativeId = buildNativeChatId(a.backendId, a.getBackendSessionId()!);
    expect(mgr.getRunningChatIds().has(nativeId)).toBe(true);

    await waitFor(() => expect(mgr.getIsStarting()).toBe(false));
    const listener = jest.fn();
    mgr.subscribe(listener);
    await mgr.saveActiveSession();

    expect(listener).toHaveBeenCalledTimes(1);
    const ids = mgr.getRunningChatIds();
    expect(ids.has("chats/agent__saved.md")).toBe(true);
    expect(ids.has(nativeId)).toBe(true);
  });
});

describe("AgentSessionManager.getAttentionChatIds", () => {
  it("returns the same frozen empty set when nothing needs attention", async () => {
    const mgr = buildManager();
    await createShown(mgr);
    const first = mgr.getAttentionChatIds();
    expect(first.size).toBe(0);
    expect(mgr.getAttentionChatIds()).toBe(first);
  });

  it("hands a backgrounded finished session over from running to attention", async () => {
    const mgr = buildManager();
    const a = await createShown(mgr);
    const b = await createShown(mgr);
    show(mgr, a);
    const bHandle = getSessionTestHandle(b);
    const nativeId = buildNativeChatId(b.backendId, b.getBackendSessionId()!);

    bHandle.setStatus("running");
    expect(mgr.getRunningChatIds().has(nativeId)).toBe(true);
    expect(mgr.getAttentionChatIds().has(nativeId)).toBe(false);

    bHandle.setStatus("idle");
    expect(mgr.getRunningChatIds().has(nativeId)).toBe(false);
    expect(mgr.getAttentionChatIds().has(nativeId)).toBe(true);
  });

  it("does not include the active session even when its chat is not focused (https://github.com/logancyang/obsidian-copilot/issues/2987)", async () => {
    const mgr = buildManager();
    const a = await createShown(mgr);
    const aHandle = getSessionTestHandle(a);
    aHandle.setStatus("running");
    aHandle.setStatus("idle");
    expect(mgr.getAttentionChatIds().size).toBe(0);
  });

  it("drops the id once the flagged chat is opened from history", async () => {
    const mgr = buildManager();
    const a = await createShown(mgr);
    const b = await createShown(mgr);
    show(mgr, a);
    const bHandle = getSessionTestHandle(b);
    bHandle.setStatus("running");
    bHandle.setStatus("idle");
    const nativeId = buildNativeChatId(b.backendId, b.getBackendSessionId()!);
    expect(mgr.getAttentionChatIds().has(nativeId)).toBe(true);
    await mgr.loadNativeSessionFromHistory(b.backendId, b.getBackendSessionId()!);
    expect(mgr.getAttentionChatIds().has(nativeId)).toBe(false);
  });
});

describe("AgentSessionManager.replaceSessionInPlace", () => {
  async function flushBackgroundClose(): Promise<void> {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  }

  it("inserts the replacement at the old session's tab-strip index", async () => {
    const mgr = buildManager();
    const a = await createShown(mgr);
    const b = await createShown(mgr);
    const c = await createShown(mgr);
    const replacement = await mgr.replaceSessionInPlace(b.internalId);
    await flushBackgroundClose();
    expect(mgr.getSessions()).toEqual([a, replacement, c]);
  });

  it("preserves the leftmost slot when replacing the first tab", async () => {
    const mgr = buildManager();
    const a = await createShown(mgr);
    const b = await createShown(mgr);
    show(mgr, a);
    const replacement = await mgr.replaceSessionInPlace(a.internalId);
    await flushBackgroundClose();
    expect(mgr.getSessions()).toEqual([replacement, b]);
  });

  it("does not select the replacement, so the requesting client shows it https://github.com/Brevilabs/obsidian-copilot-private/issues/612", async () => {
    const mgr = buildManager();
    const a = await createShown(mgr);
    await mgr.replaceSessionInPlace(a.internalId);
    await flushBackgroundClose();
    expect(mgr["view"].getActiveTabId()).toBe(a.internalId);
  });

  it("preserves the logical chat input only when explicitly requested", async () => {
    const mgr = buildManager();
    const freshSource = await createShown(mgr);
    expect(freshSource.chatInputId).not.toBe(freshSource.internalId);
    const freshReplacement = await mgr.replaceSessionInPlace(freshSource.internalId);
    expect(freshReplacement.chatInputId).not.toBe(freshSource.chatInputId);

    const preservedSource = freshReplacement;
    const preservedReplacement = await mgr.replaceSessionInPlace(
      preservedSource.internalId,
      undefined,
      { preserveChatInput: true }
    );
    expect(preservedReplacement.chatInputId).toBe(preservedSource.chatInputId);
  });

  it("keeps the last successful replacement when a queued replacement fails", async () => {
    const mgr = buildManager();
    const source = await createShown(mgr);
    const createSession = mgr.createSession.bind(mgr);
    let releaseSecond!: () => void;
    let markSecondStarted!: () => void;
    const secondStarted = new Promise<void>((resolve) => (markSecondStarted = resolve));
    const secondGate = new Promise<void>((resolve) => (releaseSecond = resolve));
    let replacementCount = 0;
    jest.spyOn(mgr, "createSession").mockImplementation(async (...args) => {
      replacementCount++;
      if (replacementCount === 2) {
        markSecondStarted();
        await secondGate;
        throw new Error("replacement failed");
      }
      return createSession(...args);
    });

    const first = mgr.replaceSessionInPlace(source.internalId, "opencode", {
      preserveChatInput: true,
      seedSelection: { baseModelId: "first-model", effort: null },
    });
    const second = mgr.replaceSessionInPlace(source.internalId, "opencode", {
      preserveChatInput: true,
      seedSelection: { baseModelId: "latest-model", effort: "high" },
    });
    const firstReplacement = await first;
    await secondStarted;
    const third = mgr.replaceSessionInPlace(firstReplacement.internalId, "opencode", {
      preserveChatInput: true,
      seedSelection: { baseModelId: "final-model", effort: "low" },
    });
    releaseSecond();
    await expect(second).rejects.toThrow("replacement failed");
    const thirdReplacement = await third;
    await flushBackgroundClose();

    expect(thirdReplacement).not.toBe(firstReplacement);
    expect(thirdReplacement.chatInputId).toBe(source.chatInputId);
    expect(sessionCreateSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        defaultModelSelection: { baseModelId: "final-model", effort: "low" },
      })
    );
    expect(mgr.getSessions()).toEqual([thirdReplacement]);
  });

  it("closes the old session in the background", async () => {
    const mgr = buildManager();
    const a = await createShown(mgr);
    await mgr.replaceSessionInPlace(a.internalId);
    await flushBackgroundClose();
    expect(mockSessionCancel).toHaveBeenCalled();
    expect(mockSessionDispose).toHaveBeenCalled();
    expect(mgr.getSessions().some((s) => s.internalId === a.internalId)).toBe(false);
  });

  it("forwards the explicit backendId to createSession", async () => {
    const mgr = buildManager();
    const a = await createShown(mgr);
    const replacement = await mgr.replaceSessionInPlace(a.internalId, "opencode");
    expect(replacement.backendId).toBe("opencode");
  });

  it("falls back to plain create when the old id is unknown", async () => {
    const mgr = buildManager();
    const replacement = await mgr.replaceSessionInPlace("does-not-exist");
    expect(mgr.getSessions()).toEqual([replacement]);
  });

  it("the replacement takes the replaced session's position in the pool", async () => {
    const mgr = buildManager();
    const a = await createShown(mgr);
    const b = await createShown(mgr);
    show(mgr, a);
    const replacement = await mgr.replaceSessionInPlace(a.internalId);
    await flushBackgroundClose();
    expect(mgr.getSessions().map((session) => session.internalId)).toEqual([
      replacement.internalId,
      b.internalId,
    ]);
  });
});

describe("AgentSessionManager.subscribe / shutdown", () => {
  it("notifies subscribers on session create / close / activate", async () => {
    const mgr = buildManager();
    const listener = jest.fn();
    mgr.subscribe(listener);

    const a = await createShown(mgr);
    const b = await createShown(mgr);
    show(mgr, a);
    await mgr.closeSession(b.internalId);

    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it("shutdown cancels and disposes every session and clears state", async () => {
    const mgr = buildManager();
    await createShown(mgr);
    await createShown(mgr);
    expect(mgr.getSessions()).toHaveLength(2);

    await mgr.shutdown();
    expect(mgr.getSessions()).toEqual([]);
    expect(mgr.getActiveSession()).toBeNull();
    expect(mockSessionCancel).toHaveBeenCalledTimes(2);
    expect(mockSessionDispose).toHaveBeenCalledTimes(2);
    expect(mockBackendShutdown).toHaveBeenCalledTimes(1);
  });

  it("backend exit drops every session and surfaces lastError", async () => {
    const mgr = buildManager();
    const listener = jest.fn();
    mgr.subscribe(listener);
    await createShown(mgr);
    await createShown(mgr);

    for (const fn of mockBackendExitListeners) fn();

    expect(mgr.getSessions()).toEqual([]);
    expect(mgr.getActiveSession()).toBeNull();
    expect(mgr.getLastError()).toMatch(/exited unexpectedly/);
    expect(listener).toHaveBeenCalled();
  });
});

describe("AgentSessionManager.applySelectionTo (dispatch)", () => {
  it("delegates dispatch to descriptor.applySelection with the resolved selection", async () => {
    const applySelectionMock = jest.fn(async () => {});
    const descriptor = {
      id: "opencode",
      displayName: "opencode",
      getInstallState: jest.fn(() => ({ kind: "ready", source: "custom" })),
      subscribeInstallState: jest.fn(),
      openInstallUI: jest.fn(),
      createBackendProcess: jest.fn(() => makeMockBackendProcess()),
      wire: {
        encode: ({ baseModelId, effort }: { baseModelId: string; effort: string | null }) =>
          effort ? `${baseModelId}/${effort}` : baseModelId,
        decode: (id: string) => ({
          selection: { baseModelId: id, effort: null },
          provider: null,
        }),
      },
      applySelection: applySelectionMock,
    } as unknown as BackendDescriptor;
    const modelPreloader = {
      getCachedModelCatalog: jest.fn(() => null),
      preload: jest.fn(async () => undefined),
      subscribe: jest.fn(() => () => {}),
      shutdown: jest.fn(),
      clearCached: jest.fn(),
      takeWarm: jest.fn(() => null),
      getWarmProcs: jest.fn(() => []),
    };
    const mgr = new AgentSessionManager(
      buildApp(),
      buildPlugin() as unknown as ConstructorParameters<typeof AgentSessionManager>[1],
      {
        permissionPrompter: jest.fn(),
        resolveDescriptor: (id) => (id === descriptor.id ? descriptor : undefined),
        modelPreloader: modelPreloader as unknown as ConstructorParameters<
          typeof AgentSessionManager
        >[2]["modelPreloader"],
      }
    );
    const entry = {
      baseModelId: "anthropic/sonnet",
      name: "Sonnet",
      provider: "anthropic",
      effortOptions: [
        { value: null, label: "Default" },
        { value: "high", label: "High" },
      ],
    };
    sessionCreateSpy.mockImplementationOnce((opts) => {
      const s = makeMockSession({ internalId: opts.internalId, backendId: opts.backendId });
      (s as unknown as { getState: () => unknown }).getState = () => ({
        model: {
          current: { baseModelId: entry.baseModelId, effort: null },
          availableModels: [entry],
        },
        mode: null,
      });
      return s;
    });
    const session = await createShown(mgr);

    (mockedSetSettings as jest.Mock).mockClear();
    await mgr.applySelectionTo(session.internalId, { effort: "high" });
    expect(applySelectionMock).toHaveBeenCalledWith(session, {
      baseModelId: "anthropic/sonnet",
      effort: "high",
    });
    expect(readPersistedDefault(mockedSetSettings as jest.Mock, "opencode")).toBeUndefined();

    applySelectionMock.mockClear();
    (mockedSetSettings as jest.Mock).mockClear();
    await mgr.applySelectionTo(session.internalId, { baseModelId: "anthropic/opus", effort: null });
    expect(applySelectionMock).toHaveBeenCalledWith(session, {
      baseModelId: "anthropic/opus",
      effort: null,
    });
    expect(readPersistedDefault(mockedSetSettings as jest.Mock, "opencode")).toBeUndefined();
  });
});

describe("AgentSessionManager.applySelectionTo", () => {
  it("applies the selection to the addressed session even when another session is active https://github.com/Brevilabs/obsidian-copilot-private/issues/612", async () => {
    const applySelectionMock = jest.fn(async () => {});
    const descriptor = {
      ...buildDescriptor(),
      applySelection: applySelectionMock,
    } as unknown as BackendDescriptor;
    const mgr = new AgentSessionManager(
      buildApp(),
      buildPlugin() as unknown as ConstructorParameters<typeof AgentSessionManager>[1],
      {
        permissionPrompter: jest.fn(),
        resolveDescriptor: (id) => (id === descriptor.id ? descriptor : undefined),
        modelPreloader: {
          getCachedModelCatalog: jest.fn(() => null),
          getEffortCatalog: jest.fn(() => null),
          preload: jest.fn(async () => undefined),
          subscribe: jest.fn(() => () => {}),
          shutdown: jest.fn(),
          clearCached: jest.fn(),
          takeWarm: jest.fn(() => null),
          getWarmProcs: jest.fn(() => []),
        } as unknown as ConstructorParameters<typeof AgentSessionManager>[2]["modelPreloader"],
      }
    );
    sessionCreateSpy.mockImplementationOnce((opts) => {
      const s = makeMockSession({ internalId: opts.internalId, backendId: opts.backendId });
      (s as unknown as { getState: () => unknown }).getState = () => ({
        model: { current: { baseModelId: "sonnet", effort: null }, availableModels: [] },
        mode: null,
      });
      return s;
    });
    const first = await createShown(mgr);
    const second = await createShown(mgr);
    expect(mgr.getActiveSession()).toBe(second);

    await mgr.applySelectionTo(first.internalId, { effort: "high" });

    expect(applySelectionMock).toHaveBeenCalledWith(first, {
      baseModelId: "sonnet",
      effort: "high",
    });
  });

  it("resolves without applying anything for an unknown session id", async () => {
    const mgr = buildManager();
    await createShown(mgr);
    await expect(mgr.applySelectionTo("nope", { effort: "high" })).resolves.toBeUndefined();
  });
});

describe("AgentSessionManager.applyModeTo", () => {
  it("applies the mode spec the session's backend reported and leaves the persisted default alone https://github.com/Brevilabs/obsidian-copilot-private/issues/612", async () => {
    const mgr = buildManager();
    const session = await createShown(mgr);
    (session as unknown as { getState: () => unknown }).getState = () => ({
      model: null,
      mode: {
        current: "default",
        options: [{ value: "plan", label: "Plan" }],
        apply: { plan: { kind: "setMode", nativeId: "plan-native" } },
      },
    });
    (mockedSetSettings as jest.Mock).mockClear();

    await mgr.applyModeTo(session.internalId, "plan");

    expect(session.setMode).toHaveBeenCalledWith("plan-native");
    expect(mockedSetSettings).not.toHaveBeenCalled();
  });

  it("resolves without applying anything when the session has no spec for the mode", async () => {
    const mgr = buildManager();
    const session = await createShown(mgr);
    await expect(mgr.applyModeTo(session.internalId, "auto")).resolves.toBeUndefined();
    await expect(mgr.applyModeTo("nope", "auto")).resolves.toBeUndefined();
    expect(session.setMode).not.toHaveBeenCalled();
  });
});

describe("AgentSessionManager.applyModeTo (native mapping)", () => {
  function reportMode(
    session: AgentSession,
    mode: "default" | "plan" | "auto",
    spec: Record<string, unknown>
  ): void {
    (session as unknown as { getState: () => unknown }).getState = () => ({
      model: null,
      mode: {
        current: "default",
        options: [{ value: mode, label: mode }],
        apply: { [mode]: spec },
      },
    });
  }

  function buildModeManager(
    getModeMapping: BackendDescriptor["getModeMapping"]
  ): AgentSessionManager {
    const descriptor = {
      ...buildDescriptor(),
      id: "claude",
      displayName: "Claude",
      getModeMapping,
    } as BackendDescriptor;
    const modelPreloader = {
      getCachedModelCatalog: jest.fn(() => null),
      getEffortCatalog: jest.fn(() => null),
      preload: jest.fn(async () => undefined),
      refresh: jest.fn(() => null),
      subscribe: jest.fn(() => () => {}),
      shutdown: jest.fn(),
      clearCached: jest.fn(),
      takeWarm: jest.fn(() => null),
      getWarmProcs: jest.fn(() => []),
    };
    return new AgentSessionManager(
      buildApp(),
      buildPlugin() as unknown as ConstructorParameters<typeof AgentSessionManager>[1],
      {
        permissionPrompter: jest.fn(),
        resolveDescriptor: (id) => (id === descriptor.id ? descriptor : undefined),
        modelPreloader: modelPreloader as unknown as ConstructorParameters<
          typeof AgentSessionManager
        >[2]["modelPreloader"],
      }
    );
  }

  it("refreshes a state-independent native mapping before dispatch", async () => {
    const manager = buildModeManager(() => ({
      kind: "setMode",
      canonical: { default: "default", plan: "plan", auto: "auto" },
    }));
    const session = await manager.createSession("claude");

    reportMode(session, "auto", { kind: "setMode", nativeId: "bypassPermissions" });
    await manager.applyModeTo(session.internalId, "auto");

    expect(session.setMode).toHaveBeenCalledWith("auto");
  });

  it("uses the translated spec when the mapping requires live backend state", async () => {
    const manager = buildModeManager((modeState) =>
      modeState
        ? {
            kind: "setMode",
            canonical: { default: "default", plan: "plan", auto: "full-access" },
          }
        : null
    );
    const session = await manager.createSession("claude");

    reportMode(session, "auto", { kind: "setMode", nativeId: "cached-auto" });
    await manager.applyModeTo(session.internalId, "auto");

    expect(session.setMode).toHaveBeenCalledWith("cached-auto");
  });

  it("preserves Codex approval mode ids without an inventory (https://github.com/logancyang/obsidian-copilot/issues/2916)", async () => {
    const manager = buildModeManager(buildCodexModeMapping);
    const session = await manager.createSession("claude");

    for (const [mode, nativeId] of [
      ["default", "read-only"],
      ["auto", "agent"],
    ] as const) {
      reportMode(session, mode, { kind: "setMode", nativeId });
      await manager.applyModeTo(session.internalId, mode);
    }

    expect(session.setMode).toHaveBeenNthCalledWith(1, "read-only");
    expect(session.setMode).toHaveBeenNthCalledWith(2, "agent");
  });

  it("https://github.com/Brevilabs/obsidian-copilot-private/issues/551 applies both Codex Plan settings without replacing the translated choice", async () => {
    const manager = buildModeManager(buildCodexModeMapping);
    const session = await manager.createSession("claude");

    reportMode(session, "plan", {
      kind: "sequence",
      steps: [
        { kind: "setMode", nativeId: "agent" },
        { kind: "setConfigOption", configId: "collaboration_mode", value: "plan" },
      ],
    });
    await manager.applyModeTo(session.internalId, "plan");

    expect(session.setMode).toHaveBeenCalledWith("agent");
    expect(session.setConfigOption).toHaveBeenCalledWith("collaboration_mode", "plan");
  });
});

describe("AgentSessionManager default-model settings subscription", () => {
  async function flushApplyChain(): Promise<void> {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  }

  function makeApplySelectionDescriptor(applySelectionMock: jest.Mock): BackendDescriptor {
    return {
      id: "opencode",
      displayName: "opencode",
      getInstallState: jest.fn(() => ({ kind: "ready", source: "custom" })),
      subscribeInstallState: jest.fn(),
      openInstallUI: jest.fn(),
      createBackendProcess: jest.fn(() => makeMockBackendProcess()),
      wire: {
        encode: ({ baseModelId }: { baseModelId: string }) => baseModelId,
        decode: (id: string) => ({ selection: { baseModelId: id, effort: null }, provider: null }),
      },
      applySelection: applySelectionMock,
    } as unknown as BackendDescriptor;
  }

  function makeStubPreloader(catalog: BackendModelCatalog | null = null) {
    return {
      getCachedModelCatalog: jest.fn(() => catalog),
      preload: jest.fn(async () => undefined),
      subscribe: jest.fn(() => () => {}),
      shutdown: jest.fn(),
      clearCached: jest.fn(),
      takeWarm: jest.fn(() => null),
      getWarmProcs: jest.fn(() => []),
    };
  }

  it.each([
    { effort: null, confirmed: "low", expected: "low" },
    { effort: "removed", confirmed: "low", expected: "low" },
    { effort: "high", confirmed: "high", expected: undefined },
    { effort: "removed", confirmed: "high", expected: undefined },
  ])(
    "https://github.com/Brevilabs/obsidian-copilot-private/issues/219 repairs saved $effort only when the fallback is confirmed ($confirmed)",
    async ({ effort, confirmed, expected }) => {
      const settings = {
        agentMode: {
          activeBackend: "opencode",
          backends: { opencode: { defaultModel: { baseModelId: "opus", effort } } },
        },
      };
      (mockedGetSettings as jest.Mock).mockReturnValue(settings);
      (mockedSetSettings as jest.Mock).mockClear();
      const resolved = confirmed;
      sessionCreateSpy.mockImplementationOnce((opts) => {
        const session = makeMockSession({ internalId: opts.internalId, backendId: opts.backendId });
        jest.spyOn(session, "getState").mockReturnValue({
          model: {
            current: { baseModelId: "opus", effort: resolved },
            apply: { kind: "setModel" },
            availableModels: [
              {
                baseModelId: "opus",
                name: "Opus",
                provider: null,
                effortOptions: [
                  { value: "high", label: "High" },
                  { value: "low", label: "Low" },
                ],
              },
            ],
          },
          mode: null,
        });
        return session;
      });
      const descriptor = makeApplySelectionDescriptor(jest.fn());
      const mgr = new AgentSessionManager(
        buildApp(),
        buildPlugin() as unknown as ConstructorParameters<typeof AgentSessionManager>[1],
        {
          permissionPrompter: jest.fn(),
          resolveDescriptor: () => descriptor,
          modelPreloader: makeStubPreloader() as unknown as ConstructorParameters<
            typeof AgentSessionManager
          >[2]["modelPreloader"],
        }
      );
      await createShown(mgr);
      await flushApplyChain();
      expect(readPersistedDefault(mockedSetSettings as jest.Mock, "opencode")).toEqual(
        expected === undefined ? undefined : { baseModelId: "opus", effort: expected }
      );
      (mockedGetSettings as jest.Mock).mockReturnValue({
        agentMode: { activeBackend: "opencode", backends: {} },
      });
      await mgr.shutdown();
    }
  );

  it("re-applies a changed default to a live session on that backend", async () => {
    const applySelectionMock = jest.fn(async () => {});
    const descriptor = makeApplySelectionDescriptor(applySelectionMock);
    const mgr = new AgentSessionManager(
      buildApp(),
      buildPlugin() as unknown as ConstructorParameters<typeof AgentSessionManager>[1],
      {
        permissionPrompter: jest.fn(),
        resolveDescriptor: (id) => (id === descriptor.id ? descriptor : undefined),
        modelPreloader: makeStubPreloader() as unknown as ConstructorParameters<
          typeof AgentSessionManager
        >[2]["modelPreloader"],
      }
    );
    const session = await createShown(mgr);

    const prev = { agentMode: { backends: { opencode: { defaultModel: null } } } };
    const next = {
      agentMode: {
        backends: { opencode: { defaultModel: { baseModelId: "opus", effort: "high" } } },
      },
    };
    (mockedGetSettings as jest.Mock).mockReturnValue({
      agentMode: { activeBackend: "opencode", ...next.agentMode },
    });
    emitSettingsChange(prev, next);
    await flushApplyChain();

    expect(applySelectionMock).toHaveBeenCalledWith(session, {
      baseModelId: "opus",
      effort: "high",
    });
    (mockedGetSettings as jest.Mock).mockReturnValue({
      agentMode: { activeBackend: "opencode", backends: {} },
    });
  });

  it("ignores an unchanged default and other backends' changes", async () => {
    const applySelectionMock = jest.fn(async () => {});
    const descriptor = makeApplySelectionDescriptor(applySelectionMock);
    const mgr = new AgentSessionManager(
      buildApp(),
      buildPlugin() as unknown as ConstructorParameters<typeof AgentSessionManager>[1],
      {
        permissionPrompter: jest.fn(),
        resolveDescriptor: (id) => (id === descriptor.id ? descriptor : undefined),
        modelPreloader: makeStubPreloader() as unknown as ConstructorParameters<
          typeof AgentSessionManager
        >[2]["modelPreloader"],
      }
    );
    await createShown(mgr);

    const same = { baseModelId: "opus", effort: "high" };
    emitSettingsChange(
      { agentMode: { backends: { opencode: { defaultModel: same } } } },
      { agentMode: { backends: { opencode: { defaultModel: { ...same } } } } }
    );
    emitSettingsChange(
      { agentMode: { backends: { claude: { defaultModel: null } } } },
      { agentMode: { backends: { claude: { defaultModel: { baseModelId: "x", effort: null } } } } }
    );
    expect(applySelectionMock).not.toHaveBeenCalled();
  });

  it("leaves a live session unchanged when the explicit default is cleared", async () => {
    const applySelectionMock = jest.fn(async () => {});
    const descriptor = makeApplySelectionDescriptor(applySelectionMock);
    const catalog = modelCatalog("native");
    const mgr = new AgentSessionManager(
      buildApp(),
      buildPlugin() as unknown as ConstructorParameters<typeof AgentSessionManager>[1],
      {
        permissionPrompter: jest.fn(),
        resolveDescriptor: (id) => (id === descriptor.id ? descriptor : undefined),
        modelPreloader: makeStubPreloader(catalog) as unknown as ConstructorParameters<
          typeof AgentSessionManager
        >[2]["modelPreloader"],
      }
    );
    await createShown(mgr);

    const settingsReadsBeforeChange = (mockedGetSettings as jest.Mock).mock.calls.length;
    emitSettingsChange(
      {
        agentMode: {
          backends: { opencode: { defaultModel: { baseModelId: "opus", effort: "high" } } },
        },
      },
      { agentMode: { backends: { opencode: { defaultModel: null } } } }
    );
    await waitFor(() =>
      expect((mockedGetSettings as jest.Mock).mock.calls.length).toBeGreaterThan(
        settingsReadsBeforeChange
      )
    );
    expect(applySelectionMock).not.toHaveBeenCalled();
  });

  it("defers re-apply for a starting session until ready, using the latest default", async () => {
    const applySelectionMock = jest.fn(async () => {});
    const descriptor = makeApplySelectionDescriptor(applySelectionMock);
    let resolveReady: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    sessionCreateSpy.mockImplementationOnce((opts) => {
      const session = makeMockSession({ internalId: opts.internalId, backendId: opts.backendId });
      Object.defineProperty(session, "ready", { value: ready });
      getSessionTestHandle(session).setStatus("starting");
      return session;
    });
    const mgr = new AgentSessionManager(
      buildApp(),
      buildPlugin() as unknown as ConstructorParameters<typeof AgentSessionManager>[1],
      {
        permissionPrompter: jest.fn(),
        resolveDescriptor: (id) => (id === descriptor.id ? descriptor : undefined),
        modelPreloader: makeStubPreloader() as unknown as ConstructorParameters<
          typeof AgentSessionManager
        >[2]["modelPreloader"],
      }
    );
    const session = await createShown(mgr);

    const latest = { baseModelId: "opus", effort: "low" };
    (mockedGetSettings as jest.Mock).mockReturnValue({
      agentMode: { activeBackend: "opencode", backends: { opencode: { defaultModel: latest } } },
    });
    emitSettingsChange(
      {
        agentMode: {
          backends: { opencode: { defaultModel: { baseModelId: "opus", effort: "high" } } },
        },
      },
      { agentMode: { backends: { opencode: { defaultModel: latest } } } }
    );

    await flushApplyChain();
    expect(applySelectionMock).not.toHaveBeenCalled();

    resolveReady();
    await ready;
    await flushApplyChain();

    expect(applySelectionMock).toHaveBeenCalledWith(session, latest);
    (mockedGetSettings as jest.Mock).mockReturnValue({
      agentMode: { activeBackend: "opencode", backends: {} },
    });
  });

  it("serializes rapid default changes and commits the latest", async () => {
    const order: string[] = [];
    let resolveFirst: () => void = () => {};
    const applySelectionMock = jest.fn(
      async (_session: AgentSession, sel: { baseModelId: string }) => {
        order.push(sel.baseModelId);
        if (order.length === 1) await new Promise<void>((r) => (resolveFirst = r));
      }
    );
    const descriptor = makeApplySelectionDescriptor(applySelectionMock);
    const mgr = new AgentSessionManager(
      buildApp(),
      buildPlugin() as unknown as ConstructorParameters<typeof AgentSessionManager>[1],
      {
        permissionPrompter: jest.fn(),
        resolveDescriptor: (id) => (id === descriptor.id ? descriptor : undefined),
        modelPreloader: makeStubPreloader() as unknown as ConstructorParameters<
          typeof AgentSessionManager
        >[2]["modelPreloader"],
      }
    );
    await createShown(mgr);

    const first = { baseModelId: "first", effort: null };
    (mockedGetSettings as jest.Mock).mockReturnValue({
      agentMode: { activeBackend: "opencode", backends: { opencode: { defaultModel: first } } },
    });
    emitSettingsChange(
      { agentMode: { backends: { opencode: { defaultModel: null } } } },
      { agentMode: { backends: { opencode: { defaultModel: first } } } }
    );
    await flushApplyChain();

    const second = { baseModelId: "second", effort: null };
    (mockedGetSettings as jest.Mock).mockReturnValue({
      agentMode: { activeBackend: "opencode", backends: { opencode: { defaultModel: second } } },
    });
    emitSettingsChange(
      { agentMode: { backends: { opencode: { defaultModel: first } } } },
      { agentMode: { backends: { opencode: { defaultModel: second } } } }
    );
    await flushApplyChain();

    expect(order).toEqual(["first"]);
    resolveFirst();
    await flushApplyChain();

    expect(order).toEqual(["first", "second"]);
    (mockedGetSettings as jest.Mock).mockReturnValue({
      agentMode: { activeBackend: "opencode", backends: {} },
    });
  });
});

describe("AgentSessionManager.onInstallStateChanged", () => {
  function buildInstallStateManager(opts: {
    installState: InstallState;
    refreshResult?: Promise<void> | null;
  }) {
    let installState = opts.installState;
    const preloader = {
      getCachedModelCatalog: jest.fn(() => null),
      preload: jest.fn(async () => undefined),
      refresh: jest.fn(() => opts.refreshResult ?? null),
      subscribe: jest.fn(() => () => {}),
      shutdown: jest.fn(),
      clearCached: jest.fn(),
      takeWarm: jest.fn(() => null),
      getWarmProcs: jest.fn(() => []),
    };
    const descriptor = {
      ...buildDescriptor(),
      getInstallState: jest.fn(() => installState),
    } as unknown as BackendDescriptor;
    const mgr = new AgentSessionManager(
      buildApp(),
      buildPlugin() as unknown as ConstructorParameters<typeof AgentSessionManager>[1],
      {
        permissionPrompter: jest.fn(),
        resolveDescriptor: (id) => (id === descriptor.id ? descriptor : undefined),
        modelPreloader: preloader as unknown as ConstructorParameters<
          typeof AgentSessionManager
        >[2]["modelPreloader"],
      }
    );
    return { mgr, preloader, setInstallState: (state: InstallState) => (installState = state) };
  }

  it("preloads a freshly-installed backend that was never probed", async () => {
    const { mgr, preloader } = buildInstallStateManager({
      installState: { kind: "ready", source: "custom" },
    });

    await mgr.onInstallStateChanged("opencode");

    expect(preloader.preload).toHaveBeenCalledWith("opencode");
    expect(preloader.clearCached).not.toHaveBeenCalled();
    expect(mockBackendShutdown).not.toHaveBeenCalled();
  });

  it("refreshes a warm probe against the new binary without a fresh preload", async () => {
    const { mgr, preloader } = buildInstallStateManager({
      installState: { kind: "ready", source: "custom" },
      refreshResult: Promise.resolve(),
    });

    await mgr.onInstallStateChanged("opencode");

    expect(preloader.refresh).toHaveBeenCalledWith("opencode");
    expect(preloader.preload).not.toHaveBeenCalled();
  });

  it("restarts a live backend against the new binary", async () => {
    const { mgr, preloader } = buildInstallStateManager({
      installState: { kind: "ready", source: "custom" },
    });
    await createShown(mgr);
    mockBackendShutdown.mockClear();
    preloader.preload.mockClear();

    await mgr.onInstallStateChanged("opencode");

    expect(mockBackendShutdown).toHaveBeenCalled();
    expect(preloader.preload).toHaveBeenCalledWith("opencode");
  });

  it("tears down and drops the warm probe when the binary is no longer available", async () => {
    const { mgr, preloader, setInstallState } = buildInstallStateManager({
      installState: { kind: "ready", source: "custom" },
    });
    await createShown(mgr);
    mockBackendShutdown.mockClear();
    sessionCreateSpy.mockClear();

    setInstallState({ kind: "absent" });
    await mgr.onInstallStateChanged("opencode");

    expect(mockBackendShutdown).toHaveBeenCalled();
    expect(sessionCreateSpy).not.toHaveBeenCalled();
    expect(preloader.clearCached).toHaveBeenCalledWith("opencode");
    expect(preloader.preload).not.toHaveBeenCalled();
  });

  it("clears a settled preload status when the backend becomes absent", async () => {
    const { mgr, setInstallState } = buildInstallStateManager({
      installState: { kind: "ready", source: "custom" },
    });
    mgr.registerPreload("opencode", Promise.resolve());
    await Promise.resolve();
    expect(mgr.getPreloadStatus("opencode")).toBe("ready");

    setInstallState({ kind: "absent" });
    await mgr.onInstallStateChanged("opencode");

    expect(mgr.getPreloadStatus("opencode")).toBe("absent");
  });

  it("keeps the preload status when the backend becomes incompatible", async () => {
    const { mgr, setInstallState } = buildInstallStateManager({
      installState: { kind: "ready", source: "custom" },
    });
    mgr.registerPreload("opencode", Promise.resolve());
    await Promise.resolve();

    setInstallState({
      kind: "incompatible",
      source: "custom",
      currentVersion: "1.0.0",
      minVersion: "2.0.0",
      message: "too old",
    });
    await mgr.onInstallStateChanged("opencode");

    expect(mgr.getPreloadStatus("opencode")).toBe("ready");
  });

  it("keeps live and warm backend state while a compatibility check is in flight", async () => {
    const { mgr, preloader } = buildInstallStateManager({
      installState: { kind: "checking", source: "custom" },
    });
    await createShown(mgr);
    mockBackendShutdown.mockClear();

    await mgr.onInstallStateChanged("opencode");

    expect(mockBackendShutdown).not.toHaveBeenCalled();
    expect(preloader.clearCached).not.toHaveBeenCalled();
    expect(preloader.refresh).not.toHaveBeenCalled();
    expect(preloader.preload).not.toHaveBeenCalled();
  });
});

function readPersistedDefault(
  setSettings: jest.Mock,
  backendId: string
): { baseModelId: string; effort: string | null } | undefined {
  let backends: Record<string, { defaultModel?: { baseModelId: string; effort: string | null } }> =
    {};
  for (const call of setSettings.mock.calls) {
    const updater = call[0];
    if (typeof updater !== "function") continue;
    const patch = updater({ agentMode: { backends } });
    if (patch?.agentMode?.backends) {
      backends = { ...backends, ...patch.agentMode.backends };
    }
  }
  return backends[backendId]?.defaultModel;
}

describe("AgentSessionManager chat history aggregation", () => {
  const MockTFile = TFile as unknown as new (path: string) => TFile & {
    stat: { ctime: number; mtime: number };
  };

  interface FakeFrontmatter {
    epoch?: number;
    topic?: string;
    backendId?: string;
    sessionId?: string;
    lastAccessedAt?: number;
    projectId?: string;
  }

  function makeIndexStorage() {
    const files = new Map<string, string>();
    return {
      exists: async (p: string) => files.has(p),
      read: async (p: string) => {
        const content = files.get(p);
        if (content === undefined) throw new Error(`ENOENT: ${p}`);
        return content;
      },
      write: async (p: string, c: string) => {
        files.set(p, c);
      },
    };
  }

  function buildHistoryHarness(opts?: {
    files?: Record<string, FakeFrontmatter>;
    hiddenFiles?: Record<string, string>;
    listSessions?: jest.Mock;
    warmListSessions?: jest.Mock;
    warmSessionExistsLocally?: jest.Mock;
    probeSessionId?: string;
    summarizesSessionTitle?: boolean;
    backendId?: BackendId;
    installState?: InstallState;
    createBackendProcess?: jest.Mock;
    applyInitialSessionConfig?: BackendDescriptor["applyInitialSessionConfig"];
  }) {
    const frontmatterByPath = opts?.files ?? {};
    const hiddenByPath = opts?.hiddenFiles ?? {};
    const tfiles = [...Object.keys(frontmatterByPath), ...Object.keys(hiddenByPath)].map((p) => {
      const f = new MockTFile(p);
      f.stat = { ctime: 1_000, mtime: 1_000, size: 0 };
      return f;
    });
    const adapter = new (FileSystemAdapter as unknown as new (basePath: string) => unknown)(
      "/vault"
    ) as { read: jest.Mock };
    adapter.read.mockImplementation(async (p: string) => {
      const content = hiddenByPath[p];
      if (content === undefined) throw new Error(`ENOENT: ${p}`);
      return content;
    });
    const app = {
      vault: {
        adapter,
        getAbstractFileByPath: (p: string) =>
          tfiles.find((f: { path: string }) => f.path === p) ?? null,
        on: jest.fn(() => ({}) as never),
        offref: jest.fn(),
      },
      metadataCache: {
        getFileCache: (file: { path: string }) => {
          const fm = frontmatterByPath[file.path];
          return fm ? { frontmatter: fm } : null;
        },
        on: jest.fn(() => ({}) as never),
        offref: jest.fn(),
      },
    } as unknown as App;
    const plugin = {
      manifest: { version: "1.0.0" },
      getChatHistoryLastAccessedAtManager: () => ({
        getEffectiveLastUsedAt: (_path: string, fallback: number) => fallback,
      }),
    };
    const persistence = {
      getAgentChatHistoryFiles: jest.fn(async () => tfiles),
      updateTopic: jest.fn(async () => undefined),
      deleteFile: jest.fn(async () => undefined),
    };
    const index = new AgentSessionIndex(makeIndexStorage(), "plugins/copilot/index.json");
    const backendId = opts?.backendId ?? "opencode";
    const descriptor = {
      ...buildDescriptor(),
      id: backendId,
      getInstallState: jest.fn(() => opts?.installState ?? { kind: "ready", source: "custom" }),
      summarizesSessionTitle: opts?.summarizesSessionTitle ?? true,
      getProbeSessionId: jest.fn(() => opts?.probeSessionId),
      applyInitialSessionConfig: opts?.applyInitialSessionConfig,
    } as unknown as BackendDescriptor;
    if (opts?.createBackendProcess) {
      (descriptor as unknown as { createBackendProcess: jest.Mock }).createBackendProcess =
        opts.createBackendProcess;
    } else if (opts?.listSessions) {
      (descriptor as unknown as { createBackendProcess: jest.Mock }).createBackendProcess = jest.fn(
        () => ({ ...makeMockBackendProcess(), listSessions: opts.listSessions })
      );
    }
    const manager = new AgentSessionManager(
      app,
      plugin as unknown as ConstructorParameters<typeof AgentSessionManager>[1],
      {
        permissionPrompter: jest.fn(),
        resolveDescriptor: (id) => (id === backendId ? descriptor : undefined),
        modelPreloader: {
          getCachedModelCatalog: jest.fn(() => null),
          preload: jest.fn(async () => undefined),
          refresh: jest.fn(() => null),
          subscribe: jest.fn(() => () => {}),
          shutdown: jest.fn(),
          clearCached: jest.fn(),
          takeWarm: jest.fn(() => null),
          getWarmProcs: jest.fn(() => {
            if (!opts?.warmListSessions && !opts?.warmSessionExistsLocally) return [];
            const proc: Record<string, unknown> = { ...makeMockBackendProcess() };
            if (opts.warmListSessions) proc.listSessions = opts.warmListSessions;
            if (opts.warmSessionExistsLocally)
              proc.sessionExistsLocally = opts.warmSessionExistsLocally;
            return [{ backendId, proc }];
          }),
        } as unknown as ConstructorParameters<typeof AgentSessionManager>[2]["modelPreloader"],
        persistenceManager: persistence as unknown as ConstructorParameters<
          typeof AgentSessionManager
        >[2]["persistenceManager"],
        sessionIndex: index,
      }
    );
    return { manager, index, persistence, descriptor };
  }

  it("merges markdown and native entries, de-duplicated on backend session id", async () => {
    const { manager, index } = buildHistoryHarness({
      files: {
        "chats/agent__a.md": {
          epoch: 1_000,
          topic: "Saved chat",
          backendId: "opencode",
          sessionId: "s1",
          lastAccessedAt: 2_000,
        },
      },
    });
    await index.recordSession({
      backendId: "opencode",
      sessionId: "s1",
      title: "Saved chat",
      createdAtMs: 1_000,
      lastAccessedAtMs: 5_000,
    });
    await index.recordSession({
      backendId: "opencode",
      sessionId: "s2",
      title: "Native only chat",
      createdAtMs: 3_000,
      lastAccessedAtMs: 4_000,
    });

    const items = await manager.getChatHistoryItems();
    expect(items).toHaveLength(2);
    const markdown = items.find((i) => i.id === "chats/agent__a.md");
    expect(markdown).toBeDefined();
    expect(markdown?.lastAccessedAt.getTime()).toBe(5_000);
    const native = items.find((i) => i.id !== "chats/agent__a.md");
    expect(native?.id).toBe(buildNativeChatId("opencode", "s2"));
    expect(native?.title).toBe("Native only chat");
    expect(native?.backendId).toBe("opencode");
  });

  it("de-duplicates hidden-folder chats via the adapter frontmatter fallback", async () => {
    const { manager, index } = buildHistoryHarness({
      hiddenFiles: {
        ".copilot/chats/agent__hidden.md":
          '---\nepoch: 1000\nmode: agent\nbackendId: opencode\nsessionId: "s1"\n---\n\n**user**: hi',
      },
    });
    await index.recordSession({
      backendId: "opencode",
      sessionId: "s1",
      title: "Hidden twin",
      createdAtMs: 1_000,
      lastAccessedAtMs: 2_000,
    });
    const items = await manager.getChatHistoryItems();
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe(".copilot/chats/agent__hidden.md");
  });

  it("lists native sessions when no markdown notes exist (autosave off)", async () => {
    const { manager, index } = buildHistoryHarness();
    await index.recordSession({
      backendId: "codex",
      sessionId: "s9",
      title: "Codex chat",
      createdAtMs: 1_000,
      lastAccessedAtMs: 2_000,
    });
    const items = await manager.getChatHistoryItems();
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe(buildNativeChatId("codex", "s9"));
  });

  it("scopes a project view's native entries by the index's recorded projectId", async () => {
    const { manager, index } = buildHistoryHarness();
    await index.recordSession({
      backendId: "codex",
      sessionId: "in-project",
      title: "Project chat",
      createdAtMs: 1_000,
      lastAccessedAtMs: 2_000,
      projectId: "proj-1",
    });
    await index.recordSession({
      backendId: "codex",
      sessionId: "global-chat",
      title: "Global chat",
      createdAtMs: 1_000,
      lastAccessedAtMs: 2_000,
    });

    const projectItems = await manager.getChatHistoryItems("proj-1");
    expect(projectItems).toHaveLength(1);
    expect(projectItems[0]?.id).toBe(buildNativeChatId("codex", "in-project"));

    expect(await manager.getChatHistoryItems()).toHaveLength(2);
  });

  it("deleting a native entry tombstones it without touching persistence", async () => {
    const { manager, index, persistence } = buildHistoryHarness();
    await index.recordSession({
      backendId: "opencode",
      sessionId: "s1",
      title: "Doomed",
      createdAtMs: 1_000,
      lastAccessedAtMs: 2_000,
    });
    await manager.deleteChatHistory(buildNativeChatId("opencode", "s1"));
    expect(await manager.getChatHistoryItems()).toHaveLength(0);
    expect(await index.isTombstoned("opencode", "s1")).toBe(true);
    expect(persistence.deleteFile).not.toHaveBeenCalled();
  });

  it("deleting a markdown chat also tombstones its native twin", async () => {
    const { manager, index, persistence } = buildHistoryHarness({
      files: {
        "chats/agent__a.md": {
          epoch: 1_000,
          backendId: "opencode",
          sessionId: "s1",
        },
      },
    });
    await index.recordSession({
      backendId: "opencode",
      sessionId: "s1",
      title: "Twin",
      createdAtMs: 1_000,
      lastAccessedAtMs: 2_000,
    });
    await manager.deleteChatHistory("chats/agent__a.md");
    expect(persistence.deleteFile).toHaveBeenCalledWith("chats/agent__a.md");
    expect(await index.isTombstoned("opencode", "s1")).toBe(true);
  });

  it("renaming a native entry updates the index title", async () => {
    const { manager, index } = buildHistoryHarness();
    await index.recordSession({
      backendId: "opencode",
      sessionId: "s1",
      title: "Old title",
      createdAtMs: 1_000,
      lastAccessedAtMs: 2_000,
    });
    await manager.updateChatTitle(buildNativeChatId("opencode", "s1"), "New title");
    expect((await index.getEntry("opencode", "s1"))?.title).toBe("New title");
  });

  it("native rename matches the live session by backend, not session id alone", async () => {
    const { manager, index } = buildHistoryHarness();
    const live = await manager.createSession("opencode");
    const liveId = live.getBackendSessionId()!;
    await index.recordSession({
      backendId: "codex",
      sessionId: liveId,
      title: "Codex entry",
      createdAtMs: 1_000,
      lastAccessedAtMs: 2_000,
    });

    await manager.updateChatTitle(buildNativeChatId("codex", liveId), "Codex renamed");
    expect((await index.getEntry("codex", liveId))?.title).toBe("Codex renamed");
    expect(live.setLabel).not.toHaveBeenCalled();
  });

  describe("loadNativeSessionFromHistory()", () => {
    it("does not spawn or load history through an incompatible binary (https://github.com/Brevilabs/obsidian-copilot-private/issues/531)", async () => {
      const createBackendProcess = jest.fn(() => makeMockBackendProcess());
      const { manager } = buildHistoryHarness({
        installState: {
          kind: "incompatible",
          source: "custom",
          currentVersion: "1",
          minVersion: "2",
          message: "Upgrade required",
        },
        createBackendProcess,
      });
      await expect(manager.loadNativeSessionFromHistory("opencode", "saved-chat")).rejects.toThrow(
        "Could not resume"
      );
      expect(createBackendProcess).not.toHaveBeenCalled();
      expect(manager.getActiveSession()).toBeNull();
      expect(manager.getLastError()).toContain("Upgrade required");
    });
    it("matches live sessions by the (backendId, sessionId) pair, not session id alone", async () => {
      const { manager } = buildHistoryHarness();
      const session = await manager.createSession("opencode");
      const liveId = session.getBackendSessionId()!;

      await expect(manager.loadNativeSessionFromHistory("opencode", liveId)).resolves.toBe(session);

      await expect(manager.loadNativeSessionFromHistory("codex", liveId)).rejects.toThrow();
      expect(manager.getActiveSession()).toBe(session);
    });

    it("applies persisted backend config and mode before returning a resumed session", async () => {
      const backendState = (effort: string, mode: "default" | "auto"): BackendState => ({
        model: {
          current: { baseModelId: "sonnet", effort },
          availableModels: [],
          apply: { kind: "setModel" },
        },
        mode: {
          current: mode,
          options: [
            { value: "default", label: "Default" },
            { value: "auto", label: "Auto" },
          ],
          apply: {
            default: { kind: "setMode", nativeId: "default" },
            auto: { kind: "setMode", nativeId: "bypassPermissions" },
          },
        },
      });
      const setSessionConfigOption = jest.fn(async () => backendState("high", "default"));
      const setSessionMode = jest.fn(async () => backendState("high", "auto"));
      const backend = {
        ...makeMockBackendProcess(),
        loadSession: jest.fn(async () => {
          throw new MethodUnsupportedError("session/load");
        }),
        resumeSession: jest.fn(async ({ sessionId }: { sessionId: string }) => ({
          sessionId,
          state: backendState("low", "default"),
        })),
        setSessionConfigOption,
        setSessionMode,
      };
      let releaseApply: () => void = () => {};
      let markApplyStarted: () => void = () => {};
      const applyStarted = new Promise<void>((resolve) => {
        markApplyStarted = resolve;
      });
      const applyRelease = new Promise<void>((resolve) => {
        releaseApply = resolve;
      });
      const applyInitialSessionConfig = jest.fn(async (session: AgentSession) => {
        markApplyStarted();
        await applyRelease;
        await session.setConfigOption("effort", "high");
      });
      const { manager } = buildHistoryHarness({
        backendId: "claude",
        createBackendProcess: jest.fn(() => backend),
        applyInitialSessionConfig,
      });
      const settings = {
        agentMode: {
          activeBackend: "claude",
          backends: { claude: { defaultMode: "auto" } },
        },
      };
      const previousSettings = (mockedGetSettings as jest.Mock).getMockImplementation();
      (mockedGetSettings as jest.Mock).mockReturnValue(settings);

      let returned = false;
      const loading = manager
        .loadNativeSessionFromHistory("claude", "saved-chat")
        .then((session) => {
          returned = true;
          return session;
        });
      await applyStarted;
      await Promise.resolve();
      expect(returned).toBe(false);

      releaseApply();
      const session = await loading;

      expect(applyInitialSessionConfig).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ agentMode: expect.any(Object) })
      );
      expect(setSessionConfigOption).toHaveBeenCalledWith({
        sessionId: "saved-chat",
        configId: "effort",
        value: "high",
      });
      expect(setSessionMode).toHaveBeenCalledWith({
        sessionId: "saved-chat",
        modeId: "bypassPermissions",
      });
      expect(session.getState()?.model?.current.effort).toBe("high");
      expect(session.getState()?.mode?.current).toBe("auto");
      (mockedGetSettings as jest.Mock).mockImplementation(previousSettings);
    });

    it("keeps focus on the most recently opened history row when resumes finish out of order", async () => {
      const backend = {
        ...makeMockBackendProcess(),
        loadSession: jest.fn(async () => {
          throw new MethodUnsupportedError("session/load");
        }),
        resumeSession: jest.fn(async ({ sessionId }: { sessionId: string }) => ({
          sessionId,
          state: { model: null, mode: null },
        })),
      };
      let releaseFirst: () => void = () => {};
      let markFirstStarted: () => void = () => {};
      const firstStarted = new Promise<void>((resolve) => {
        markFirstStarted = resolve;
      });
      const firstRelease = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const applyInitialSessionConfig = jest.fn(async (session: AgentSession) => {
        if (session.getBackendSessionId() !== "first-chat") return;
        markFirstStarted();
        await firstRelease;
      });
      const { manager } = buildHistoryHarness({
        backendId: "claude",
        createBackendProcess: jest.fn(() => backend),
        applyInitialSessionConfig,
      });

      const firstLoading = manager.loadNativeSessionFromHistory("claude", "first-chat");
      await firstStarted;
      const second = await manager.loadNativeSessionFromHistory("claude", "second-chat");
      expect(manager.getActiveSession()).toBe(second);

      releaseFirst();
      const first = await firstLoading;

      expect(first).not.toBe(second);
      expect(manager.getSessions()).toHaveLength(2);
      expect(manager.getActiveSession()).toBe(second);
    });

    it("shares one in-flight resume when the same history row is opened twice", async () => {
      const resumeSession = jest.fn(async ({ sessionId }: { sessionId: string }) => ({
        sessionId,
        state: { model: null, mode: null },
      }));
      const backend = {
        ...makeMockBackendProcess(),
        loadSession: jest.fn(async () => {
          throw new MethodUnsupportedError("session/load");
        }),
        resumeSession,
      };
      let releaseApply: () => void = () => {};
      let markApplyStarted: () => void = () => {};
      const applyStarted = new Promise<void>((resolve) => {
        markApplyStarted = resolve;
      });
      const applyRelease = new Promise<void>((resolve) => {
        releaseApply = resolve;
      });
      const applyInitialSessionConfig = jest.fn(async () => {
        markApplyStarted();
        await applyRelease;
      });
      const { manager } = buildHistoryHarness({
        backendId: "claude",
        createBackendProcess: jest.fn(() => backend),
        applyInitialSessionConfig,
      });

      const firstLoading = manager.loadNativeSessionFromHistory("claude", "saved-chat");
      await applyStarted;
      const secondLoading = manager.loadNativeSessionFromHistory("claude", "saved-chat");
      releaseApply();
      const [first, second] = await Promise.all([firstLoading, secondLoading]);

      expect(first).toBe(second);
      expect(resumeSession).toHaveBeenCalledTimes(1);
      expect(applyInitialSessionConfig).toHaveBeenCalledTimes(1);
      expect(manager.getSessions()).toEqual([first]);
      expect(manager.getActiveSession()).toBe(first);
    });
  });

  it("hides a markdown chat whose backend session is absent on this device", async () => {
    const sessionExistsLocally = jest.fn(
      async ({ sessionId }: { sessionId: string }) => sessionId === "local"
    );
    const { manager } = buildHistoryHarness({
      files: {
        "chats/agent__local.md": {
          epoch: 2_000,
          topic: "Made here",
          backendId: "opencode",
          sessionId: "local",
        },
        "chats/agent__foreign.md": {
          epoch: 1_000,
          topic: "Made elsewhere",
          backendId: "opencode",
          sessionId: "foreign",
        },
      },
      warmSessionExistsLocally: sessionExistsLocally,
    });

    const titles = (await manager.getChatHistoryItems()).map((i) => i.title);
    expect(titles).toContain("Made here");
    expect(titles).not.toContain("Made elsewhere");
    expect(sessionExistsLocally).toHaveBeenCalledWith({ sessionId: "foreign", cwd: "/vault" });
  });

  it("probes a project chat's resumability with its project cwd, not the vault root", async () => {
    projectsState.updateCachedProjectRecords([
      {
        project: { id: "proj-1" },
        filePath: "Projects/proj-1/project.md",
        folderName: "proj-1",
      } as unknown as ProjectFileRecord,
    ]);
    try {
      const sessionExistsLocally = jest.fn(
        async ({ cwd }: { cwd: string }) => cwd === join("/vault", "Projects", "proj-1")
      );
      const { manager } = buildHistoryHarness({
        files: {
          "chats/agent__p.md": {
            epoch: 2_000,
            topic: "Project chat",
            backendId: "opencode",
            sessionId: "proj-sess",
            projectId: "proj-1",
          },
        },
        warmSessionExistsLocally: sessionExistsLocally,
      });

      const titles = (await manager.getChatHistoryItems("proj-1")).map((i) => i.title);
      expect(titles).toContain("Project chat");
      expect(sessionExistsLocally).toHaveBeenCalledWith({
        sessionId: "proj-sess",
        cwd: join("/vault", "Projects", "proj-1"),
      });
    } finally {
      projectsState.updateCachedProjectRecords([]);
    }
  });

  it("probes each chat with its own scope cwd in the global flat view", async () => {
    projectsState.updateCachedProjectRecords([
      {
        project: { id: "proj-1" },
        filePath: "Projects/proj-1/project.md",
        folderName: "proj-1",
      } as unknown as ProjectFileRecord,
    ]);
    try {
      const sessionExistsLocally = jest.fn(async () => true);
      const { manager } = buildHistoryHarness({
        files: {
          "chats/agent__g.md": {
            epoch: 2_000,
            topic: "Global chat",
            backendId: "opencode",
            sessionId: "g-sess",
          },
          "chats/agent__p.md": {
            epoch: 1_000,
            topic: "Project chat",
            backendId: "opencode",
            sessionId: "p-sess",
            projectId: "proj-1",
          },
        },
        warmSessionExistsLocally: sessionExistsLocally,
      });

      const titles = (await manager.getChatHistoryItems()).map((i) => i.title);
      expect(titles).toEqual(expect.arrayContaining(["Global chat", "Project chat"]));
      expect(sessionExistsLocally).toHaveBeenCalledWith({ sessionId: "g-sess", cwd: "/vault" });
      expect(sessionExistsLocally).toHaveBeenCalledWith({
        sessionId: "p-sess",
        cwd: join("/vault", "Projects", "proj-1"),
      });
    } finally {
      projectsState.updateCachedProjectRecords([]);
    }
  });

  it("still hides a genuinely non-resumable project chat (probed against its project cwd)", async () => {
    projectsState.updateCachedProjectRecords([
      {
        project: { id: "proj-1" },
        filePath: "Projects/proj-1/project.md",
        folderName: "proj-1",
      } as unknown as ProjectFileRecord,
    ]);
    try {
      const sessionExistsLocally = jest.fn(async () => false);
      const { manager, index } = buildHistoryHarness({
        files: {
          "chats/agent__p.md": {
            epoch: 2_000,
            topic: "Foreign project chat",
            backendId: "opencode",
            sessionId: "foreign-proj",
            projectId: "proj-1",
          },
        },
        warmSessionExistsLocally: sessionExistsLocally,
      });
      await index.recordSession({
        backendId: "opencode",
        sessionId: "foreign-proj",
        title: "Twin",
        createdAtMs: 1_000,
        lastAccessedAtMs: 2_000,
        projectId: "proj-1",
      });

      const titles = (await manager.getChatHistoryItems("proj-1")).map((i) => i.title);
      expect(titles).not.toContain("Foreign project chat");
      expect(sessionExistsLocally).toHaveBeenCalledWith({
        sessionId: "foreign-proj",
        cwd: join("/vault", "Projects", "proj-1"),
      });
      expect(await index.isTombstoned("opencode", "foreign-proj")).toBe(true);
    } finally {
      projectsState.updateCachedProjectRecords([]);
    }
  });

  it("tombstones the native twin of a dropped non-local markdown chat", async () => {
    const sessionExistsLocally = jest.fn(async () => false);
    const { manager, index } = buildHistoryHarness({
      files: {
        "chats/agent__foreign.md": {
          epoch: 1_000,
          topic: "Made elsewhere",
          backendId: "opencode",
          sessionId: "foreign",
        },
      },
      warmSessionExistsLocally: sessionExistsLocally,
    });
    await index.recordSession({
      backendId: "opencode",
      sessionId: "foreign",
      title: "Made elsewhere",
      createdAtMs: 1_000,
      lastAccessedAtMs: 2_000,
    });

    const items = await manager.getChatHistoryItems();
    expect(items).toHaveLength(0);
    expect(await index.isTombstoned("opencode", "foreign")).toBe(true);
  });

  it("keeps markdown chats when no running backend can confirm the session is absent", async () => {
    const { manager } = buildHistoryHarness({
      files: {
        "chats/agent__a.md": {
          epoch: 1_000,
          topic: "Unknowable",
          backendId: "opencode",
          sessionId: "s1",
        },
      },
    });
    const titles = (await manager.getChatHistoryItems()).map((i) => i.title);
    expect(titles).toContain("Unknowable");
  });

  it("sweeps the preloader's warm probe procs before any chat starts a backend", async () => {
    const warmListSessions = jest.fn(async () => ({
      sessions: [
        {
          sessionId: "pre-existing",
          cwd: "/vault",
          title: "Chat from before this app session",
          updatedAt: new Date(6_000).toISOString(),
        },
      ],
    }));
    const { manager } = buildHistoryHarness({ warmListSessions });
    const items = await manager.getChatHistoryItems();
    expect(warmListSessions).toHaveBeenCalledWith({ cwd: "/vault" });
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe(buildNativeChatId("opencode", "pre-existing"));
  });

  it("sweeps running backends' listSessions into history, scoped to the vault cwd", async () => {
    const listSessions = jest.fn(async () => ({
      sessions: [
        {
          sessionId: "in-vault",
          cwd: "/vault",
          title: "Real chat",
          updatedAt: new Date(7_000).toISOString(),
        },
        { sessionId: "other-vault", cwd: "/elsewhere", title: "Foreign chat", updatedAt: null },
        { sessionId: "untitled", cwd: "/vault", title: null, updatedAt: null },
        { sessionId: "placeholder", cwd: "/vault", title: "New session - 1", updatedAt: null },
        { sessionId: "probe-1", cwd: "/vault", title: "Probe", updatedAt: null },
      ],
    }));
    const { manager } = buildHistoryHarness({ listSessions, probeSessionId: "probe-1" });
    await manager.createSession("opencode");

    const items = await manager.getChatHistoryItems();
    expect(listSessions).toHaveBeenCalledWith({ cwd: "/vault" });
    const native = items.filter((i) => i.id.startsWith("copilot-agent-session://"));
    expect(native).toHaveLength(1);
    expect(native[0]?.id).toBe(buildNativeChatId("opencode", "in-vault"));
    expect(native[0]?.title).toBe("Real chat");
    expect(native[0]?.lastAccessedAt.getTime()).toBe(7_000);
  });

  it("skips native title discovery for non-summarizing backends (codex)", async () => {
    const listSessions = jest.fn(async () => ({
      sessions: [
        {
          sessionId: "ctx-leak",
          cwd: "/vault",
          title: "<copilot-context> The user attached the following vault items",
          updatedAt: null,
        },
      ],
    }));
    const { manager } = buildHistoryHarness({ listSessions, summarizesSessionTitle: false });
    await manager.createSession("opencode");

    const items = await manager.getChatHistoryItems();
    expect(listSessions).not.toHaveBeenCalled();
    expect(items.filter((i) => i.id.startsWith("copilot-agent-session://"))).toHaveLength(0);
  });
});

describe("AgentSessionManager.enterProject MRU touch", () => {
  const PROJECT_ID = "proj-mru";
  let recordSpy: jest.SpyInstance;

  beforeEach(() => {
    mockTouchProjectLastUsed.mockClear();
    ensureAgentsFileForDiscoverySpy.mockClear();
    (ProjectFileManager.getInstance as jest.Mock).mockClear();
    recordSpy = jest
      .spyOn(projectsState, "getCachedProjectRecordById")
      .mockImplementation((id: string) =>
        id === PROJECT_ID
          ? ({
              filePath: "Projects/proj-mru/project.md",
              project: { id: PROJECT_ID },
            } as unknown as ReturnType<typeof projectsState.getCachedProjectRecordById>)
          : undefined
      );
  });

  afterEach(() => recordSpy.mockRestore());

  it("touches last-used after a successful enter that spawns a session", async () => {
    const mgr = buildManager();
    await mgr.enterProject(PROJECT_ID);
    expect(ProjectFileManager.getInstance).toHaveBeenCalled();
    expect(mockTouchProjectLastUsed).toHaveBeenCalledWith(PROJECT_ID);
  });

  it("ensures vault-root instruction discovery before a project session, not just global", async () => {
    const mgr = buildManager();
    await mgr.enterProject(PROJECT_ID);
    expect(ensureAgentsFileForDiscoverySpy).toHaveBeenCalledWith(expect.anything(), "", "");
    expect(ensureAgentsFileForDiscoverySpy).toHaveBeenCalledWith(
      expect.anything(),
      "Projects/proj-mru",
      ""
    );
  });

  it("touches last-used on the restored-session path (no re-spawn)", async () => {
    const mgr = buildManager();
    await mgr.enterProject(PROJECT_ID);
    await mgr.exitProject();
    mockTouchProjectLastUsed.mockClear();
    sessionCreateSpy.mockClear();

    await mgr.enterProject(PROJECT_ID);

    expect(sessionCreateSpy).not.toHaveBeenCalled();
    expect(mockTouchProjectLastUsed).toHaveBeenCalledWith(PROJECT_ID);
  });

  it("does not touch when returning to the global scope", async () => {
    const mgr = buildManager();
    await mgr.enterProject(PROJECT_ID);
    mockTouchProjectLastUsed.mockClear();

    await mgr.exitProject();

    expect(mockTouchProjectLastUsed).not.toHaveBeenCalled();
  });

  it("does not touch a re-click of the already-active project", async () => {
    const mgr = buildManager();
    await mgr.enterProject(PROJECT_ID);
    mockTouchProjectLastUsed.mockClear();

    await mgr.enterProject(PROJECT_ID);

    expect(mockTouchProjectLastUsed).not.toHaveBeenCalled();
  });

  it("does not touch when the spawn fails", async () => {
    const mgr = buildManager();
    mockBackendStart.mockRejectedValueOnce(new Error("spawn boom"));

    await expect(mgr.enterProject(PROJECT_ID)).rejects.toThrow();

    expect(mockTouchProjectLastUsed).not.toHaveBeenCalled();
  });

  it("touches only the current scope when another enter wins the spawn race", async () => {
    const OTHER_ID = "proj-other";
    recordSpy.mockImplementation((id: string) =>
      id === PROJECT_ID || id === OTHER_ID
        ? { filePath: `Projects/${id}/project.md`, project: { id } }
        : undefined
    );
    const mgr = buildManager();

    const enterStale = mgr.enterProject(PROJECT_ID);
    const enterWinner = mgr.enterProject(OTHER_ID);
    await Promise.all([enterStale, enterWinner]);

    expect(mockTouchProjectLastUsed).toHaveBeenCalledWith(OTHER_ID);
    expect(mockTouchProjectLastUsed).not.toHaveBeenCalledWith(PROJECT_ID);
  });

  it("rolls the active scope back when a cross-scope history load fails to resume", async () => {
    const mgr = buildManager();
    await mgr.enterProject(PROJECT_ID);
    const projectSession = mgr.getActiveSession();
    expect(mgr.getActiveProjectId()).toBe(PROJECT_ID);

    await expect(mgr.loadNativeSessionFromHistory("codex", "missing")).rejects.toThrow();

    expect(mgr.getActiveProjectId()).toBe(PROJECT_ID);
    expect(mgr.getActiveSession()).toBe(projectSession);
  });

  it("rolls the entered scope back when its auto-spawn fails", async () => {
    const OTHER_ID = "proj-other-fail";
    recordSpy.mockImplementation((id: string) =>
      id === PROJECT_ID || id === OTHER_ID
        ? { filePath: `Projects/${id}/project.md`, project: { id } }
        : undefined
    );
    const mgr = buildManager();
    await mgr.enterProject(PROJECT_ID);
    const projectSession = mgr.getActiveSession();
    expect(mgr.getActiveProjectId()).toBe(PROJECT_ID);

    sessionCreateSpy.mockImplementationOnce(() => {
      throw new Error("spawn boom");
    });
    await expect(mgr.enterProject(OTHER_ID)).rejects.toThrow();

    expect(mgr.getActiveProjectId()).toBe(PROJECT_ID);
    expect(mgr.getActiveSession()).toBe(projectSession);
  });
});

describe("AgentSessionManager fresh-visit tab detach", () => {
  const PROJECT_ID = "proj-detach";
  let recordSpy: jest.SpyInstance;

  beforeEach(() => {
    sessionCreateSpy.mockClear();
    recordSpy = jest
      .spyOn(projectsState, "getCachedProjectRecordById")
      .mockImplementation((id: string) =>
        id === PROJECT_ID
          ? ({
              filePath: "Projects/proj-detach/project.md",
              project: { id: PROJECT_ID },
            } as unknown as ReturnType<typeof projectsState.getCachedProjectRecordById>)
          : undefined
      );
  });

  afterEach(() => recordSpy.mockRestore());

  async function enterWithConversation(mgr: AgentSessionManager): Promise<AgentSession> {
    await mgr.enterProject(PROJECT_ID);
    const session = mgr.getActiveSession();
    if (!session) throw new Error("expected an active session after enter");
    getSessionTestHandle(session).setHasUserVisibleMessages(true);
    await mgr.exitProject();
    return session;
  }

  it("detaches a conversational session on re-entry and spawns a fresh one", async () => {
    const mgr = buildManager();
    const old = await enterWithConversation(mgr);

    sessionCreateSpy.mockClear();
    await mgr.enterProject(PROJECT_ID);

    expect(sessionCreateSpy).toHaveBeenCalledTimes(1);
    const visible = mgr.getSessionsForScope(PROJECT_ID);
    expect(visible).toHaveLength(1);
    expect(visible[0].internalId).not.toBe(old.internalId);
    expect(mgr.getSessionsForScope(PROJECT_ID)).not.toContain(old);
    expect(mgr.getSessions()).toContain(old);
  });

  it("does not reuse an error-state landing; spawns a fresh session instead", async () => {
    const mgr = buildManager();
    await mgr.enterProject(PROJECT_ID);
    const landing = mgr.getActiveSession();
    if (!landing) throw new Error("expected a landing session");
    getSessionTestHandle(landing).setStatus("error");
    await mgr.exitProject();

    sessionCreateSpy.mockClear();
    await mgr.enterProject(PROJECT_ID);

    expect(sessionCreateSpy).toHaveBeenCalledTimes(1);
    expect(mgr.getActiveSession()).not.toBe(landing);
  });

  it("reuses an empty landing session instead of stacking a blank tab", async () => {
    const mgr = buildManager();
    await mgr.enterProject(PROJECT_ID);
    const landing = mgr.getActiveSession();
    await mgr.exitProject();

    sessionCreateSpy.mockClear();
    await mgr.enterProject(PROJECT_ID);

    expect(sessionCreateSpy).not.toHaveBeenCalled();
    expect(mgr.getActiveSession()).toBe(landing);
    expect(mgr.getSessionsForScope(PROJECT_ID)).toHaveLength(1);
  });

  it("keeps a detached running session in getRunningChatIds (history spinner)", async () => {
    const mgr = buildManager();
    const old = await enterWithConversation(mgr);
    getSessionTestHandle(old).setStatus("running");

    await mgr.enterProject(PROJECT_ID);

    expect(mgr.getSessionsForScope(PROJECT_ID)).not.toContain(old);
    expect(mgr.getRunningChatIds().size).toBeGreaterThan(0);
  });

  it("keeps a detached needs-attention session in getAttentionChatIds (history dot)", async () => {
    const mgr = buildManager();
    const old = await enterWithConversation(mgr);
    old.markNeedsAttention();

    await mgr.enterProject(PROJECT_ID);

    expect(mgr.getSessionsForScope(PROJECT_ID)).not.toContain(old);
    expect(mgr.getAttentionChatIds().size).toBeGreaterThan(0);
  });

  it("re-attaches a detached session when it is opened from history", async () => {
    const mgr = buildManager();
    const old = await enterWithConversation(mgr);
    await mgr.enterProject(PROJECT_ID);
    expect(mgr.getSessionsForScope(PROJECT_ID)).not.toContain(old);

    await mgr.loadNativeSessionFromHistory(old.backendId, old.getBackendSessionId()!);

    expect(mgr.getSessionsForScope(PROJECT_ID)).toContain(old);
    expect(mgr.getActiveSession()).toBe(old);
  });

  it("closeSession picks a visible neighbor, never a detached session", async () => {
    const mgr = buildManager();
    const old = await enterWithConversation(mgr);
    await mgr.enterProject(PROJECT_ID);
    const fresh = mgr.getActiveSession();
    if (!fresh) throw new Error("expected a fresh active session");

    await mgr.closeSession(fresh.internalId);

    expect(mgr.getActiveSession()).not.toBe(old);
  });
});

describe("AgentSessionManager context-source dirty tracking", () => {
  const PID = "proj-dirty";

  function makeRecord(
    contextSource: ProjectConfig["contextSource"],
    usageTimestamps = 0,
    systemPrompt = ""
  ): ProjectFileRecord {
    return {
      project: {
        id: PID,
        name: PID,
        systemPrompt,
        projectModelKey: "",
        modelConfigs: {},
        contextSource,
        created: 0,
        UsageTimestamps: usageTimestamps,
      },
      filePath: `Projects/${PID}/project.md`,
      folderName: PID,
    };
  }

  function publish(record: ProjectFileRecord): void {
    projectsState.updateCachedProjectRecords([record]);
  }

  const flushAsync = () => new Promise((resolve) => window.setTimeout(resolve, 0));

  const builtManagers: AgentSessionManager[] = [];
  function buildTrackedManager(): AgentSessionManager {
    const mgr = buildManager();
    builtManagers.push(mgr);
    return mgr;
  }

  beforeEach(() => {
    mockEnsureMaterialized.mockClear();
    sessionCreateSpy.mockClear();
    projectsState.updateCachedProjectRecords([]);
  });

  afterEach(async () => {
    await Promise.all(builtManagers.splice(0).map((mgr) => mgr.shutdown().catch(() => {})));
    projectsState.updateCachedProjectRecords([]);
  });

  it("marks an inactive project dirty so re-entry detaches the stale empty landing and respawns", async () => {
    publish(makeRecord({ webUrls: "https://a.com" }));
    const mgr = buildTrackedManager();

    await mgr.enterProject(PID);
    const landing = mgr.getActiveSession();
    if (!landing) throw new Error("expected a landing session");
    await mgr.exitProject();

    publish(makeRecord({ webUrls: "https://a.com\nhttps://b.com" }));

    sessionCreateSpy.mockClear();
    await mgr.enterProject(PID);

    expect(sessionCreateSpy).toHaveBeenCalledTimes(1);
    const visible = mgr.getSessionsForScope(PID);
    expect(visible).toHaveLength(1);
    expect(visible[0]).not.toBe(landing);
    expect(mgr.getSessionsForScope(PID)).not.toContain(landing);
  });

  it("clears dirty once a fresh session captured the new sources (later re-entry reuses)", async () => {
    publish(makeRecord({ webUrls: "https://a.com" }));
    const mgr = buildTrackedManager();
    await mgr.enterProject(PID);
    await mgr.exitProject();

    publish(makeRecord({ webUrls: "https://a.com\nhttps://b.com" }));
    await mgr.enterProject(PID);
    await flushAsync();
    const fresh = mgr.getActiveSession();
    await mgr.exitProject();

    sessionCreateSpy.mockClear();
    await mgr.enterProject(PID);

    expect(sessionCreateSpy).not.toHaveBeenCalled();
    expect(mgr.getActiveSession()).toBe(fresh);
  });

  it("keeps a project dirty when the fresh session fails to start (ready rejects)", async () => {
    publish(makeRecord({ webUrls: "https://a.com" }));
    const mgr = buildTrackedManager();
    await mgr.enterProject(PID);
    await flushAsync();
    await mgr.exitProject();

    publish(makeRecord({ webUrls: "https://a.com\nhttps://b.com" }));

    sessionCreateSpy.mockImplementationOnce((opts) => {
      const rejected = Promise.reject(new Error("startup boom"));
      rejected.catch(() => {});
      return makeMockSession({
        internalId: opts.internalId,
        backendId: opts.backendId,
        projectId: opts.projectId,
        ready: rejected,
      });
    });
    await mgr.enterProject(PID);
    await flushAsync();
    await mgr.exitProject();

    sessionCreateSpy.mockClear();
    await mgr.enterProject(PID);
    expect(sessionCreateSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps a project dirty when the create captured an older signature (single-flight race)", async () => {
    publish(makeRecord({ webUrls: "https://a.com" }));
    const mgr = buildTrackedManager();
    await mgr.enterProject(PID);
    await mgr.exitProject();

    publish(makeRecord({ webUrls: "https://a.com\nhttps://b.com" }));

    const v1Signature = getProjectContextSignature(makeRecord({ webUrls: "https://a.com" }));
    mockEnsureMaterialized.mockImplementationOnce(async () => ({
      additionalDirectories: [],
      contextSignature: v1Signature,
    }));

    await mgr.enterProject(PID);
    await flushAsync();
    await mgr.exitProject();

    sessionCreateSpy.mockClear();
    await mgr.enterProject(PID);
    expect(sessionCreateSpy).toHaveBeenCalledTimes(1);
  });

  it("ignores a usage-timestamp-only touch (no dirty, empty landing still reused)", async () => {
    publish(makeRecord({ webUrls: "https://a.com" }));
    const mgr = buildTrackedManager();
    await mgr.enterProject(PID);
    const landing = mgr.getActiveSession();
    await mgr.exitProject();

    publish(makeRecord({ webUrls: "https://a.com" }, 12345));

    sessionCreateSpy.mockClear();
    await mgr.enterProject(PID);

    expect(sessionCreateSpy).not.toHaveBeenCalled();
    expect(mgr.getActiveSession()).toBe(landing);
  });

  it("does not reuse an empty landing after a System-Prompt-only edit", async () => {
    publish(makeRecord({ webUrls: "https://a.com" }, 0, "old instructions"));
    const mgr = buildTrackedManager();
    await mgr.enterProject(PID);
    const landing = mgr.getActiveSession();
    if (!landing) throw new Error("expected a landing session");
    await mgr.exitProject();

    publish(makeRecord({ webUrls: "https://a.com" }, 0, "new instructions"));

    sessionCreateSpy.mockClear();
    await mgr.enterProject(PID);

    expect(sessionCreateSpy).toHaveBeenCalledTimes(1);
    expect(mgr.getActiveSession()).not.toBe(landing);
  });

  it("rematerializeContext forces a retry of known-bad sources", async () => {
    publish(makeRecord({ webUrls: "https://a.com" }));
    const mgr = buildTrackedManager();
    await mgr.enterProject(PID);
    await flushAsync();
    mockEnsureMaterialized.mockClear();

    const started = mgr.rematerializeContext(PID);
    await flushAsync();

    expect(started).toBe(true);
    expect(mockEnsureMaterialized).toHaveBeenCalledTimes(1);
    expect(mockEnsureMaterialized.mock.calls[0][4]).toBe(true);
  });

  it("rematerializeContext early-exits while a run already owns the load atom", async () => {
    publish(makeRecord({ webUrls: "https://a.com" }));
    const mgr = buildTrackedManager();
    await mgr.enterProject(PID);
    await flushAsync();
    mockEnsureMaterialized.mockClear();

    const getMock = jest.requireMock("@/settings/model").settingsStore.get as jest.Mock;
    getMock.mockReturnValueOnce({ [PID]: { phase: "prefetch", blocking: true } });

    const started = mgr.rematerializeContext(PID);

    expect(started).toBe(false);
    expect(mockEnsureMaterialized).not.toHaveBeenCalled();
  });

  it("warms the active project's cache on a source edit without gating the composer", async () => {
    publish(makeRecord({ webUrls: "https://a.com" }));
    const mgr = buildTrackedManager();
    await mgr.enterProject(PID);
    await flushAsync();

    mockEnsureMaterialized.mockClear();
    const settingsStoreSet = jest.requireMock("@/settings/model").settingsStore.set as jest.Mock;
    settingsStoreSet.mockClear();

    publish(makeRecord({ webUrls: "https://a.com\nhttps://b.com" }));

    expect(mockEnsureMaterialized).toHaveBeenCalledTimes(1);
    expect(settingsStoreSet).not.toHaveBeenCalled();
  });

  it("stops reacting to record changes after shutdown", async () => {
    publish(makeRecord({ webUrls: "https://a.com" }));
    const mgr = buildTrackedManager();
    await mgr.enterProject(PID);
    await mgr.shutdown();

    mockEnsureMaterialized.mockClear();
    expect(() => publish(makeRecord({ webUrls: "https://a.com\nhttps://b.com" }))).not.toThrow();
    expect(mockEnsureMaterialized).not.toHaveBeenCalled();
  });

  it("publishes processingSources + incremental failedSources during a run, clears at done", async () => {
    publish(makeRecord({ webUrls: "https://a.com" }));
    const mgr = buildTrackedManager();
    const setMock = jest.requireMock("@/settings/model").settingsStore.set as jest.Mock;
    const latest = (): AgentProjectContextLoadState | undefined => {
      for (let i = setMock.mock.calls.length - 1; i >= 0; i--) {
        const [atom, updater] = setMock.mock.calls[i];
        if (atom !== agentProjectContextLoadAtom || typeof updater !== "function") continue;
        const next = updater({}) as Record<string, AgentProjectContextLoadState>;
        if (next[PID]) return next[PID];
      }
      return undefined;
    };

    let drive!: (p: ContextMaterializeProgress) => void;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockEnsureMaterialized.mockImplementationOnce(
      async (
        _app: unknown,
        _pid: string,
        _cwd: string,
        onProgress: (p: ContextMaterializeProgress) => void
      ) => {
        drive = onProgress;
        onProgress({ phase: "prefetch", done: 0, total: 1 });
        onProgress({ phase: "itemStart", item: { kind: "web", source: "https://a.com" } });
        await gate;
        return { additionalDirectories: [] };
      }
    );

    const entering = mgr.enterProject(PID);
    await flushAsync();

    expect(latest()).toMatchObject({
      phase: "prefetch",
      blocking: true,
      processingSources: [{ kind: "web", source: "https://a.com" }],
    });

    drive({
      phase: "itemFailed",
      item: { kind: "web", source: "https://a.com" },
      failure: { kind: "web", source: "https://a.com", error: "boom", usedStaleSnapshot: false },
    });
    const afterFail = latest()!;
    expect(afterFail.processingSources).toBeUndefined();
    expect(afterFail.failedSources).toEqual([
      { path: "https://a.com", type: "web", error: "boom", usedStaleSnapshot: false },
    ]);

    release();
    await entering;
    await flushAsync();
    expect(latest()).toMatchObject({ phase: "done", blocking: false });
    expect(latest()!.processingSources).toBeUndefined();
  });

  it("a content change marks the project dirty and blocks empty-landing reuse", async () => {
    publish(makeRecord({ webUrls: "https://a.com" }));
    const mgr = buildTrackedManager();
    await mgr.enterProject(PID);
    const landing = mgr.getActiveSession();
    if (!landing) throw new Error("expected a landing session");
    await flushAsync();
    await mgr.exitProject();

    (mgr as unknown as { markProjectContextDirty: (id: string) => void }).markProjectContextDirty(
      PID
    );

    sessionCreateSpy.mockClear();
    await mgr.enterProject(PID);

    expect(sessionCreateSpy).toHaveBeenCalledTimes(1);
    expect(mgr.getActiveSession()).not.toBe(landing);
  });

  it("wires the update hooks into a PROJECT session but not a GLOBAL one", async () => {
    publish(makeRecord({ webUrls: "https://a.com" }));
    const mgr = buildTrackedManager();

    sessionCreateSpy.mockClear();
    await mgr.enterProject(PID);
    const projectOpts = sessionCreateSpy.mock.calls[0][0];
    expect(typeof projectOpts.getProjectContextUpdates).toBe("function");
    expect(typeof projectOpts.markProjectContextUpdatesDelivered).toBe("function");

    await mgr.exitProject();
    sessionCreateSpy.mockClear();
    await createShown(mgr);
    const globalOpts = sessionCreateSpy.mock.calls[0][0];
    expect(globalOpts.getProjectContextUpdates).toBeUndefined();
    expect(globalOpts.markProjectContextUpdatesDelivered).toBeUndefined();
  });

  it("getProjectContextUpdates flushes, returns the note when behind, then null once acked", () => {
    const mgr = buildTrackedManager();
    const tracker = (mgr as unknown as { contentTracker: ProjectContentTracker }).contentTracker;
    const flushSpy = jest.spyOn(tracker, "flushNow");
    jest.spyOn(tracker, "getEpoch").mockReturnValue(3);
    const m = mgr as unknown as {
      getProjectContextUpdates: (
        id: string,
        pid: string
      ) => { epoch: number; block: string } | null;
      markProjectContextUpdatesDelivered: (id: string, epoch: number) => void;
    };

    const first = m.getProjectContextUpdates("s1", PID);
    expect(flushSpy).toHaveBeenCalled();
    expect(first?.epoch).toBe(3);
    expect(first?.block).toContain("<project_context_updates>");

    m.markProjectContextUpdatesDelivered("s1", 3);
    expect(m.getProjectContextUpdates("s1", PID)).toBeNull();

    expect(m.getProjectContextUpdates("s2", GLOBAL_SCOPE)).toBeNull();
  });

  it("advances the epoch on a config-source change so an ongoing session gets the note", async () => {
    publish(makeRecord({ webUrls: "https://a.com" }));
    const mgr = buildTrackedManager();
    await mgr.enterProject(PID);
    const session = mgr.getActiveSession();
    if (!session) throw new Error("expected a landing session");
    await flushAsync();

    const m = mgr as unknown as {
      getProjectContextUpdates: (
        id: string,
        pid: string
      ) => { epoch: number; block: string } | null;
    };
    expect(m.getProjectContextUpdates(session.internalId, PID)).toBeNull();

    publish(makeRecord({ webUrls: "https://a.com\nhttps://b.com" }));

    expect(m.getProjectContextUpdates(session.internalId, PID)?.block).toContain(
      "<project_context_updates>"
    );
  });
});
