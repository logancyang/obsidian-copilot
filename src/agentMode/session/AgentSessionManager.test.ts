import { FileSystemAdapter, App, Notice, TFile } from "obsidian";
import { mockTFile } from "@/__tests__/mockObsidian";
import { join } from "node:path";
import { waitFor } from "@testing-library/react";
import { AgentSession } from "./AgentSession";
import { buildNativeChatId } from "@/utils/nativeChatId";
import { CHAT_AGENT_VIEWTYPE } from "@/constants";
import { playNotificationSound } from "@/utils/notificationSound";
import { AgentSessionIndex } from "./AgentSessionIndex";
import { AgentSessionManager } from "./AgentSessionManager";
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
  ModelSelection,
} from "./types";

const mockEnsureMaterialized = ensureProjectContextMaterialized as jest.Mock;
const getSettingsMock = mockedGetSettings as jest.Mock;
const setSettingsMock = mockedSetSettings as jest.Mock;
const noticeMock = Notice as unknown as jest.Mock;

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

function mockDefaultSettings() {
  return {
    agentMode: {
      activeBackend: "opencode",
      backends: {},
      notificationSound: mockNotificationSound,
      notificationSoundId: "piano",
    },
  };
}

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(mockDefaultSettings),
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

function mockSavedDefault(saved: { baseModelId: string; effort: string | null } | null): void {
  getSettingsMock.mockReturnValue({
    agentMode: {
      activeBackend: "opencode",
      backends: { opencode: { defaultModel: saved } },
      notificationSound: false,
      notificationSoundId: "piano",
    },
  });
}

function changeSavedDefault(
  from: { baseModelId: string; effort: string | null } | null,
  to: { baseModelId: string; effort: string | null } | null
): void {
  mockSavedDefault(to);
  emitSettingsChange(
    { agentMode: { backends: { opencode: { defaultModel: from } } } },
    { agentMode: { backends: { opencode: { defaultModel: to } } } }
  );
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

type MockSessionStatus =
  | "starting"
  | "idle"
  | "running"
  | "awaiting_permission"
  | "error"
  | "closed";

interface MockSessionTestHandle {
  setStatus(status: MockSessionStatus): void;
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
  let status: MockSessionStatus = "idle";
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

function buildDescriptor(overrides: Record<string, unknown> = {}): BackendDescriptor {
  return {
    id: "opencode",
    displayName: "opencode",
    summarizesSessionTitle: true,
    getInstallState: jest.fn(() => ({ kind: "ready" })),
    subscribeInstallState: jest.fn(),
    openInstallUI: jest.fn(),
    createBackendProcess: jest.fn(() => makeMockBackendProcess()),
    ...overrides,
  } as unknown as BackendDescriptor;
}

function buildApplySelectionDescriptor(applySelection: jest.Mock): BackendDescriptor {
  return buildDescriptor({
    getInstallState: jest.fn(() => ({ kind: "ready", source: "custom" })),
    wire: {
      encode: ({ baseModelId, effort }: { baseModelId: string; effort: string | null }) =>
        effort ? `${baseModelId}/${effort}` : baseModelId,
      decode: (id: string) => ({ selection: { baseModelId: id, effort: null }, provider: null }),
    },
    applySelection,
  });
}

function modelCatalog(baseModelId: string): BackendModelCatalog {
  return {
    availableModels: [{ baseModelId, name: baseModelId, provider: null, effortOptions: [] }],
  };
}

type ManagerDeps = ConstructorParameters<typeof AgentSessionManager>[2];

interface ManagerOptions {
  app?: App;
  plugin?: unknown;
  descriptor?: BackendDescriptor;
  preloader?: Record<string, unknown>;
  persistence?: unknown;
  sessionIndex?: AgentSessionIndex;
  beforeBackendStart?: ManagerDeps["beforeBackendStart"];
}

const builtManagers: AgentSessionManager[] = [];

function buildManager(options: ManagerOptions = {}): AgentSessionManager {
  const descriptor = options.descriptor ?? buildDescriptor();
  const manager = new AgentSessionManager(
    options.app ?? buildApp(),
    (options.plugin ?? {
      manifest: { version: "1.0.0" },
    }) as ConstructorParameters<typeof AgentSessionManager>[1],
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
        ...options.preloader,
      } as unknown as ManagerDeps["modelPreloader"],
      persistenceManager: options.persistence as ManagerDeps["persistenceManager"],
      sessionIndex: options.sessionIndex,
      beforeBackendStart: options.beforeBackendStart,
    }
  );
  builtManagers.push(manager);
  return manager;
}

function seedProjects(...ids: string[]): void {
  projectsState.updateCachedProjectRecords(
    ids.map(
      (id) =>
        ({
          project: { id },
          filePath: `Projects/${id}/project.md`,
          folderName: id,
        }) as unknown as ProjectFileRecord
    )
  );
}

const flushTimers = () => new Promise((resolve) => window.setTimeout(resolve, 0));

function nativeIdOf(session: AgentSession): string {
  return buildNativeChatId(session.backendId, session.getBackendSessionId()!);
}

function endTurn(session: AgentSession, endStatus: MockSessionStatus = "idle"): void {
  const handle = getSessionTestHandle(session);
  handle.setStatus("running");
  handle.setStatus(endStatus);
}

async function createActiveAndBackgroundSessions(
  mgr: AgentSessionManager
): Promise<{ active: AgentSession; background: AgentSession }> {
  const active = await mgr.createSession();
  const background = await mgr.createSession();
  mgr.setActiveSession(active.internalId);
  return { active, background };
}

async function enterWithConversation(
  mgr: AgentSessionManager,
  projectId: string
): Promise<AgentSession> {
  await mgr.enterProject(projectId);
  const session = mgr.getActiveSession()!;
  getSessionTestHandle(session).setHasUserVisibleMessages(true);
  await mgr.exitProject();
  return session;
}

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function buildResumeOnlyBackend(overrides: Record<string, unknown> = {}) {
  return {
    ...makeMockBackendProcess(),
    loadSession: jest.fn(async () => {
      throw new MethodUnsupportedError("session/load");
    }),
    resumeSession: jest.fn(async ({ sessionId }: { sessionId: string }) => ({
      sessionId,
      state: { model: null, mode: null },
    })),
    ...overrides,
  };
}

function holdNextBackendShutdown(): { started: Promise<void>; release: () => void } {
  let release!: () => void;
  const started = new Promise<void>((resolveStarted) => {
    mockBackendShutdown.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          resolveStarted();
          release = () => resolve(undefined);
        })
    );
  });
  return { started, release: () => release() };
}

function buildManagerWithReplay(
  backendOverrides: Record<string, unknown> = {},
  descriptorOverrides: Partial<BackendDescriptor> = {}
): AgentSessionManager {
  const backend = {
    ...makeMockBackendProcess(),
    loadSession: jest.fn(async ({ sessionId }: { sessionId: string }) => ({
      sessionId,
      state: { model: null, mode: null },
    })),
    ...backendOverrides,
  };
  return buildManager({
    descriptor: buildDescriptor({ createBackendProcess: () => backend, ...descriptorOverrides }),
  });
}

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

function savedNoteFixture(autosave = false) {
  jest.useFakeTimers();
  getSettingsMock.mockReturnValue({ ...getSettingsMock(), autosaveChat: autosave });
  const saveSession = jest.fn(async () => ({ path: "chats/saved.md" }));
  return { mgr: buildManager({ persistence: { saveSession } }), saveSession };
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
  getSettingsMock.mockImplementation(mockDefaultSettings);
  setSettingsMock.mockClear();
  noticeMock.mockClear();
  mockEnsureMaterialized.mockClear();
  mockTouchProjectLastUsed.mockClear();
  ensureAgentsFileForDiscoverySpy.mockClear();
  projectsState.updateCachedProjectRecords([]);
});

afterEach(async () => {
  jest.useRealTimers();
  await Promise.all(builtManagers.splice(0).map((mgr) => mgr.shutdown().catch(() => {})));
  projectsState.updateCachedProjectRecords([]);
});

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
  const descriptor = buildDescriptor({
    id: backendId,
    getInstallState: jest.fn(() => opts?.installState ?? { kind: "ready", source: "custom" }),
    summarizesSessionTitle: opts?.summarizesSessionTitle ?? true,
    getProbeSessionId: jest.fn(() => opts?.probeSessionId),
    applyInitialSessionConfig: opts?.applyInitialSessionConfig,
    ...(opts?.createBackendProcess
      ? { createBackendProcess: opts.createBackendProcess }
      : opts?.listSessions
        ? {
            createBackendProcess: jest.fn(() => ({
              ...makeMockBackendProcess(),
              listSessions: opts.listSessions,
            })),
          }
        : {}),
  });
  const manager = buildManager({
    app,
    plugin,
    descriptor,
    persistence,
    sessionIndex: index,
    preloader: {
      getWarmProcs: jest.fn(() => {
        if (!opts?.warmListSessions && !opts?.warmSessionExistsLocally) return [];
        const proc: Record<string, unknown> = { ...makeMockBackendProcess() };
        if (opts.warmListSessions) proc.listSessions = opts.warmListSessions;
        if (opts.warmSessionExistsLocally)
          proc.sessionExistsLocally = opts.warmSessionExistsLocally;
        return [{ backendId, proc }];
      }),
    },
  });
  return { manager, index, persistence, descriptor };
}

const HISTORY_PROJECT_ID = "proj-1";

describe("AgentSessionManager", () => {
  describe("AgentSessionManager", () => {
    describe("constructor", () => {
      async function buildManagerWithLiveSession(
        applySelection: jest.Mock,
        preloader: Record<string, unknown> = {}
      ): Promise<{ mgr: AgentSessionManager; session: AgentSession }> {
        const mgr = buildManager({
          descriptor: buildApplySelectionDescriptor(applySelection),
          preloader,
        });
        return { mgr, session: await mgr.createSession() };
      }
      async function flushApplyChain(): Promise<void> {
        for (let i = 0; i < 12; i++) await Promise.resolve();
      }

      it("re-applies a changed default to a live session on that backend", async () => {
        const applySelection = jest.fn(async () => {});
        const { session } = await buildManagerWithLiveSession(applySelection);

        changeSavedDefault(null, { baseModelId: "opus", effort: "high" });
        await flushApplyChain();

        expect(applySelection).toHaveBeenCalledWith(session, {
          baseModelId: "opus",
          effort: "high",
        });
      });

      it("ignores an unchanged default and other backends' changes", async () => {
        const applySelection = jest.fn(async () => {});
        await buildManagerWithLiveSession(applySelection);

        const same = { baseModelId: "opus", effort: "high" };
        changeSavedDefault(same, { ...same });
        emitSettingsChange(
          { agentMode: { backends: { claude: { defaultModel: null } } } },
          {
            agentMode: {
              backends: { claude: { defaultModel: { baseModelId: "x", effort: null } } },
            },
          }
        );
        await flushApplyChain();

        expect(applySelection).not.toHaveBeenCalled();
      });

      it("leaves a live session unchanged when the explicit default is cleared", async () => {
        const applySelection = jest.fn(async () => {});
        await buildManagerWithLiveSession(applySelection, {
          getCachedModelCatalog: jest.fn(() => modelCatalog("native")),
        });

        const settingsReadsBeforeChange = getSettingsMock.mock.calls.length;
        changeSavedDefault({ baseModelId: "opus", effort: "high" }, null);
        await waitFor(() =>
          expect(getSettingsMock.mock.calls.length).toBeGreaterThan(settingsReadsBeforeChange)
        );

        expect(applySelection).not.toHaveBeenCalled();
      });

      it("defers re-apply for a starting session until ready, using the latest default", async () => {
        const applySelection = jest.fn(async () => {});
        const ready = deferred();
        sessionCreateSpy.mockImplementationOnce((opts) => {
          const session = makeMockSession({
            internalId: opts.internalId,
            backendId: opts.backendId,
          });
          Object.defineProperty(session, "ready", { value: ready.promise });
          getSessionTestHandle(session).setStatus("starting");
          return session;
        });
        const { session } = await buildManagerWithLiveSession(applySelection);

        const latest = { baseModelId: "opus", effort: "low" };
        changeSavedDefault({ baseModelId: "opus", effort: "high" }, latest);
        await flushApplyChain();
        expect(applySelection).not.toHaveBeenCalled();

        ready.resolve();
        await ready.promise;
        await flushApplyChain();

        expect(applySelection).toHaveBeenCalledWith(session, latest);
      });

      it("serializes rapid default changes and commits the latest", async () => {
        const order: string[] = [];
        let resolveFirst: () => void = () => {};
        const applySelection = jest.fn(
          async (_session: AgentSession, sel: { baseModelId: string }) => {
            order.push(sel.baseModelId);
            if (order.length === 1) await new Promise<void>((r) => (resolveFirst = r));
          }
        );
        await buildManagerWithLiveSession(applySelection);

        const first = { baseModelId: "first", effort: null };
        const second = { baseModelId: "second", effort: null };
        changeSavedDefault(null, first);
        await flushApplyChain();
        changeSavedDefault(first, second);
        await flushApplyChain();
        expect(order).toEqual(["first"]);

        resolveFirst();
        await flushApplyChain();

        expect(order).toEqual(["first", "second"]);
      });
    });

    describe("createSession()", () => {
      it("creates a session and sets it as the active one", async () => {
        const mgr = buildManager();
        const session = await mgr.createSession();
        expect(mgr.getSessions()).toEqual([session]);
        expect(mgr.getActiveSession()).toBe(session);
        expect(mgr.getActiveChatUIState()).not.toBeNull();
        expect(mgr.getChatUIState(session.internalId)).toBe(mgr.getActiveChatUIState());
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/625 refuses to start a chat, and asks for an enabled model, when a backend that may only run enabled models has none", async () => {
        mockSavedDefault(null);
        const mgr = buildManager({
          descriptor: buildDescriptor({
            routesCopilotModels: true,
            getEnabledModelEntries: () => [],
          }),
        });

        await expect(mgr.createSession()).rejects.toThrow(
          "Enable a model for opencode in Copilot's model settings to start a chat."
        );
        expect(mgr.getLastError()).toBe(
          "Enable a model for opencode in Copilot's model settings to start a chat."
        );
        expect(mockBackendStart).not.toHaveBeenCalled();
        expect(mgr.getIsStarting()).toBe(false);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/625 hands the saved mode to the new session so startup waits for that mode to arrive", async () => {
        getSettingsMock.mockReturnValue({
          agentMode: { backends: { opencode: { defaultMode: "default" } } },
        });
        const mgr = buildManager();

        await mgr.createSession();

        expect(sessionCreateSpy).toHaveBeenCalledWith(
          expect.objectContaining({ defaultMode: "default" })
        );
      });

      it("only spawns the backend once across multiple createSession calls", async () => {
        const mgr = buildManager();
        await mgr.createSession();
        await mgr.createSession();
        await mgr.createSession();
        expect(mockBackendStart).toHaveBeenCalledTimes(1);
      });

      it("two concurrent createSession calls each spawn their own session", async () => {
        const mgr = buildManager();
        const [a, b] = await Promise.all([mgr.createSession(), mgr.createSession()]);
        expect(a).not.toBe(b);
        expect(sessionCreateSpy).toHaveBeenCalledTimes(2);
        expect(mgr.getSessions()).toHaveLength(2);
      });

      it.each([false, true])(
        "waits for the startup upgrade and respects shutdown=%s before launching (https://github.com/Brevilabs/obsidian-copilot-private/issues/530)",
        async (shutdown) => {
          const upgrade = deferred();
          const beforeBackendStart = jest.fn(() => upgrade.promise);
          const mgr = buildManager({ beforeBackendStart });
          const creating = mgr.createSession();
          await waitFor(() => expect(beforeBackendStart).toHaveBeenCalled());
          expect(mockBackendStart).not.toHaveBeenCalled();
          if (shutdown) await mgr.shutdown();
          upgrade.resolve();
          if (shutdown) await expect(creating).rejects.toThrow("shut down");
          else {
            await creating;
            expect(mockBackendStart).toHaveBeenCalledTimes(1);
          }
        }
      );

      it("keeps a validated running process usable when another installation is selected (https://github.com/Brevilabs/obsidian-copilot-private/issues/531)", async () => {
        const descriptor = buildDescriptor();
        const mgr = buildManager({ descriptor });
        await mgr.createSession();
        (descriptor.getInstallState as jest.Mock).mockReturnValue({
          kind: "incompatible",
          message: "Upgrade required",
        });
        await expect(mgr.createSession()).resolves.toBeDefined();
        expect(mockBackendStart).toHaveBeenCalledTimes(1);
      });

      it("rejects an unsupported installation before starting its process (https://github.com/Brevilabs/obsidian-copilot-private/issues/531)", async () => {
        const mgr = buildManager({
          descriptor: buildDescriptor({
            getInstallState: jest.fn(() => ({ kind: "incompatible", message: "Upgrade required" })),
          }),
        });
        await expect(mgr.createSession()).rejects.toThrow("Upgrade required");
        expect(mockBackendStart).not.toHaveBeenCalled();
      });

      it("runs a fresh session on the preloader's warm process instead of spawning another", async () => {
        const warmProc = makeMockBackendProcess();
        const descriptor = buildDescriptor();
        const mgr = buildManager({
          descriptor,
          preloader: {
            takeWarm: jest.fn().mockReturnValueOnce({ proc: warmProc }).mockReturnValue(null),
          },
        });

        await mgr.createSession();

        expect(mockBackendStart).not.toHaveBeenCalled();
        expect(descriptor.createBackendProcess).not.toHaveBeenCalled();
        expect(sessionCreateSpy).toHaveBeenCalledTimes(1);
        const opts = sessionCreateSpy.mock.calls[0][0];
        expect(opts.backend).toBe(warmProc);
        expect(opts).not.toHaveProperty("backendSessionId");
      });

      it("waits for an in-flight preload and adopts its process instead of spawning a second one", async () => {
        let preloadSettled = false;
        const preloadGate = deferred();
        const preload = jest.fn(() => preloadGate.promise);
        const takeWarm = jest.fn(() =>
          preloadSettled ? { proc: makeMockBackendProcess() } : null
        );
        const descriptor = buildDescriptor();
        const mgr = buildManager({ descriptor, preloader: { preload, takeWarm } });
        mgr.registerPreload("opencode", preloadGate.promise);

        const sessionPromise = mgr.createSession();
        await flushTimers();

        expect(preload).toHaveBeenCalledWith("opencode");
        expect(descriptor.createBackendProcess).not.toHaveBeenCalled();

        preloadSettled = true;
        preloadGate.resolve();
        await sessionPromise;

        expect(takeWarm).toHaveBeenCalledWith("opencode");
        expect(descriptor.createBackendProcess).not.toHaveBeenCalled();
        expect(mockBackendStart).not.toHaveBeenCalled();
      });

      it("leaves the seed unset when a catalog exists but no explicit default is stored", async () => {
        const mgr = buildManager({
          preloader: { getCachedModelCatalog: jest.fn(() => modelCatalog("catalog-first")) },
        });

        await mgr.createSession();

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

        const failingSession = await mgr.createSession();
        const succeedingSession = await mgr.createSession();
        await failingSession.ready.catch(() => undefined);
        await succeedingSession.ready;
        await Promise.resolve();
        for (let i = 0; i < 10; i++) await Promise.resolve();

        expect(mgr.getLastError()).toMatch(/boom/);
      });

      it.each([
        { effort: null, confirmed: "low", expected: "low" },
        { effort: "removed", confirmed: "low", expected: "low" },
        { effort: "high", confirmed: "high", expected: undefined },
        { effort: "removed", confirmed: "high", expected: undefined },
      ])(
        "https://github.com/Brevilabs/obsidian-copilot-private/issues/219 repairs saved $effort only when the fallback is confirmed ($confirmed)",
        async ({ effort, confirmed, expected }) => {
          mockSavedDefault({ baseModelId: "opus", effort });
          sessionCreateSpy.mockImplementationOnce((opts) => {
            const session = makeMockSession({
              internalId: opts.internalId,
              backendId: opts.backendId,
            });
            jest.spyOn(session, "getState").mockReturnValue({
              model: {
                current: { baseModelId: "opus", effort: confirmed },
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
          const mgr = buildManager({ descriptor: buildApplySelectionDescriptor(jest.fn()) });

          await mgr.createSession();
          for (let i = 0; i < 12; i++) await Promise.resolve();

          expect(readPersistedDefault(setSettingsMock, "opencode")).toEqual(
            expected === undefined ? undefined : { baseModelId: "opus", effort: expected }
          );
        }
      );

      it("wires the project-context update hooks into a project session but not a global one", async () => {
        seedProjects("proj-hooks");
        const mgr = buildManager();

        await mgr.enterProject("proj-hooks");
        const projectOpts = sessionCreateSpy.mock.calls[0][0];
        expect(typeof projectOpts.getProjectContextUpdates).toBe("function");
        expect(typeof projectOpts.markProjectContextUpdatesDelivered).toBe("function");

        await mgr.exitProject();
        sessionCreateSpy.mockClear();
        await mgr.createSession();
        const globalOpts = sessionCreateSpy.mock.calls[0][0];
        expect(globalOpts.getProjectContextUpdates).toBeUndefined();
        expect(globalOpts.markProjectContextUpdatesDelivered).toBeUndefined();
      });

      it("chimes when a session starts awaiting permission (https://github.com/logancyang/obsidian-copilot/issues/2987)", async () => {
        const mgr = buildManager();
        const session = await mgr.createSession();

        endTurn(session, "awaiting_permission");

        expect(playNotificationSound).toHaveBeenCalledTimes(1);
        expect(session.getNeedsAttention()).toBe(false);
      });

      it.each([
        ["no Agent Chat is open", "none"],
        ["a modal outside the chat has focus", "outside"],
        ["another workspace leaf has focus", "other-leaf"],
        ["the Obsidian window is unfocused", "unfocused-window"],
      ] as const)(
        "chimes when a turn ends while %s (https://github.com/logancyang/obsidian-copilot/issues/2987)",
        async (_label, focus) => {
          mockAgentChatFocus = focus;
          const mgr = buildManager();
          const session = await mgr.createSession();

          endTurn(session);

          expect(playNotificationSound).toHaveBeenCalledTimes(1);
          expect(playNotificationSound).toHaveBeenCalledWith("piano");
          expect(session.getNeedsAttention()).toBe(false);
        }
      );

      it.each([
        ["the most recent Agent Chat", "inside"],
        ["a sidebar Agent Chat whose leaf is not most recent", "inside-sidebar"],
      ] as const)(
        "stays silent when focus is inside %s (https://github.com/logancyang/obsidian-copilot/issues/2987)",
        async (_label, focus) => {
          mockAgentChatFocus = focus;
          const mgr = buildManager();
          const session = await mgr.createSession();

          endTurn(session);

          expect(playNotificationSound).not.toHaveBeenCalled();
          expect(session.getNeedsAttention()).toBe(false);
        }
      );

      it("stays silent when the focused Agent Chat starts awaiting permission (https://github.com/logancyang/obsidian-copilot/issues/2987)", async () => {
        mockAgentChatFocus = "inside";
        const mgr = buildManager();
        const session = await mgr.createSession();

        endTurn(session, "awaiting_permission");

        expect(playNotificationSound).not.toHaveBeenCalled();
        expect(session.getNeedsAttention()).toBe(false);
      });

      it("chimes and flags a backgrounded session that finishes while the chat is focused (https://github.com/logancyang/obsidian-copilot/issues/2987)", async () => {
        mockAgentChatFocus = "inside";
        const mgr = buildManager();
        const { background } = await createActiveAndBackgroundSessions(mgr);

        endTurn(background);

        expect(playNotificationSound).toHaveBeenCalledWith("piano");
        expect(background.getNeedsAttention()).toBe(true);
      });

      it("stays silent but still flags a backgrounded session when the notification sound setting is off (https://github.com/logancyang/obsidian-copilot/issues/2987)", async () => {
        mockNotificationSound = false;
        const mgr = buildManager();
        const { background } = await createActiveAndBackgroundSessions(mgr);

        endTurn(background);

        expect(playNotificationSound).not.toHaveBeenCalled();
        expect(background.getNeedsAttention()).toBe(true);
      });

      it("neither chimes nor flags a backgrounded session moving from starting to idle (https://github.com/logancyang/obsidian-copilot/issues/2987)", async () => {
        const mgr = buildManager();
        const { background } = await createActiveAndBackgroundSessions(mgr);

        const handle = getSessionTestHandle(background);
        handle.setStatus("starting");
        handle.setStatus("idle");

        expect(playNotificationSound).not.toHaveBeenCalled();
        expect(background.getNeedsAttention()).toBe(false);
      });

      it("autosaves a new chat's turn as a note when autosave is on (https://github.com/logancyang/obsidian-copilot/issues/3225)", async () => {
        const { mgr, saveSession } = savedNoteFixture(true);
        const session = await mgr.createSession();
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

    describe("createGlobalSessionWithDraft()", () => {
      it("writes the unsent text into the new chat's own draft for https://github.com/Brevilabs/obsidian-copilot-private/issues/166", async () => {
        const mgr = buildManager();

        const session = await mgr.createGlobalSessionWithDraft("Review this repair");

        expect(mgr.getActiveSession()).toBe(session);
        expect(mgr.drafts.get(session.chatInputId)?.input).toBe("Review this repair");
      });

      it("switches directly to the requested scope without spawning an extra blank session for https://github.com/Brevilabs/obsidian-copilot-private/issues/166", async () => {
        const projectId = "project-with-no-global-session";
        seedProjects(projectId);
        const mgr = buildManager();
        await mgr.createSession(undefined, projectId);

        const session = await mgr.createGlobalSessionWithDraft("Review this repair");

        expect(mgr.getSessions()).toHaveLength(2);
        expect(
          mgr.getSessions().filter((candidate) => candidate.projectId === GLOBAL_SCOPE)
        ).toEqual([session]);
        expect(mgr.getActiveSession()).toBe(session);
      });

      it("drops the drafted text when its session closes for https://github.com/Brevilabs/obsidian-copilot-private/issues/166", async () => {
        const mgr = buildManager();
        const session = await mgr.createGlobalSessionWithDraft("Review this repair");

        await mgr.closeSession(session.internalId);

        expect(mgr.drafts.get(session.chatInputId)).toBeUndefined();
      });

      it("leaves no draft behind when session creation fails for https://github.com/Brevilabs/obsidian-copilot-private/issues/166", async () => {
        const projectId = "project-before-failed-draft";
        seedProjects(projectId);
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
      });

      it("does not roll back across newer ABA scope navigation for https://github.com/Brevilabs/obsidian-copilot-private/issues/166", async () => {
        seedProjects("project-a", "project-b");
        const mgr = buildManager();
        const globalSession = await mgr.createSession(undefined, GLOBAL_SCOPE);
        const projectBSession = await mgr.createSession(undefined, "project-b");
        const projectASession = await mgr.createSession(undefined, "project-a");
        mgr.setActiveSession(projectASession.internalId);

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
        mgr.setActiveSession(projectBSession.internalId);
        mgr.setActiveSession(globalSession.internalId);
        releaseInstructionEnsure?.();

        await expect(pendingDraft).rejects.toThrow("session creation failed");
        expect(mgr.getActiveProjectId()).toBe(GLOBAL_SCOPE);
        expect(mgr.getActiveSession()).toBe(globalSession);
      });
    });

    describe("addContextNoteToActiveChat()", () => {
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/579 attaches the note to the active chat's draft", async () => {
        const mgr = buildManager();
        const session = await mgr.createSession();
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

    describe("getOrCreateActiveSession()", () => {
      it("returns the existing active session on subsequent calls", async () => {
        const mgr = buildManager();
        const a = await mgr.getOrCreateActiveSession();
        const again = await mgr.getOrCreateActiveSession();
        expect(again).toBe(a);
        expect(sessionCreateSpy).toHaveBeenCalledTimes(1);
      });

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
    });

    describe("setActiveSession()", () => {
      it("moves the active pointer to the given id", async () => {
        const mgr = buildManager();
        const a = await mgr.createSession();
        const b = await mgr.createSession();
        expect(mgr.getActiveSession()).toBe(b);
        mgr.setActiveSession(a.internalId);
        expect(mgr.getActiveSession()).toBe(a);
      });

      it("is a silent no-op on unknown id", async () => {
        const mgr = buildManager();
        const a = await mgr.createSession();
        expect(() => mgr.setActiveSession("nope")).not.toThrow();
        expect(mgr.getActiveSession()).toBe(a);
      });

      it("re-attaches a session detached from its tab when it is surfaced", async () => {
        seedProjects("proj-detach");
        const mgr = buildManager();
        const old = await enterWithConversation(mgr, "proj-detach");
        await mgr.enterProject("proj-detach");
        expect(mgr.getSessionsForScope("proj-detach")).not.toContain(old);

        mgr.setActiveSession(old.internalId);

        expect(mgr.getSessionsForScope("proj-detach")).toContain(old);
        expect(mgr.getActiveSession()).toBe(old);
      });
    });

    describe("closeSession()", () => {
      it("removes the session from the pool and cancels + disposes it", async () => {
        const mgr = buildManager();
        const a = await mgr.createSession();
        await mgr.closeSession(a.internalId);
        expect(mgr.getSessions()).toEqual([]);
        expect(mgr.getActiveSession()).toBeNull();
        expect(mockSessionCancel).toHaveBeenCalled();
        expect(mockSessionDispose).toHaveBeenCalled();
      });

      it("when the active session is closed, picks the right neighbor as active", async () => {
        const mgr = buildManager();
        const a = await mgr.createSession();
        const b = await mgr.createSession();
        const c = await mgr.createSession();
        mgr.setActiveSession(b.internalId);
        await mgr.closeSession(b.internalId);
        expect(mgr.getActiveSession()).toBe(c);
        expect(mgr.getSessions()).toEqual([a, c]);
      });

      it("when the rightmost active session is closed, falls back to the new last", async () => {
        const mgr = buildManager();
        const a = await mgr.createSession();
        const b = await mgr.createSession();
        expect(mgr.getActiveSession()).toBe(b);
        await mgr.closeSession(b.internalId);
        expect(mgr.getActiveSession()).toBe(a);
      });

      it("closing a non-active session leaves the active pointer alone", async () => {
        const mgr = buildManager();
        const a = await mgr.createSession();
        const b = await mgr.createSession();
        await mgr.closeSession(a.internalId);
        expect(mgr.getActiveSession()).toBe(b);
        expect(mgr.getSessions()).toEqual([b]);
      });

      it("is a no-op for unknown ids", async () => {
        const mgr = buildManager();
        await mgr.closeSession("does-not-exist");
        expect(mgr.getSessions()).toEqual([]);
      });

      it("picks a visible neighbor, never a session detached from its tab", async () => {
        seedProjects("proj-detach");
        const mgr = buildManager();
        const old = await enterWithConversation(mgr, "proj-detach");
        await mgr.enterProject("proj-detach");
        const fresh = mgr.getActiveSession()!;

        await mgr.closeSession(fresh.internalId);

        expect(mgr.getActiveSession()).not.toBe(old);
      });

      it("never writes an unsaved chat with autosave off for https://github.com/logancyang/obsidian-copilot/issues/3225", async () => {
        const { mgr, saveSession } = savedNoteFixture();
        const session = await mgr.createSession();
        getSessionTestHandle(session).setMessages([{ message: "Unsaved turn" }], true);
        await jest.advanceTimersByTimeAsync(2000);
        await mgr.closeSession(session.internalId);
        expect(saveSession).not.toHaveBeenCalled();
        await mgr.shutdown();
      });
    });

    describe("replaceSessionInPlace()", () => {
      async function flushBackgroundClose(): Promise<void> {
        for (let i = 0; i < 5; i++) await Promise.resolve();
      }

      it("inserts the replacement at the old session's tab-strip index", async () => {
        const mgr = buildManager();
        const a = await mgr.createSession();
        const b = await mgr.createSession();
        const c = await mgr.createSession();
        const replacement = await mgr.replaceSessionInPlace(b.internalId);
        await flushBackgroundClose();
        expect(mgr.getSessions()).toEqual([a, replacement, c]);
        expect(mgr.getActiveSession()).toBe(replacement);
      });

      it("preserves the leftmost slot when replacing the first tab", async () => {
        const mgr = buildManager();
        const a = await mgr.createSession();
        const b = await mgr.createSession();
        mgr.setActiveSession(a.internalId);
        const replacement = await mgr.replaceSessionInPlace(a.internalId);
        await flushBackgroundClose();
        expect(mgr.getSessions()).toEqual([replacement, b]);
        expect(mgr.getActiveSession()).toBe(replacement);
      });

      it("gives the replacement the old tab's chat UI state slot", async () => {
        const mgr = buildManager();
        const a = await mgr.createSession();
        const b = await mgr.createSession();
        mgr.setActiveSession(a.internalId);
        const replacement = await mgr.replaceSessionInPlace(a.internalId);
        await flushBackgroundClose();
        expect(mgr.getActiveChatUIState()).toBe(mgr.getChatUIState(replacement.internalId));
        expect(mgr.getChatUIState(b.internalId)).not.toBeNull();
      });

      it("closes the old session in the background", async () => {
        const mgr = buildManager();
        const a = await mgr.createSession();
        await mgr.replaceSessionInPlace(a.internalId);
        await flushBackgroundClose();
        expect(mockSessionCancel).toHaveBeenCalled();
        expect(mockSessionDispose).toHaveBeenCalled();
        expect(mgr.getSessions().some((s) => s.internalId === a.internalId)).toBe(false);
      });

      it("falls back to plain create when the old id is unknown", async () => {
        const mgr = buildManager();
        const replacement = await mgr.replaceSessionInPlace("does-not-exist");
        expect(mgr.getSessions()).toEqual([replacement]);
        expect(mgr.getActiveSession()).toBe(replacement);
      });

      it("preserves the logical chat input only when explicitly requested", async () => {
        const mgr = buildManager();
        const freshSource = await mgr.createSession();
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
        const source = await mgr.createSession();
        const createSession = mgr.createSession.bind(mgr);
        const secondStarted = deferred();
        const secondGate = deferred();
        let replacementCount = 0;
        jest.spyOn(mgr, "createSession").mockImplementation(async (...args) => {
          replacementCount++;
          if (replacementCount === 2) {
            secondStarted.resolve();
            await secondGate.promise;
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
        await secondStarted.promise;
        const third = mgr.replaceSessionInPlace(firstReplacement.internalId, "opencode", {
          preserveChatInput: true,
          seedSelection: { baseModelId: "final-model", effort: "low" },
        });
        secondGate.resolve();
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

      it("updates the manually saved file and drains later turns on New Chat with autosave off for https://github.com/logancyang/obsidian-copilot/issues/3225", async () => {
        const { mgr, saveSession } = savedNoteFixture();
        const session = await mgr.createSession();
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

    describe("subscribe()", () => {
      it("notifies subscribers on session create / close / activate", async () => {
        const mgr = buildManager();
        const listener = jest.fn();
        mgr.subscribe(listener);

        const a = await mgr.createSession();
        const b = await mgr.createSession();
        mgr.setActiveSession(a.internalId);
        await mgr.closeSession(b.internalId);

        expect(listener.mock.calls.length).toBeGreaterThanOrEqual(4);
      });
    });

    describe("shutdown()", () => {
      it("cancels and disposes every session and clears state", async () => {
        const mgr = buildManager();
        await mgr.createSession();
        await mgr.createSession();
        expect(mgr.getSessions()).toHaveLength(2);

        await mgr.shutdown();
        expect(mgr.getSessions()).toEqual([]);
        expect(mgr.getActiveSession()).toBeNull();
        expect(mockSessionCancel).toHaveBeenCalledTimes(2);
        expect(mockSessionDispose).toHaveBeenCalledTimes(2);
        expect(mockBackendShutdown).toHaveBeenCalledTimes(1);
      });

      it("stops reacting to project record changes", async () => {
        const projectId = "proj-shutdown";
        projectsState.updateCachedProjectRecords([
          {
            project: { id: projectId, contextSource: { webUrls: "https://a.com" } },
            filePath: `Projects/${projectId}/project.md`,
            folderName: projectId,
          } as unknown as ProjectFileRecord,
        ]);
        const mgr = buildManager();
        await mgr.enterProject(projectId);
        await mgr.shutdown();
        mockEnsureMaterialized.mockClear();

        projectsState.updateCachedProjectRecords([
          {
            project: { id: projectId, contextSource: { webUrls: "https://a.com\nhttps://b.com" } },
            filePath: `Projects/${projectId}/project.md`,
            folderName: projectId,
          } as unknown as ProjectFileRecord,
        ]);

        expect(mockEnsureMaterialized).not.toHaveBeenCalled();
      });
    });

    describe("getLastError()", () => {
      it("reports an unexpected backend exit and drops every session", async () => {
        const mgr = buildManager();
        const listener = jest.fn();
        mgr.subscribe(listener);
        await mgr.createSession();
        await mgr.createSession();

        for (const fn of mockBackendExitListeners) fn();

        expect(mgr.getSessions()).toEqual([]);
        expect(mgr.getActiveSession()).toBeNull();
        expect(mgr.getLastError()).toMatch(/exited unexpectedly/);
        expect(listener).toHaveBeenCalled();
      });
    });

    describe("getOpenChatIds()", () => {
      it("includes idle and running conversations and removes released sessions for https://github.com/Brevilabs/obsidian-copilot-private/issues/429", async () => {
        const mgr = buildManager();
        const empty = mgr.getOpenChatIds();
        expect(mgr.getOpenChatIds()).toBe(empty);
        const idle = await mgr.createSession();
        const running = await mgr.createSession();
        getSessionTestHandle(running).setStatus("running");
        const idleId = nativeIdOf(idle);
        const runningId = nativeIdOf(running);
        expect(mgr.getOpenChatIds()).toEqual(new Set([idleId, runningId]));
        await mgr.closeChatSession(idleId);
        expect(mgr.getOpenChatIds()).toEqual(new Set([runningId]));
      });
    });

    describe("detachSessionFromTab()", () => {
      it("keeps the backend session open and discoverable in history for https://github.com/Brevilabs/obsidian-copilot-private/issues/429", async () => {
        const mgr = buildManager();
        const session = await mgr.createSession();
        const proc = mgr.getBackendProcess(session.backendId)!;

        mgr.detachSessionFromTab(session.internalId);

        expect(mgr.getSessionsForScope(session.projectId)).not.toContain(session);
        expect(mgr.getSessions()).toContain(session);
        expect(mgr.getOpenChatIds()).toContain(nativeIdOf(session));
        expect(proc.closeSession).not.toHaveBeenCalled();
        expect(mockSessionCancel).not.toHaveBeenCalled();
        expect(mockSessionDispose).not.toHaveBeenCalled();
      });
    });

    describe("closeChatSession()", () => {
      it.each([
        ["saved note path", false],
        ["stale native id", true],
      ])(
        "closes by %s and retains the saved transcript for https://github.com/Brevilabs/obsidian-copilot-private/issues/429",
        async (_label, useNativeId) => {
          const saved = new Map<string, unknown>();
          const saveSession = jest.fn(async (messages: unknown) => {
            saved.set("chats/research.md", messages);
            return { path: "chats/research.md" };
          });
          const mgr = buildManager({ persistence: { saveSession } });
          const session = await mgr.createSession();
          getSessionTestHandle(session).setMessages([{ message: "Initial answer" }]);
          await mgr.saveActiveSession();
          const nativeId = nativeIdOf(session);
          expect(mgr.getOpenChatIds()).toEqual(new Set([nativeId, "chats/research.md"]));

          await mgr.closeChatSession(useNativeId ? nativeId : "chats/research.md");

          expect(saved.get("chats/research.md")).toEqual([{ message: "Initial answer" }]);
          expect(mgr.getOpenChatIds().size).toBe(0);
          expect(mgr.getSessions()).toEqual([]);
        }
      );

      it("releases only the selected backend session while preserving another active chat for https://github.com/Brevilabs/obsidian-copilot-private/issues/429", async () => {
        const mgr = buildManager();
        const selected = await mgr.createSession();
        const sibling = await mgr.createSession();
        const proc = mgr.getBackendProcess(selected.backendId)!;
        await mgr.closeChatSession(nativeIdOf(selected));
        expect(proc.closeSession).toHaveBeenCalledWith({
          sessionId: selected.getBackendSessionId(),
        });
        expect(mgr.getSessions()).toEqual([sibling]);
        expect(mgr.getActiveSession()).toBe(sibling);
        expect(proc.shutdown).not.toHaveBeenCalled();
      });
    });

    describe("getRunningChatIds()", () => {
      it("keys a running native session by its native chat id", async () => {
        const mgr = buildManager();
        const a = await mgr.createSession();
        getSessionTestHandle(a).setStatus("running");
        expect(mgr.getRunningChatIds().has(nativeIdOf(a))).toBe(true);
      });

      it("keys a running saved session by its markdown path", async () => {
        const mgr = buildManager({
          persistence: { saveSession: jest.fn(async () => ({ path: "chats/agent__saved.md" })) },
        });
        const a = await mgr.createSession();
        getSessionTestHandle(a).setMessages([{ message: "hi" }]);
        await mgr.saveActiveSession();
        getSessionTestHandle(a).setStatus("running");
        expect(mgr.getRunningChatIds().has("chats/agent__saved.md")).toBe(true);
      });

      it("keeps both ids when a running session's first save re-keys it", async () => {
        const mgr = buildManager({
          persistence: { saveSession: jest.fn(async () => ({ path: "chats/agent__saved.md" })) },
        });
        const a = await mgr.createSession();
        getSessionTestHandle(a).setMessages([{ message: "hi" }]);
        getSessionTestHandle(a).setStatus("running");
        expect(mgr.getRunningChatIds().has(nativeIdOf(a))).toBe(true);

        const listener = jest.fn();
        mgr.subscribe(listener);
        await mgr.saveActiveSession();

        expect(listener).toHaveBeenCalledTimes(1);
        const ids = mgr.getRunningChatIds();
        expect(ids.has("chats/agent__saved.md")).toBe(true);
        expect(ids.has(nativeIdOf(a))).toBe(true);
      });

      it("excludes a starting session while including a running one", async () => {
        const mgr = buildManager();
        const a = await mgr.createSession();
        const b = await mgr.createSession();
        getSessionTestHandle(a).setStatus("running");
        getSessionTestHandle(b).setStatus("starting");
        const ids = mgr.getRunningChatIds();
        expect(ids.has(nativeIdOf(a))).toBe(true);
        expect(ids.has(nativeIdOf(b))).toBe(false);
      });

      it("returns the same frozen empty set when nothing is running", async () => {
        const mgr = buildManager();
        await mgr.createSession();
        const first = mgr.getRunningChatIds();
        expect(first.size).toBe(0);
        expect(mgr.getRunningChatIds()).toBe(first);
      });

      it("notifies subscribers when a session's running membership flips", async () => {
        const mgr = buildManager();
        const a = await mgr.createSession();
        const listener = jest.fn();
        mgr.subscribe(listener);
        getSessionTestHandle(a).setStatus("running");
        expect(listener).toHaveBeenCalledTimes(1);
        listener.mockClear();
        getSessionTestHandle(a).setStatus("idle");
        expect(listener).toHaveBeenCalledTimes(1);
      });

      it("keeps a session detached from its tab listed as running so history shows its spinner", async () => {
        seedProjects("proj-detach");
        const mgr = buildManager();
        const old = await enterWithConversation(mgr, "proj-detach");
        getSessionTestHandle(old).setStatus("running");

        await mgr.enterProject("proj-detach");

        expect(mgr.getSessionsForScope("proj-detach")).not.toContain(old);
        expect(mgr.getRunningChatIds().has(nativeIdOf(old))).toBe(true);
      });
    });

    describe("getAttentionChatIds()", () => {
      it("hands a backgrounded finished session over from running to attention", async () => {
        const mgr = buildManager();
        const { background } = await createActiveAndBackgroundSessions(mgr);
        const nativeId = nativeIdOf(background);

        getSessionTestHandle(background).setStatus("running");
        expect(mgr.getRunningChatIds().has(nativeId)).toBe(true);
        expect(mgr.getAttentionChatIds().has(nativeId)).toBe(false);

        getSessionTestHandle(background).setStatus("idle");
        expect(mgr.getRunningChatIds().has(nativeId)).toBe(false);
        expect(mgr.getAttentionChatIds().has(nativeId)).toBe(true);
      });

      it.each(["error", "awaiting_permission"] as const)(
        "includes a backgrounded session whose turn ends in %s (https://github.com/logancyang/obsidian-copilot/issues/2987)",
        async (endStatus) => {
          const mgr = buildManager();
          const { active, background } = await createActiveAndBackgroundSessions(mgr);

          endTurn(background, endStatus);

          expect(mgr.getAttentionChatIds().has(nativeIdOf(background))).toBe(true);
          expect(mgr.getAttentionChatIds().has(nativeIdOf(active))).toBe(false);
        }
      );

      it("does not include a backgrounded session moving from starting to idle", async () => {
        const mgr = buildManager();
        const { background } = await createActiveAndBackgroundSessions(mgr);

        const handle = getSessionTestHandle(background);
        handle.setStatus("starting");
        handle.setStatus("idle");

        expect(mgr.getAttentionChatIds().size).toBe(0);
      });

      it("does not include the active session even when its chat is not focused (https://github.com/logancyang/obsidian-copilot/issues/2987)", async () => {
        const mgr = buildManager();
        const active = await mgr.createSession();

        endTurn(active);

        expect(mgr.getAttentionChatIds().size).toBe(0);
      });

      it("drops the id once the user activates the flagged tab", async () => {
        const mgr = buildManager();
        const { background } = await createActiveAndBackgroundSessions(mgr);
        endTurn(background);
        expect(mgr.getAttentionChatIds().has(nativeIdOf(background))).toBe(true);

        mgr.setActiveSession(background.internalId);

        expect(mgr.getAttentionChatIds().has(nativeIdOf(background))).toBe(false);
        expect(background.getNeedsAttention()).toBe(false);
      });

      it("returns the same frozen empty set when nothing needs attention", async () => {
        const mgr = buildManager();
        await mgr.createSession();
        const first = mgr.getAttentionChatIds();
        expect(first.size).toBe(0);
        expect(mgr.getAttentionChatIds()).toBe(first);
      });

      it("keeps a session detached from its tab listed so history shows its attention dot", async () => {
        seedProjects("proj-detach");
        const mgr = buildManager();
        const old = await enterWithConversation(mgr, "proj-detach");
        old.markNeedsAttention();

        await mgr.enterProject("proj-detach");

        expect(mgr.getSessionsForScope("proj-detach")).not.toContain(old);
        expect(mgr.getAttentionChatIds().has(nativeIdOf(old))).toBe(true);
      });
    });

    describe("noteSpawnConfigChanged()", () => {
      it("keeps an open session alive and holds the restart for the user (https://github.com/Brevilabs/obsidian-copilot-private/issues/475)", async () => {
        const mgr = buildManager();
        const session = await mgr.createSession();

        await mgr.noteSpawnConfigChanged("opencode", "managed skills changed");

        expect(mockBackendShutdown).not.toHaveBeenCalled();
        expect(mgr.getActiveSession()).toBe(session);
        expect(mgr.hasHeldConfigChange("opencode")).toBe(true);
      });

      it("restarts straight away when no session is open on the backend (https://github.com/Brevilabs/obsidian-copilot-private/issues/475)", async () => {
        const mgr = buildManager();
        const session = await mgr.createSession();
        await mgr.closeSession(session.internalId);

        await mgr.noteSpawnConfigChanged("opencode", "byok key saved");

        expect(mockBackendShutdown).toHaveBeenCalledTimes(1);
        expect(mgr.hasHeldConfigChange("opencode")).toBe(false);
      });

      it("refreshes a warm probe that no session has adopted (https://github.com/Brevilabs/obsidian-copilot-private/issues/475)", async () => {
        const refresh = jest.fn(() => Promise.resolve());
        const mgr = buildManager({ preloader: { refresh } });

        await mgr.noteSpawnConfigChanged("opencode", "byok key saved");

        expect(refresh).toHaveBeenCalledWith("opencode");
        expect(mgr.hasHeldConfigChange("opencode")).toBe(false);
      });

      it("reports one held change however many times config changes (https://github.com/Brevilabs/obsidian-copilot-private/issues/475)", async () => {
        const mgr = buildManager();
        await mgr.createSession();
        const listener = jest.fn();
        mgr.subscribe(listener);

        await mgr.noteSpawnConfigChanged("opencode", "managed skills changed");
        await mgr.noteSpawnConfigChanged("opencode", "provider config changed");

        expect(listener).toHaveBeenCalledTimes(1);
        expect(mgr.hasHeldConfigChange("opencode")).toBe(true);
      });
    });

    describe("applyHeldConfigChange()", () => {
      it("restarts the backend and clears the offer (https://github.com/Brevilabs/obsidian-copilot-private/issues/475)", async () => {
        const mgr = buildManager();
        const first = await mgr.createSession();
        await mgr.noteSpawnConfigChanged("opencode", "managed skills changed");

        await mgr.applyHeldConfigChange("opencode");

        expect(mockBackendShutdown).toHaveBeenCalledTimes(1);
        expect(mgr.getActiveSession()).not.toBe(first);
        expect(mgr.getActiveSession()?.backendId).toBe("opencode");
        expect(mgr.hasHeldConfigChange("opencode")).toBe(false);
      });

      it("does nothing when the backend has no held change (https://github.com/Brevilabs/obsidian-copilot-private/issues/475)", async () => {
        const mgr = buildManager();
        await mgr.createSession();

        await mgr.applyHeldConfigChange("opencode");

        expect(mockBackendShutdown).not.toHaveBeenCalled();
      });

      it("replaces an errored session with corrected configuration (https://github.com/Brevilabs/obsidian-copilot-private/issues/475)", async () => {
        sessionCreateSpy.mockImplementationOnce((opts) =>
          makeMockSession({
            ...opts,
            ready: Promise.reject(new Error("Invalid API key")),
          })
        );
        const mgr = buildManager();
        const failed = await mgr.createSession();
        getSessionTestHandle(failed).setStatus("error");
        await flushTimers();
        expect(mgr.getLastError()).toContain("Invalid API key");
        await mgr.noteSpawnConfigChanged("opencode", "key corrected");
        await mgr.applyHeldConfigChange("opencode");
        await flushTimers();
        expect(mgr.getActiveSession()).not.toBe(failed);
        expect(mgr.getActiveSession()?.getStatus()).toBe("idle");
        expect(mgr.getLastError()).toBeNull();
      });

      it("reports the restart as pending until a running turn releases it (https://github.com/Brevilabs/obsidian-copilot-private/issues/475)", async () => {
        const mgr = buildManager();
        const first = await mgr.createSession();
        await mgr.noteSpawnConfigChanged("opencode", "managed skills changed");
        getSessionTestHandle(first).setStatus("running");
        const listener = jest.fn();
        mgr.subscribe(listener);

        await mgr.applyHeldConfigChange("opencode");

        expect(mockBackendShutdown).not.toHaveBeenCalled();
        expect(mgr.isBackendRestartPending("opencode")).toBe(true);
        expect(listener).toHaveBeenCalled();

        getSessionTestHandle(first).setStatus("idle");
        await flushTimers();

        expect(mockBackendShutdown).toHaveBeenCalledTimes(1);
        expect(mgr.isBackendRestartPending("opencode")).toBe(false);
        expect(mgr.hasHeldConfigChange("opencode")).toBe(false);
      });

      it("clears the held config after a backend exit so retry does not offer another reload (https://github.com/Brevilabs/obsidian-copilot-private/issues/475)", async () => {
        const mgr = buildManager();
        await mgr.createSession();
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
        const first = await mgr.createSession();
        const second = await mgr.createSession();
        mgr.setActiveSession(first.internalId);
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

      it("preserves composers across scopes without surfacing detached conversations (https://github.com/Brevilabs/obsidian-copilot-private/issues/475)", async () => {
        const projectId = "project-with-drafts";
        seedProjects(projectId);
        const mgr = buildManager();
        const old = await enterWithConversation(mgr, projectId);
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
      });
    });

    describe("restartBackend()", () => {
      it("returns false when the backend has not been started", async () => {
        const mgr = buildManager();

        await expect(mgr.restartBackend("opencode", "skills changed")).resolves.toBe(false);
        expect(mockBackendShutdown).not.toHaveBeenCalled();
      });

      it("restarts an idle backend and replaces the active affected session", async () => {
        const mgr = buildManager();
        const first = await mgr.createSession();

        await expect(mgr.restartBackend("opencode", "skills changed")).resolves.toBe(true);

        expect(mockSessionCancel).toHaveBeenCalledWith();
        expect(mockSessionDispose).toHaveBeenCalledWith();
        expect(mockBackendShutdown).toHaveBeenCalledTimes(1);
        expect(mgr.getSessions()).toHaveLength(1);
        expect(mgr.getActiveSession()).not.toBe(first);
        expect(mgr.getActiveSession()?.backendId).toBe("opencode");
      });

      it("refreshes a warm preload probe when the manager owns no process yet", async () => {
        const refresh = jest.fn(() => Promise.resolve());
        const mgr = buildManager({ preloader: { refresh } });

        await expect(mgr.restartBackend("opencode", "byok key added")).resolves.toBe(true);
        expect(refresh).toHaveBeenCalledWith("opencode");
        expect(mockBackendShutdown).not.toHaveBeenCalled();
      });

      it("does not refresh a warm probe when nothing was preloaded", async () => {
        const refresh = jest.fn(() => null);
        const mgr = buildManager({ preloader: { refresh } });

        await expect(mgr.restartBackend("opencode", "byok key added")).resolves.toBe(false);
        expect(refresh).toHaveBeenCalledWith("opencode");
      });

      it("re-probes after restart when no replacement session is created", async () => {
        const preload = jest.fn(async () => undefined);
        const mgr = buildManager({ preloader: { preload } });
        const session = await mgr.createSession();
        await mgr.closeSession(session.internalId);
        preload.mockClear();

        await expect(mgr.restartBackend("opencode", "byok save")).resolves.toBe(true);

        expect(mockBackendShutdown).toHaveBeenCalled();
        expect(preload).toHaveBeenCalledWith("opencode");
      });

      it("re-probes before creating the replacement so the effort catalog is rebuilt", async () => {
        const preload = jest.fn(async () => undefined);
        const mgr = buildManager({ preloader: { preload } });
        const first = await mgr.createSession();
        preload.mockClear();
        sessionCreateSpy.mockClear();

        await expect(
          mgr.restartBackend("opencode", "backend enabled models changed")
        ).resolves.toBe(true);

        expect(preload).toHaveBeenCalledTimes(1);
        expect(preload).toHaveBeenCalledWith("opencode");
        expect(sessionCreateSpy).toHaveBeenCalledTimes(1);
        expect(preload.mock.invocationCallOrder[0]).toBeLessThan(
          sessionCreateSpy.mock.invocationCallOrder[0]
        );
        expect(mgr.getActiveSession()).not.toBe(first);
        expect(mgr.getActiveSession()?.backendId).toBe("opencode");
      });

      it("gives the replacement the replaced session's chat input so the composer draft survives (https://github.com/Brevilabs/obsidian-copilot-private/issues/473)", async () => {
        const mgr = buildManager();
        const first = await mgr.createSession();
        const chatInputId = first.chatInputId;
        mgr.drafts.update(chatInputId, (draft) => ({ ...draft, input: "half-written question" }));

        await mgr.restartBackend("opencode", "byok key saved");

        expect(mgr.getActiveSession()).not.toBe(first);
        expect(mgr.getActiveSession()?.chatInputId).toBe(chatInputId);
        expect(mgr.drafts.get(chatInputId)?.input).toBe("half-written question");
      });

      it("reports the replaced chat input as live while no session owns it (https://github.com/Brevilabs/obsidian-copilot-private/issues/473)", async () => {
        const liveDuringGap: string[][] = [];
        const mgr: AgentSessionManager = buildManager({
          preloader: {
            preload: jest.fn(async () => {
              liveDuringGap.push([...mgr.getLiveChatInputIds()]);
            }),
          },
        });
        const first = await mgr.createSession();
        const chatInputId = first.chatInputId;

        await mgr.restartBackend("opencode", "byok key saved");

        expect(liveDuringGap.at(-1)).toContain(chatInputId);
        expect(mgr.getLiveChatInputIds()).toEqual([chatInputId]);
      });

      it.each([
        ["resumes each tab's conversation in place", false],
        ["recreates each tab as a fresh conversation", true],
      ] as const)(
        "preserves each tab's model and effort when the restart %s (https://github.com/logancyang/obsidian-copilot/issues/3319)",
        async (_case, unsupported) => {
          const state = (baseModelId: string, effort: string): BackendState => ({
            model: {
              current: { baseModelId, effort },
              availableModels: [],
              apply: { kind: "setModel" },
            },
            mode: null,
          });
          const mgr = buildManagerWithReplay(
            {
              loadSession: jest.fn(async ({ sessionId }: { sessionId: string }) => {
                if (unsupported) throw new MethodUnsupportedError("session/load");
                return { sessionId, state: state("big-pickle", "low") };
              }),
              resumeSession: jest.fn(async () => {
                throw new MethodUnsupportedError("session/resume");
              }),
              setSessionModel: jest.fn(async ({ modelId }: { modelId: string }) => {
                const selection = JSON.parse(modelId);
                return state(selection.baseModelId, selection.effort);
              }),
            },
            {
              applySelection: async (session, selection) =>
                session.applyModelWireId(JSON.stringify(selection)),
            }
          );
          const flash = await mgr.createSession();
          const reasoning = await mgr.createSession();
          jest.spyOn(flash, "getState").mockReturnValue(state("copilot-plus/flash", "high"));
          jest
            .spyOn(reasoning, "getState")
            .mockReturnValue(state("copilot-plus/reasoning", "medium"));
          sessionCreateSpy.mockClear();

          await mgr.restartBackend("opencode", "config changed");

          if (unsupported) {
            expect(sessionCreateSpy.mock.calls.map(([opts]) => opts.defaultModelSelection)).toEqual(
              [
                { baseModelId: "copilot-plus/flash", effort: "high" },
                { baseModelId: "copilot-plus/reasoning", effort: "medium" },
              ]
            );
          } else {
            expect(mgr.getSessions().map((session) => session.getState()?.model?.current)).toEqual([
              { baseModelId: "copilot-plus/flash", effort: "high" },
              { baseModelId: "copilot-plus/reasoning", effort: "medium" },
            ]);
          }
          await mgr.shutdown();
        }
      );

      it.each([
        ["resumes the tab's conversation in place", false],
        ["recreates the tab as a fresh conversation", true],
      ] as const)(
        "replaces a disabled tab model with the enabled default when the restart %s (https://github.com/logancyang/obsidian-copilot/issues/3319)",
        async (_case, unsupported) => {
          const originalSettings = getSettingsMock.getMockImplementation();
          const saved = { baseModelId: "copilot-plus/flash", effort: "high" };
          getSettingsMock.mockReturnValue({
            agentMode: { backends: { opencode: { defaultModel: saved } } },
          });
          const state: BackendState = {
            model: {
              current: { baseModelId: "big-pickle", effort: "low" },
              apply: { kind: "setModel" },
              availableModels: [
                {
                  baseModelId: saved.baseModelId,
                  name: "Flash",
                  provider: null,
                  effortOptions: [],
                },
              ],
            },
            mode: null,
          };
          const mgr = buildManagerWithReplay(
            {
              loadSession: jest.fn(async ({ sessionId }: { sessionId: string }) => {
                if (unsupported) throw new MethodUnsupportedError("session/load");
                return { sessionId, state };
              }),
              resumeSession: jest.fn(async () => {
                throw new MethodUnsupportedError("session/resume");
              }),
              setSessionModel: jest.fn(async ({ modelId }: { modelId: string }) => ({
                ...state,
                model: { ...state.model!, current: JSON.parse(modelId) },
              })),
            },
            {
              getEnabledModelEntries: () => [
                { baseModelId: saved.baseModelId, name: "Flash", credentialState: "ok" },
              ],
              applySelection: async (session, selection) =>
                session.applyModelWireId(JSON.stringify(selection)),
            }
          );
          try {
            const first = await mgr.createSession();
            jest.spyOn(first, "getState").mockReturnValue({
              ...state,
              model: {
                ...state.model!,
                current: { baseModelId: "disabled-model", effort: "medium" },
              },
            });
            sessionCreateSpy.mockClear();

            await mgr.restartBackend("opencode", "enabled models changed");

            if (unsupported) {
              expect(sessionCreateSpy).toHaveBeenLastCalledWith(
                expect.objectContaining({ defaultModelSelection: saved })
              );
            } else {
              expect(mgr.getActiveSession()?.getState()?.model?.current).toEqual(saved);
            }
          } finally {
            await mgr.shutdown();
            getSettingsMock.mockImplementation(originalSettings);
          }
        }
      );

      it("settles the resumed tab on the seeded model's own effort, not the effort of the model it left (https://github.com/logancyang/obsidian-copilot/issues/3319)", async () => {
        // The seed must update the model catalog before startup config resolves effort.
        // https://github.com/logancyang/obsidian-copilot/issues/3319
        const server = { baseModelId: "big-pickle", effort: "low" };
        const catalogBeforeSetModel = [
          { baseModelId: "big-pickle", name: "Big Pickle", provider: null, effortOptions: [] },
          {
            baseModelId: "copilot-plus/reasoning",
            name: "Reasoning",
            provider: null,
            effortOptions: [{ value: "medium", label: "Medium" }],
          },
        ];
        const catalogAfterSetModel = [
          {
            baseModelId: "copilot-plus/reasoning",
            name: "Reasoning",
            provider: null,
            effortOptions: [
              { value: "high", label: "High" },
              { value: "medium", label: "Medium" },
            ],
          },
        ];
        const stateFor = (availableModels: unknown): BackendState =>
          ({
            model: { current: { ...server }, apply: { kind: "setModel" }, availableModels },
            mode: null,
          }) as BackendState;
        const mgr = buildManagerWithReplay(
          {
            loadSession: jest.fn(async ({ sessionId }: { sessionId: string }) => ({
              sessionId,
              state: stateFor(catalogBeforeSetModel),
            })),
            setSessionModel: jest.fn(async ({ modelId }: { modelId: string }) => {
              const selection = JSON.parse(modelId);
              server.baseModelId = selection.baseModelId;
              server.effort = selection.effort;
              return stateFor(catalogAfterSetModel);
            }),
            setSessionConfigOption: jest.fn(async ({ value }: { value: string }) => {
              server.effort = value;
              return stateFor(catalogAfterSetModel);
            }),
          },
          {
            applySelection: async (session: AgentSession, selection: ModelSelection) =>
              session.applyModelWireId(JSON.stringify(selection)),
            applyInitialSessionConfig: async (
              session: AgentSession,
              _settings: unknown,
              seeded?: ModelSelection
            ) => {
              const model = session.getState()?.model;
              if (!model) return;
              const options = (
                model.availableModels.find((e) => e.baseModelId === model.current.baseModelId)
                  ?.effortOptions ?? []
              ).map((option) => option.value);
              const effort =
                seeded?.effort && options.includes(seeded.effort) ? seeded.effort : options[0];
              if (effort && effort !== model.current.effort) {
                await session.setConfigOption("effort", effort);
              }
            },
          }
        );
        const chat = await mgr.createSession();
        jest.spyOn(chat, "getState").mockReturnValue({
          model: {
            current: { baseModelId: "copilot-plus/reasoning", effort: "high" },
            apply: { kind: "setModel" },
            availableModels: catalogBeforeSetModel,
          },
          mode: null,
        } as unknown as BackendState);

        await mgr.restartBackend("opencode", "config changed");

        expect(server).toEqual({ baseModelId: "copilot-plus/reasoning", effort: "high" });
        await mgr.shutdown();
      });

      it("brings the replaced tab back on its own conversation (https://github.com/Brevilabs/obsidian-copilot-private/issues/475)", async () => {
        const loadSession = jest.fn(async ({ sessionId }: { sessionId: string }) => ({
          sessionId,
          state: { model: null, mode: null },
        }));
        const mgr = buildManagerWithReplay({ loadSession });
        const first = await mgr.createSession();
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
        const mgr = buildManagerWithReplay();
        const first = await mgr.createSession();
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
        const first = await mgr.createSession();
        const chatInputId = first.chatInputId;

        await mgr.restartBackend("opencode", "managed skills changed");

        const replacement = mgr.getActiveSession();
        expect(replacement).not.toBe(first);
        expect(replacement?.getBackendSessionId()).not.toBe(first.getBackendSessionId());
        expect(replacement?.chatInputId).toBe(chatInputId);
        expect(mgr.getSessions()).toHaveLength(1);
      });

      it("defers restart until an active turn leaves running", async () => {
        const mgr = buildManager();
        const first = await mgr.createSession();
        getSessionTestHandle(first).setStatus("running");

        await expect(mgr.restartBackend("opencode", "skills changed")).resolves.toBe(true);
        expect(mockBackendShutdown).not.toHaveBeenCalled();

        getSessionTestHandle(first).setStatus("idle");
        await flushTimers();

        expect(mockBackendShutdown).toHaveBeenCalledTimes(1);
        expect(mgr.getActiveSession()).not.toBe(first);
        expect(mgr.getActiveSession()?.backendId).toBe("opencode");
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/121 interrupts a busy turn when a privacy-boundary restart cannot be deferred", async () => {
        const mgr = buildManager();
        const first = await mgr.createSession();
        getSessionTestHandle(first).setStatus("running");

        await expect(
          mgr.restartBackend("opencode", "Miyo Search scope changed", { deferWhileBusy: false })
        ).resolves.toBe(true);

        expect(mockSessionCancel).toHaveBeenCalledWith();
        expect(mockBackendShutdown).toHaveBeenCalledTimes(1);
        expect(mgr.getActiveSession()).not.toBe(first);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/121 runs a non-deferrable restart immediately even with a held config change (https://github.com/Brevilabs/obsidian-copilot-private/issues/475)", async () => {
        const mgr = buildManager();
        await mgr.createSession();

        await mgr.noteSpawnConfigChanged("opencode", "managed skills changed");
        await mgr.restartBackend("opencode", "Miyo Search scope changed", {
          deferWhileBusy: false,
        });

        expect(mockBackendShutdown).toHaveBeenCalledTimes(1);
        expect(mgr.hasHeldConfigChange("opencode")).toBe(false);
      });

      it("queues a second concurrent restart so the latest settings are not lost", async () => {
        const mgr = buildManager();
        await mgr.createSession();
        const shutdown = holdNextBackendShutdown();

        const first = mgr.restartBackend("opencode", "byok save #1");
        await shutdown.started;
        const second = mgr.restartBackend("opencode", "byok save #2");
        shutdown.release();
        await Promise.all([first, second]);
        await flushTimers();

        expect(mockBackendShutdown).toHaveBeenCalledTimes(2);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/121 keeps a queued privacy-boundary restart non-deferrable", async () => {
        const mgr = buildManager();
        await mgr.createSession();
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
        const shutdown = holdNextBackendShutdown();

        const ordinaryRestart = mgr.restartBackend("opencode", "managed env changed");
        await shutdown.started;
        const privacyRestart = mgr.restartBackend("opencode", "Miyo Search scope changed", {
          deferWhileBusy: false,
        });
        shutdown.release();
        await Promise.all([ordinaryRestart, privacyRestart]);
        await flushTimers();

        expect(mockBackendShutdown).toHaveBeenCalledTimes(2);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/561 restarts after the failed turn settles and keeps its user message and clear error", async () => {
        const mgr = buildManagerWithReplay();
        const first = await mgr.createSession();
        const firstHandle = getSessionTestHandle(first);
        firstHandle.setStatus("running");

        mockUnhealthyHandler?.();
        expect(mockBackendShutdown).not.toHaveBeenCalled();

        const failedTurn = [
          { message: "Summarize this note" },
          {
            message: "OpenCode's internal service stopped. Please try again.",
            isErrorMessage: true,
          },
        ];
        firstHandle.setMessages(failedTurn, true);
        firstHandle.setStatus("error");
        await flushTimers();

        expect(mockBackendShutdown).toHaveBeenCalledTimes(1);
        expect(mgr.getActiveSession()).not.toBe(first);
        expect(
          mgr
            .getActiveSession()
            ?.store.getDisplayMessages()
            .map((m) => m.message)
        ).toEqual(failedTurn.map((m) => m.message));
        expect(mgr.getActiveSession()?.store.getDisplayMessages().at(-1)?.isErrorMessage).toBe(
          true
        );
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/561 keeps failed turns from two chats sharing the same OpenCode process", async () => {
        const mgr = buildManagerWithReplay();
        const first = await mgr.createSession();
        const second = await mgr.createSession();
        getSessionTestHandle(first).setStatus("running");
        getSessionTestHandle(second).setStatus("running");

        mockUnhealthyHandler?.();
        const firstMessages = [
          { message: "First question" },
          { message: "Internal error: Internal service failure", isErrorMessage: true },
        ];
        const secondMessages = [
          { message: "Second question" },
          {
            message: "OpenCode's internal service stopped. Please try again.",
            isErrorMessage: true,
          },
        ];
        getSessionTestHandle(first).setMessages(firstMessages);
        getSessionTestHandle(first).setStatus("error");
        expect(mockBackendShutdown).not.toHaveBeenCalled();
        getSessionTestHandle(second).setMessages(secondMessages);
        getSessionTestHandle(second).setStatus("error");
        await flushTimers();

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
        const first = await mgr.createSession();
        getSessionTestHandle(first).setMessages([{ message: "Local draft transcript" }]);

        await mgr.restartBackend("opencode", "models changed");

        expect(mgr.getActiveSession()?.store.getDisplayMessages()).toEqual([]);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/561 keeps a fresh fallback free of messages the new backend never received", async () => {
        const mgr = buildManager();
        const first = await mgr.createSession();
        const handle = getSessionTestHandle(first);
        handle.setStatus("running");
        mockUnhealthyHandler?.();
        handle.setMessages([
          { message: "Unsaved prompt" },
          { message: "OpenCode's internal service stopped. Please try again." },
        ]);
        handle.setStatus("error");
        await flushTimers();

        expect(mgr.getActiveSession()?.getBackendSessionId()).not.toBe(first.getBackendSessionId());
        expect(mgr.getActiveSession()?.store.getDisplayMessages()).toEqual([]);
      });
    });

    describe("onInstallStateChanged()", () => {
      function buildInstallStateManager(opts: {
        installState: InstallState;
        refreshResult?: Promise<void> | null;
      }) {
        let installState = opts.installState;
        const preloader = {
          preload: jest.fn(async () => undefined),
          refresh: jest.fn(() => opts.refreshResult ?? null),
          clearCached: jest.fn(),
        };
        const mgr = buildManager({
          descriptor: buildDescriptor({ getInstallState: jest.fn(() => installState) }),
          preloader,
        });
        return {
          mgr,
          preloader,
          setInstallState: (state: InstallState) => (installState = state),
        };
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
        await mgr.createSession();
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
        await mgr.createSession();
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
        await mgr.createSession();
        mockBackendShutdown.mockClear();

        await mgr.onInstallStateChanged("opencode");

        expect(mockBackendShutdown).not.toHaveBeenCalled();
        expect(preloader.clearCached).not.toHaveBeenCalled();
        expect(preloader.refresh).not.toHaveBeenCalled();
        expect(preloader.preload).not.toHaveBeenCalled();
      });
    });

    describe("registerPreload()", () => {
      it("moves a backend from pending to ready once the preload resolves", async () => {
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

      it("moves a backend from pending to error when the preload rejects yet still reports ready so chat unblocks", async () => {
        const mgr = buildManager();
        mgr.registerPreload(
          "opencode",
          Promise.reject(new Error("preload failed")).catch((e) => {
            throw e;
          })
        );
        await flushTimers();
        expect(mgr.getPreloadStatus("opencode")).toBe("error");
        expect(mgr.isPreloadReady("opencode")).toBe(true);
      });
    });

    describe("isPreloadReady()", () => {
      it("treats a backend with no registered preload as ready", () => {
        expect(buildManager().isPreloadReady("opencode")).toBe(true);
      });
    });

    describe("getPreloadStatus()", () => {
      it("reports absent for a backend with no registered preload", () => {
        expect(buildManager().getPreloadStatus("opencode")).toBe("absent");
      });
    });

    describe("getCachedModelCatalog()", () => {
      it("returns the catalog owned by the preloader's probe", () => {
        const catalog = modelCatalog("catalog");
        const mgr = buildManager({ preloader: { getCachedModelCatalog: jest.fn(() => catalog) } });

        expect(mgr.getCachedModelCatalog("opencode")).toBe(catalog);
      });
    });

    describe("getModelCacheSignature()", () => {
      it("is stable when shared discovery is unchanged", () => {
        const catalog = modelCatalog("catalog");
        const first = buildManager({ preloader: { getCachedModelCatalog: () => catalog } });
        const second = buildManager({ preloader: { getCachedModelCatalog: () => catalog } });

        expect(first.getModelCacheSignature("opencode")).toBe(
          second.getModelCacheSignature("opencode")
        );
      });

      it("changes when shared model discovery changes", () => {
        const first = buildManager({
          preloader: { getCachedModelCatalog: () => modelCatalog("first-catalog") },
        });
        const second = buildManager({
          preloader: { getCachedModelCatalog: () => modelCatalog("second-catalog") },
        });

        expect(first.getModelCacheSignature("opencode")).not.toBe(
          second.getModelCacheSignature("opencode")
        );
      });
    });

    describe("getSeedSelection()", () => {
      function buildManagerWithOffered(
        offered:
          | readonly (string | { baseModelId: string; credentialState: "ok" | "missing_key" })[]
          | undefined,
        saved: { baseModelId: string; effort: string | null } | null,
        routesCopilotModels = false
      ): AgentSessionManager {
        mockSavedDefault(saved);
        return buildManager({
          descriptor: buildDescriptor(
            offered
              ? {
                  routesCopilotModels,
                  getEnabledModelEntries: () =>
                    offered.map((entry) =>
                      typeof entry === "string"
                        ? { baseModelId: entry, name: entry, credentialState: "ok" }
                        : { ...entry, name: entry.baseModelId }
                    ),
                }
              : {}
          ),
        });
      }

      it("returns null when nothing has been saved", () => {
        expect(
          buildManagerWithOffered(["copilot-plus/flash"], null).getSeedSelection("opencode")
        ).toBeNull();
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/625 seeds the first enabled model with a working key when nothing is saved for a backend that may only run enabled models", () => {
        const mgr = buildManagerWithOffered(
          [
            { baseModelId: "byok/gpt-5.6", credentialState: "missing_key" },
            "copilot-plus/flash",
            "copilot-plus/glm-5.2",
          ],
          null,
          true
        );

        expect(mgr.getSeedSelection("opencode")).toEqual({
          baseModelId: "copilot-plus/flash",
          effort: null,
        });
        expect(Notice).not.toHaveBeenCalled();
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/625 seeds nothing, even from a saved default, when a backend that may only run enabled models has none enabled", () => {
        const mgr = buildManagerWithOffered(
          [],
          { baseModelId: "copilot-plus/glm-5.2", effort: null },
          true
        );

        expect(mgr.getSeedSelection("opencode")).toBeNull();
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

      it.each([
        {
          name: "prefers a carried-over selection over the saved default while its model is offered",
          offered: ["copilot-plus/flash", "copilot-plus/glm-5.2"],
          saved: { baseModelId: "copilot-plus/flash", effort: "low" },
          preferred: { baseModelId: "copilot-plus/glm-5.2", effort: "high" },
          expected: { baseModelId: "copilot-plus/glm-5.2", effort: "high" },
        },
        {
          name: "falls back to the saved default when the carried-over model is no longer offered",
          offered: ["copilot-plus/flash"],
          saved: { baseModelId: "copilot-plus/flash", effort: "low" },
          preferred: { baseModelId: "copilot-plus/glm-5.2", effort: "high" },
          expected: { baseModelId: "copilot-plus/flash", effort: "low" },
        },
        {
          name: "stands in with an enabled model when the carried-over model was turned off and no saved default can replace it",
          offered: ["copilot-plus/flash"],
          saved: null,
          preferred: { baseModelId: "copilot-plus/glm-5.2", effort: "high" },
          expected: { baseModelId: "copilot-plus/flash", effort: null },
        },
        {
          name: "returns null when there is neither a carried-over selection nor a saved default",
          offered: ["copilot-plus/flash"],
          saved: null,
          preferred: undefined,
          expected: null,
        },
      ] as {
        name: string;
        offered: string[];
        saved: { baseModelId: string; effort: string } | null;
        preferred: { baseModelId: string; effort: string } | undefined;
        expected: { baseModelId: string; effort: string | null } | null;
      }[])("$name (https://github.com/logancyang/obsidian-copilot/issues/3319)", (testCase) => {
        const mgr = buildManagerWithOffered(testCase.offered, testCase.saved);

        expect(mgr.getSeedSelection("opencode", testCase.preferred)).toEqual(testCase.expected);
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

      it("uses a credential-ready fallback and reports the substitution when the saved model has no key (https://github.com/Brevilabs/obsidian-copilot-private/issues/474)", () => {
        const mgr = buildManagerWithOffered(
          [{ baseModelId: "byok/gpt-5.6", credentialState: "missing_key" }, "copilot-plus/flash"],
          { baseModelId: "byok/gpt-5.6", effort: "high" }
        );

        expect(mgr.getSeedSelection("opencode")).toEqual({
          baseModelId: "copilot-plus/flash",
          effort: null,
        });
        expect((Notice as unknown as jest.Mock).mock.calls.at(-1)?.[0]).toBe(
          "opencode couldn't use gpt-5.6. Using copilot-plus/flash instead."
        );
      });

      it("returns null and reports the unavailable selection when no enabled model is runnable (https://github.com/Brevilabs/obsidian-copilot-private/issues/474)", () => {
        const mgr = buildManagerWithOffered(
          [{ baseModelId: "byok/gpt-5.6", credentialState: "missing_key" }],
          { baseModelId: "copilot-plus/minimax-m2.7", effort: null }
        );

        expect(mgr.getSeedSelection("opencode")).toBeNull();
        expect(noticeMock.mock.calls.at(-1)?.[0]).toBe(
          "opencode couldn't use minimax-m2.7. Enable a model opencode can run."
        );
      });

      it("reports an unavailable model once, not on every selection read (https://github.com/Brevilabs/obsidian-copilot-private/issues/474)", () => {
        const mgr = buildManagerWithOffered(["copilot-plus/flash"], {
          baseModelId: "copilot-plus/minimax-m2.7",
          effort: null,
        });

        mgr.getSeedSelection("opencode");
        mgr.getSeedSelection("opencode");

        expect(Notice).toHaveBeenCalledTimes(1);
        expect(noticeMock.mock.calls[0][0]).toContain("minimax-m2.7");
        expect(noticeMock.mock.calls[0][0]).toContain("copilot-plus/flash");
      });

      it("reports each unavailable model once (https://github.com/Brevilabs/obsidian-copilot-private/issues/474)", () => {
        const mgr = buildManagerWithOffered(["copilot-plus/flash"], {
          baseModelId: "copilot-plus/model-a",
          effort: null,
        });
        mgr.getSeedSelection("opencode");
        expect(noticeMock.mock.calls.at(-1)?.[0]).toContain("model-a");

        mockSavedDefault({ baseModelId: "copilot-plus/model-b", effort: null });
        mgr.getSeedSelection("opencode");

        expect(Notice).toHaveBeenCalledTimes(2);
        expect(noticeMock.mock.calls.at(-1)?.[0]).toContain("model-b");
      });

      it("reports when a restarted chat falls back to the saved default (https://github.com/logancyang/obsidian-copilot/issues/3319)", () => {
        const saved = { baseModelId: "copilot-plus/flash", effort: "low" };
        const mgr = buildManagerWithOffered([saved.baseModelId], saved);

        expect(
          mgr.getSeedSelection("opencode", {
            baseModelId: "copilot-plus/minimax-m2.7",
            effort: "high",
          })
        ).toEqual(saved);
        expect((Notice as unknown as jest.Mock).mock.calls.at(-1)?.[0]).toBe(
          "opencode couldn't use minimax-m2.7. Using copilot-plus/flash instead."
        );
      });

      it("reports the same unavailable model only once across open-chat and saved-default reads (https://github.com/logancyang/obsidian-copilot/issues/3319)", () => {
        const mgr = buildManagerWithOffered(["copilot-plus/flash"], null);
        const unavailable = {
          baseModelId: "copilot-plus/minimax-m2.7",
          effort: null,
        };
        mgr.getSeedSelection("opencode", unavailable);

        mockSavedDefault(unavailable);
        mgr.getSeedSelection("opencode");

        expect(Notice).toHaveBeenCalledTimes(1);
      });

      it("returns null when the enabled list is empty rather than reapplying the model the user just disabled (https://github.com/logancyang/obsidian-copilot/issues/3319)", () => {
        const saved = { baseModelId: "copilot-plus/glm-5.2", effort: null };
        const mgr = buildManagerWithOffered([], saved);

        expect(mgr.getSeedSelection("opencode")).toBeNull();
        expect(Notice).toHaveBeenCalledTimes(1);
      });

      it("keeps the saved selection when the backend publishes no enabled-model list (https://github.com/Brevilabs/obsidian-copilot-private/issues/474)", () => {
        const saved = { baseModelId: "copilot-plus/glm-5.2", effort: null };
        const mgr = buildManagerWithOffered(undefined, saved);

        expect(mgr.getSeedSelection("opencode")).toEqual(saved);
        expect(Notice).not.toHaveBeenCalled();
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

    describe("applySelection()", () => {
      it("no-ops when no session is active", async () => {
        const mgr = buildManager();
        await expect(
          mgr.applySelection({ effort: "high" }, { expectBackendId: "opencode" })
        ).resolves.toBeUndefined();
      });

      it("no-ops when the active session is on a different backend", async () => {
        const mgr = buildManager();
        await mgr.createSession();
        await expect(
          mgr.applySelection({ effort: "high" }, { expectBackendId: "claude" })
        ).resolves.toBeUndefined();
      });

      it("delegates dispatch to descriptor.applySelection with the resolved selection", async () => {
        const applySelection = jest.fn(async () => {});
        const mgr = buildManager({ descriptor: buildApplySelectionDescriptor(applySelection) });
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
        const session = await mgr.createSession();

        setSettingsMock.mockClear();
        await mgr.applySelection({ effort: "high" }, { expectBackendId: "opencode" });
        expect(applySelection).toHaveBeenCalledWith(session, {
          baseModelId: "anthropic/sonnet",
          effort: "high",
        });
        expect(readPersistedDefault(setSettingsMock, "opencode")).toBeUndefined();

        applySelection.mockClear();
        setSettingsMock.mockClear();
        await mgr.applySelection({ baseModelId: "anthropic/opus", effort: null });
        expect(applySelection).toHaveBeenCalledWith(session, {
          baseModelId: "anthropic/opus",
          effort: null,
        });
        expect(readPersistedDefault(setSettingsMock, "opencode")).toBeUndefined();
      });
    });

    describe("applyMode()", () => {
      function buildModeManager(
        getModeMapping: BackendDescriptor["getModeMapping"]
      ): AgentSessionManager {
        return buildManager({
          descriptor: buildDescriptor({ id: "claude", displayName: "Claude", getModeMapping }),
        });
      }

      it("refreshes a state-independent native mapping before dispatch", async () => {
        const manager = buildModeManager(() => ({
          kind: "setMode",
          canonical: { default: "default", plan: "plan", auto: "auto" },
        }));
        const session = await manager.createSession("claude");

        await manager.applyMode("claude", "auto", {
          kind: "setMode",
          nativeId: "bypassPermissions",
        });

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

        await manager.applyMode("claude", "auto", {
          kind: "setMode",
          nativeId: "cached-auto",
        });

        expect(session.setMode).toHaveBeenCalledWith("cached-auto");
      });

      it("preserves Codex approval mode ids without an inventory (https://github.com/logancyang/obsidian-copilot/issues/2916)", async () => {
        const manager = buildModeManager(buildCodexModeMapping);
        const session = await manager.createSession("claude");

        for (const [mode, nativeId] of [
          ["default", "read-only"],
          ["auto", "agent"],
        ] as const) {
          await manager.applyMode("claude", mode, { kind: "setMode", nativeId });
        }

        expect(session.setMode).toHaveBeenNthCalledWith(1, "read-only");
        expect(session.setMode).toHaveBeenNthCalledWith(2, "agent");
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/551 applies both Codex Plan settings without replacing the translated choice", async () => {
        const manager = buildModeManager(buildCodexModeMapping);
        const session = await manager.createSession("claude");

        await manager.applyMode("claude", "plan", {
          kind: "sequence",
          steps: [
            { kind: "setMode", nativeId: "agent" },
            { kind: "setConfigOption", configId: "collaboration_mode", value: "plan" },
          ],
        });

        expect(session.setMode).toHaveBeenCalledWith("agent");
        expect(session.setConfigOption).toHaveBeenCalledWith("collaboration_mode", "plan");
      });
    });

    describe("saveActiveSession()", () => {
      it("persists the active chat's messages and returns the saved note path", async () => {
        const { mgr, saveSession } = savedNoteFixture();
        const session = await mgr.createSession();
        const messages = [{ message: "Question" }, { message: "Answer" }];
        getSessionTestHandle(session).setMessages(messages);

        await expect(mgr.saveActiveSession()).resolves.toEqual({ path: "chats/saved.md" });

        expect(saveSession).toHaveBeenCalledWith(messages, session.backendId, expect.anything());
      });

      it("persists changes during the first manual save for https://github.com/logancyang/obsidian-copilot/issues/3225", async () => {
        const { mgr, saveSession } = savedNoteFixture();
        let finishSave!: (result: { path: string }) => void;
        saveSession.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finishSave = resolve;
            })
        );
        const session = await mgr.createSession();
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

    describe("getSessionSourcePath()", () => {
      it("keeps unsaved sessions independent of a saved session and follows its file rename https://github.com/Brevilabs/obsidian-copilot-private/issues/539", async () => {
        const file = mockTFile({ path: "chat/Conversation.md" });
        const app = buildApp();
        jest.mocked(app.vault.getAbstractFileByPath).mockReturnValue(file);
        const saveSession = jest.fn().mockResolvedValue({ path: file.path });
        const mgr = buildManager({ app, persistence: { saveSession } });
        const first = await mgr.createSession();
        expect(mgr.getSessionSourcePath(first.internalId)).toBe("");
        getSessionTestHandle(first).setMessages([{ message: "Hello" }]);
        const listener = jest.fn();
        mgr.subscribe(listener);
        await mgr.saveActiveSession();
        expect(listener).toHaveBeenCalledTimes(1);
        expect(mgr.getSessionSourcePath(first.internalId)).toBe(file.path);
        file.path = "archive/Conversation.md";
        expect(mgr.getSessionSourcePath(first.internalId)).toBe(file.path);
        expect(await mgr.saveActiveSession()).toEqual({ path: file.path });
        const second = await mgr.createSession();
        expect(mgr.getSessionSourcePath(second.internalId)).toBe("");
        mgr.setActiveSession(first.internalId);
        getSessionTestHandle(first).setMessages([{ message: "Changed" }]);
        saveSession.mockResolvedValue(null);
        await mgr.saveActiveSession();
        expect(mgr.getSessionSourcePath(first.internalId)).toBe(file.path);
        expect(saveSession).toHaveBeenLastCalledWith(
          expect.anything(),
          first.backendId,
          expect.objectContaining({ existingPath: file.path })
        );
      });

      it("uses the loaded conversation file before any save https://github.com/Brevilabs/obsidian-copilot-private/issues/539", async () => {
        const file = mockTFile({ path: "chat/Loaded.md" });
        const loadFile = jest.fn().mockResolvedValue({
          backendId: "opencode",
          projectId: GLOBAL_SCOPE,
          messages: [{ message: "Loaded" }],
        });
        const mgr = buildManager({ persistence: { loadFile } });
        const loaded = await mgr.loadSessionFromHistory(file);
        expect(mgr.getSessionSourcePath(loaded.internalId)).toBe(file.path);
        file.path = "archive/Loaded.md";
        expect(mgr.getSessionSourcePath(loaded.internalId)).toBe(file.path);
      });
    });

    describe("getChatHistoryItems()", () => {
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

      it("scopes a project view's native entries by the index's recorded projectId", async () => {
        const { manager, index } = buildHistoryHarness();
        await index.recordSession({
          backendId: "codex",
          sessionId: "in-project",
          title: "Project chat",
          createdAtMs: 1_000,
          lastAccessedAtMs: 2_000,
          projectId: HISTORY_PROJECT_ID,
        });
        await index.recordSession({
          backendId: "codex",
          sessionId: "global-chat",
          title: "Global chat",
          createdAtMs: 1_000,
          lastAccessedAtMs: 2_000,
        });

        const projectItems = await manager.getChatHistoryItems(HISTORY_PROJECT_ID);
        expect(projectItems).toHaveLength(1);
        expect(projectItems[0]?.id).toBe(buildNativeChatId("codex", "in-project"));

        expect(await manager.getChatHistoryItems()).toHaveLength(2);
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

      it("tombstones the native twin of a dropped non-local markdown chat", async () => {
        const { manager, index } = buildHistoryHarness({
          files: {
            "chats/agent__foreign.md": {
              epoch: 1_000,
              topic: "Made elsewhere",
              backendId: "opencode",
              sessionId: "foreign",
            },
          },
          warmSessionExistsLocally: jest.fn(async () => false),
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

      it("probes a project chat's resumability with its project cwd, not the vault root", async () => {
        seedProjects(HISTORY_PROJECT_ID);
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
              projectId: HISTORY_PROJECT_ID,
            },
          },
          warmSessionExistsLocally: sessionExistsLocally,
        });

        const titles = (await manager.getChatHistoryItems(HISTORY_PROJECT_ID)).map((i) => i.title);
        expect(titles).toContain("Project chat");
        expect(sessionExistsLocally).toHaveBeenCalledWith({
          sessionId: "proj-sess",
          cwd: join("/vault", "Projects", "proj-1"),
        });
      });

      it("probes each chat with its own scope cwd in the global flat view", async () => {
        seedProjects(HISTORY_PROJECT_ID);
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
              projectId: HISTORY_PROJECT_ID,
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
            {
              sessionId: "other-vault",
              cwd: "/elsewhere",
              title: "Foreign chat",
              updatedAt: null,
            },
            { sessionId: "untitled", cwd: "/vault", title: null, updatedAt: null },
            {
              sessionId: "placeholder",
              cwd: "/vault",
              title: "New session - 1",
              updatedAt: null,
            },
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

    describe("deleteChatHistory()", () => {
      it("tombstones a native entry without touching persistence", async () => {
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

      it("deletes a markdown chat and also tombstones its native twin", async () => {
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
    });

    describe("updateChatTitle()", () => {
      it("updates the index title of a native entry", async () => {
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

      it("matches the live session by backend, not session id alone", async () => {
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
    });

    describe("loadNativeSessionFromHistory()", () => {
      it("matches live sessions by the (backendId, sessionId) pair, not session id alone", async () => {
        const { manager } = buildHistoryHarness();
        const session = await manager.createSession("opencode");
        const liveId = session.getBackendSessionId()!;

        await expect(manager.loadNativeSessionFromHistory("opencode", liveId)).resolves.toBe(
          session
        );

        await expect(manager.loadNativeSessionFromHistory("codex", liveId)).rejects.toThrow();
        expect(manager.getActiveSession()).toBe(session);
      });

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
        await expect(
          manager.loadNativeSessionFromHistory("opencode", "saved-chat")
        ).rejects.toThrow("Could not resume");
        expect(createBackendProcess).not.toHaveBeenCalled();
        expect(manager.getActiveSession()).toBeNull();
        expect(manager.getLastError()).toContain("Upgrade required");
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
        const backend = buildResumeOnlyBackend({
          resumeSession: jest.fn(async ({ sessionId }: { sessionId: string }) => ({
            sessionId,
            state: backendState("low", "default"),
          })),
          setSessionConfigOption,
          setSessionMode,
        });
        const applyStarted = deferred();
        const applyRelease = deferred();
        const applyInitialSessionConfig = jest.fn(async (session: AgentSession) => {
          applyStarted.resolve();
          await applyRelease.promise;
          await session.setConfigOption("effort", "high");
        });
        const { manager } = buildHistoryHarness({
          backendId: "claude",
          createBackendProcess: jest.fn(() => backend),
          applyInitialSessionConfig,
        });
        getSettingsMock.mockReturnValue({
          agentMode: {
            activeBackend: "claude",
            backends: { claude: { defaultMode: "auto" } },
          },
        });

        let returned = false;
        const loading = manager
          .loadNativeSessionFromHistory("claude", "saved-chat")
          .then((session) => {
            returned = true;
            return session;
          });
        await applyStarted.promise;
        await Promise.resolve();
        expect(returned).toBe(false);

        applyRelease.resolve();
        const session = await loading;

        expect(applyInitialSessionConfig).toHaveBeenCalledWith(
          session,
          expect.objectContaining({ agentMode: expect.any(Object) }),
          undefined
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
      });

      it("keeps focus on the most recently opened history row when resumes finish out of order", async () => {
        const backend = buildResumeOnlyBackend();
        const firstStarted = deferred();
        const firstRelease = deferred();
        const applyInitialSessionConfig = jest.fn(async (session: AgentSession) => {
          if (session.getBackendSessionId() !== "first-chat") return;
          firstStarted.resolve();
          await firstRelease.promise;
        });
        const { manager } = buildHistoryHarness({
          backendId: "claude",
          createBackendProcess: jest.fn(() => backend),
          applyInitialSessionConfig,
        });

        const firstLoading = manager.loadNativeSessionFromHistory("claude", "first-chat");
        await firstStarted.promise;
        const second = await manager.loadNativeSessionFromHistory("claude", "second-chat");
        expect(manager.getActiveSession()).toBe(second);

        firstRelease.resolve();
        const first = await firstLoading;

        expect(first).not.toBe(second);
        expect(manager.getSessions()).toHaveLength(2);
        expect(manager.getActiveSession()).toBe(second);
      });

      it("shares one in-flight resume when the same history row is opened twice", async () => {
        const backend = buildResumeOnlyBackend();
        const applyStarted = deferred();
        const applyRelease = deferred();
        const applyInitialSessionConfig = jest.fn(async () => {
          applyStarted.resolve();
          await applyRelease.promise;
        });
        const { manager } = buildHistoryHarness({
          backendId: "claude",
          createBackendProcess: jest.fn(() => backend),
          applyInitialSessionConfig,
        });

        const firstLoading = manager.loadNativeSessionFromHistory("claude", "saved-chat");
        await applyStarted.promise;
        const secondLoading = manager.loadNativeSessionFromHistory("claude", "saved-chat");
        applyRelease.resolve();
        const [first, second] = await Promise.all([firstLoading, secondLoading]);

        expect(first).toBe(second);
        expect(backend.resumeSession).toHaveBeenCalledTimes(1);
        expect(applyInitialSessionConfig).toHaveBeenCalledTimes(1);
        expect(manager.getSessions()).toEqual([first]);
        expect(manager.getActiveSession()).toBe(first);
      });

      it("rolls the active scope back when a cross-scope history load fails to resume", async () => {
        seedProjects("proj-rollback");
        const mgr = buildManager();
        await mgr.enterProject("proj-rollback");
        const projectSession = mgr.getActiveSession();
        expect(mgr.getActiveProjectId()).toBe("proj-rollback");

        await expect(mgr.loadNativeSessionFromHistory("codex", "missing")).rejects.toThrow();

        expect(mgr.getActiveProjectId()).toBe("proj-rollback");
        expect(mgr.getActiveSession()).toBe(projectSession);
      });
    });

    describe("enterProject()", () => {
      const PROJECT_ID = "proj-enter";

      function makeRecord(
        contextSource: ProjectConfig["contextSource"],
        usageTimestamps = 0,
        systemPrompt = ""
      ): ProjectFileRecord {
        return {
          project: {
            id: PROJECT_ID,
            name: PROJECT_ID,
            systemPrompt,
            projectModelKey: "",
            modelConfigs: {},
            contextSource,
            created: 0,
            UsageTimestamps: usageTimestamps,
          },
          filePath: `Projects/${PROJECT_ID}/project.md`,
          folderName: PROJECT_ID,
        };
      }

      function publish(record: ProjectFileRecord): void {
        projectsState.updateCachedProjectRecords([record]);
      }

      beforeEach(() => seedProjects(PROJECT_ID));

      it("touches last-used after a successful enter that spawns a session", async () => {
        const mgr = buildManager();
        await mgr.enterProject(PROJECT_ID);
        expect(ProjectFileManager.getInstance).toHaveBeenCalled();
        expect(mockTouchProjectLastUsed).toHaveBeenCalledWith(PROJECT_ID);
      });

      it("ensures vault-root instruction discovery before a project session, not just global", async () => {
        const mgr = buildManager();
        await mgr.enterProject(PROJECT_ID);
        expect(ensureAgentsFileForDiscoverySpy).toHaveBeenCalledWith(expect.anything(), "");
        expect(ensureAgentsFileForDiscoverySpy).toHaveBeenCalledWith(
          expect.anything(),
          `Projects/${PROJECT_ID}`
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
        seedProjects(PROJECT_ID, OTHER_ID);
        const mgr = buildManager();

        const enterStale = mgr.enterProject(PROJECT_ID);
        const enterWinner = mgr.enterProject(OTHER_ID);
        await Promise.all([enterStale, enterWinner]);

        expect(mockTouchProjectLastUsed).toHaveBeenCalledWith(OTHER_ID);
        expect(mockTouchProjectLastUsed).not.toHaveBeenCalledWith(PROJECT_ID);
      });

      it("rolls the entered scope back when its auto-spawn fails", async () => {
        const OTHER_ID = "proj-other-fail";
        seedProjects(PROJECT_ID, OTHER_ID);
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

      it("detaches a conversational session on re-entry and spawns a fresh one", async () => {
        const mgr = buildManager();
        const old = await enterWithConversation(mgr, PROJECT_ID);

        sessionCreateSpy.mockClear();
        await mgr.enterProject(PROJECT_ID);

        expect(sessionCreateSpy).toHaveBeenCalledTimes(1);
        const visible = mgr.getSessionsForScope(PROJECT_ID);
        expect(visible).toHaveLength(1);
        expect(visible[0].internalId).not.toBe(old.internalId);
        expect(mgr.getSessions()).toContain(old);
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

      it("does not reuse an error-state landing; spawns a fresh session instead", async () => {
        const mgr = buildManager();
        await mgr.enterProject(PROJECT_ID);
        const landing = mgr.getActiveSession()!;
        getSessionTestHandle(landing).setStatus("error");
        await mgr.exitProject();

        sessionCreateSpy.mockClear();
        await mgr.enterProject(PROJECT_ID);

        expect(sessionCreateSpy).toHaveBeenCalledTimes(1);
        expect(mgr.getActiveSession()).not.toBe(landing);
      });

      it("marks an inactive project dirty so re-entry detaches the stale empty landing and respawns", async () => {
        publish(makeRecord({ webUrls: "https://a.com" }));
        const mgr = buildManager();

        await mgr.enterProject(PROJECT_ID);
        const landing = mgr.getActiveSession()!;
        await mgr.exitProject();

        publish(makeRecord({ webUrls: "https://a.com\nhttps://b.com" }));

        sessionCreateSpy.mockClear();
        await mgr.enterProject(PROJECT_ID);

        expect(sessionCreateSpy).toHaveBeenCalledTimes(1);
        const visible = mgr.getSessionsForScope(PROJECT_ID);
        expect(visible).toHaveLength(1);
        expect(visible[0]).not.toBe(landing);
      });

      it("clears dirty once a fresh session captured the new sources (later re-entry reuses)", async () => {
        publish(makeRecord({ webUrls: "https://a.com" }));
        const mgr = buildManager();
        await mgr.enterProject(PROJECT_ID);
        await mgr.exitProject();

        publish(makeRecord({ webUrls: "https://a.com\nhttps://b.com" }));
        await mgr.enterProject(PROJECT_ID);
        await flushTimers();
        const fresh = mgr.getActiveSession();
        await mgr.exitProject();

        sessionCreateSpy.mockClear();
        await mgr.enterProject(PROJECT_ID);

        expect(sessionCreateSpy).not.toHaveBeenCalled();
        expect(mgr.getActiveSession()).toBe(fresh);
      });

      it("keeps a project dirty when the fresh session fails to start (ready rejects)", async () => {
        publish(makeRecord({ webUrls: "https://a.com" }));
        const mgr = buildManager();
        await mgr.enterProject(PROJECT_ID);
        await flushTimers();
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
        await mgr.enterProject(PROJECT_ID);
        await flushTimers();
        await mgr.exitProject();

        sessionCreateSpy.mockClear();
        await mgr.enterProject(PROJECT_ID);
        expect(sessionCreateSpy).toHaveBeenCalledTimes(1);
      });

      it("keeps a project dirty when the create captured an older signature (single-flight race)", async () => {
        publish(makeRecord({ webUrls: "https://a.com" }));
        const mgr = buildManager();
        await mgr.enterProject(PROJECT_ID);
        await mgr.exitProject();

        publish(makeRecord({ webUrls: "https://a.com\nhttps://b.com" }));

        const v1Signature = getProjectContextSignature(makeRecord({ webUrls: "https://a.com" }));
        mockEnsureMaterialized.mockImplementationOnce(async () => ({
          additionalDirectories: [],
          contextSignature: v1Signature,
        }));

        await mgr.enterProject(PROJECT_ID);
        await flushTimers();
        await mgr.exitProject();

        sessionCreateSpy.mockClear();
        await mgr.enterProject(PROJECT_ID);
        expect(sessionCreateSpy).toHaveBeenCalledTimes(1);
      });

      it("ignores a usage-timestamp-only touch (no dirty, empty landing still reused)", async () => {
        publish(makeRecord({ webUrls: "https://a.com" }));
        const mgr = buildManager();
        await mgr.enterProject(PROJECT_ID);
        const landing = mgr.getActiveSession();
        await mgr.exitProject();

        publish(makeRecord({ webUrls: "https://a.com" }, 12345));

        sessionCreateSpy.mockClear();
        await mgr.enterProject(PROJECT_ID);

        expect(sessionCreateSpy).not.toHaveBeenCalled();
        expect(mgr.getActiveSession()).toBe(landing);
      });

      it("does not reuse an empty landing after a System-Prompt-only edit", async () => {
        publish(makeRecord({ webUrls: "https://a.com" }, 0, "old instructions"));
        const mgr = buildManager();
        await mgr.enterProject(PROJECT_ID);
        const landing = mgr.getActiveSession()!;
        await mgr.exitProject();

        publish(makeRecord({ webUrls: "https://a.com" }, 0, "new instructions"));

        sessionCreateSpy.mockClear();
        await mgr.enterProject(PROJECT_ID);

        expect(sessionCreateSpy).toHaveBeenCalledTimes(1);
        expect(mgr.getActiveSession()).not.toBe(landing);
      });

      it("does not reuse an empty landing after vault content inside the project's sources changes", async () => {
        jest.useFakeTimers();
        publish(makeRecord({ inclusions: "Notes" }));
        const app = buildApp();
        const mgr = buildManager({ app });
        await mgr.enterProject(PROJECT_ID);
        const landing = mgr.getActiveSession()!;
        await mgr.exitProject();

        const onModify = (app.vault.on as jest.Mock).mock.calls.find(
          ([event]) => event === "modify"
        )![1];
        onModify(mockTFile({ path: "Notes/topic.md", extension: "md" }));
        jest.advanceTimersByTime(2000);

        sessionCreateSpy.mockClear();
        await mgr.enterProject(PROJECT_ID);

        expect(sessionCreateSpy).toHaveBeenCalledTimes(1);
        expect(mgr.getActiveSession()).not.toBe(landing);
      });

      it("publishes processingSources and incremental failedSources during a run, then clears them when done", async () => {
        publish(makeRecord({ webUrls: "https://a.com" }));
        const mgr = buildManager();
        const setMock = jest.requireMock("@/settings/model").settingsStore.set as jest.Mock;
        const latest = (): AgentProjectContextLoadState | undefined => {
          for (let i = setMock.mock.calls.length - 1; i >= 0; i--) {
            const [atom, updater] = setMock.mock.calls[i];
            if (atom !== agentProjectContextLoadAtom || typeof updater !== "function") continue;
            const next = updater({}) as Record<string, AgentProjectContextLoadState>;
            if (next[PROJECT_ID]) return next[PROJECT_ID];
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

        const entering = mgr.enterProject(PROJECT_ID);
        await flushTimers();

        expect(latest()).toMatchObject({
          phase: "prefetch",
          blocking: true,
          processingSources: [{ kind: "web", source: "https://a.com" }],
        });

        drive({
          phase: "itemFailed",
          item: { kind: "web", source: "https://a.com" },
          failure: {
            kind: "web",
            source: "https://a.com",
            error: "boom",
            usedStaleSnapshot: false,
          },
        });
        const afterFail = latest()!;
        expect(afterFail.processingSources).toBeUndefined();
        expect(afterFail.failedSources).toEqual([
          { path: "https://a.com", type: "web", error: "boom", usedStaleSnapshot: false },
        ]);

        release();
        await entering;
        await flushTimers();
        expect(latest()).toMatchObject({ phase: "done", blocking: false });
        expect(latest()!.processingSources).toBeUndefined();
      });

      it("warms the active project's cache on a source edit without gating the composer", async () => {
        publish(makeRecord({ webUrls: "https://a.com" }));
        const mgr = buildManager();
        await mgr.enterProject(PROJECT_ID);
        await flushTimers();

        mockEnsureMaterialized.mockClear();
        const settingsStoreSet = jest.requireMock("@/settings/model").settingsStore
          .set as jest.Mock;
        settingsStoreSet.mockClear();

        publish(makeRecord({ webUrls: "https://a.com\nhttps://b.com" }));

        expect(mockEnsureMaterialized).toHaveBeenCalledTimes(1);
        expect(settingsStoreSet).not.toHaveBeenCalled();
      });

      it("hands a project session the update note once per change until it acknowledges the epoch", async () => {
        publish(makeRecord({ webUrls: "https://a.com" }));
        const mgr = buildManager();
        await mgr.enterProject(PROJECT_ID);
        await flushTimers();
        const hooks = sessionCreateSpy.mock.calls.at(-1)![0];
        expect(hooks.getProjectContextUpdates!()).toBeNull();

        publish(makeRecord({ webUrls: "https://a.com\nhttps://b.com" }));

        const update = hooks.getProjectContextUpdates!();
        expect(update?.block).toContain("<project_context_updates>");
        hooks.markProjectContextUpdatesDelivered!(update!.epoch);
        expect(hooks.getProjectContextUpdates!()).toBeNull();
      });
    });

    describe("exitProject()", () => {
      const PROJECT_ID = "proj-exit";

      it("does not touch last-used when returning to the global scope", async () => {
        seedProjects(PROJECT_ID);
        const mgr = buildManager();
        await mgr.enterProject(PROJECT_ID);
        mockTouchProjectLastUsed.mockClear();

        await mgr.exitProject();

        expect(mockTouchProjectLastUsed).not.toHaveBeenCalled();
      });
    });

    describe("rematerializeContext()", () => {
      const PID = "proj-rematerialize";

      async function enterProjectReady(): Promise<AgentSessionManager> {
        seedProjects(PID);
        const mgr = buildManager();
        await mgr.enterProject(PID);
        await flushTimers();
        mockEnsureMaterialized.mockClear();
        return mgr;
      }

      it("forces a retry of known-bad sources", async () => {
        const mgr = await enterProjectReady();

        const started = mgr.rematerializeContext(PID);
        await flushTimers();

        expect(started).toBe(true);
        expect(mockEnsureMaterialized).toHaveBeenCalledTimes(1);
        expect(mockEnsureMaterialized.mock.calls[0][4]).toBe(true);
      });

      it("early-exits while a run already owns the load atom", async () => {
        const mgr = await enterProjectReady();
        const getMock = jest.requireMock("@/settings/model").settingsStore.get as jest.Mock;
        getMock.mockReturnValueOnce({ [PID]: { phase: "prefetch", blocking: true } });

        const started = mgr.rematerializeContext(PID);

        expect(started).toBe(false);
        expect(mockEnsureMaterialized).not.toHaveBeenCalled();
      });
    });
  });
});
