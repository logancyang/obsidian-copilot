import { DEFAULT_SETTINGS } from "@/constants";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

// The install/remove surface (the unit under test at the UI layer). Backed by a
// real disk in production; mocked here so we assert how the toggle reacts to
// each outcome without touching the vault.
const installMiyoSearchSkill = jest.fn<Promise<string>, unknown[]>();
const removeMiyoSearchSkill = jest.fn<Promise<string>, unknown[]>();
jest.mock("@/agentMode", () => ({
  installMiyoSearchSkill: (...a: unknown[]) => installMiyoSearchSkill(...a),
  removeMiyoSearchSkill: (...a: unknown[]) => removeMiyoSearchSkill(...a),
}));

// Skills folder derives from the configurable Copilot root. Mock the pure
// deriver so a test can point the root anywhere and assert the toggle installs
// to the derived path, without pulling in the real obsidian normalizePath.
jest.mock("@/settings/copilotFolder", () => ({
  deriveSkillsFolder: (s: { copilotFolder?: string }) =>
    `${(s.copilotFolder || "copilot").replace(/\/+$/, "")}/skills`,
}));

// Persisted-settings surface: capture writes and feed a controllable snapshot.
const updateSetting = jest.fn<void, unknown[]>();
let currentSettings = { ...DEFAULT_SETTINGS };
jest.mock("@/settings/model", () => ({
  updateSetting: (...a: unknown[]) => updateSetting(...a),
  getSettings: () => currentSettings,
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook; name must match the export
  useSettingsValue: () => currentSettings,
  // The scope-verify key derives the system roots through the real normalizer,
  // so a test that moves the Copilot root gets the production root set.
  normalizeRootFolders:
    jest.requireActual<typeof import("@/settings/model")>("@/settings/model").normalizeRootFolders,
}));

// Miyo connection status. Defaults to connected; individual tests flip
// `mockMiyoBackend` to "unavailable" to assert the skill toggle stays operable while
// the connection-gated rows dim, or to "stale" (aged snapshot) which must still
// read as connected.
let mockMiyoBackend: "available" | "unavailable" | "stale" = "available";
jest.mock("@/miyo/useMiyoStatus", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook; name must match the export
  useMiyoStatus: () => ({
    backend: mockMiyoBackend,
    connector: mockMiyoBackend,
    chatSync: mockMiyoBackend,
  }),
}));
// The Connect flow reads the store's post-enable availability to decide
// connected vs unreachable. Default: the refresh reports the current backend;
// #5 rollback tests point it at "unavailable" to assert the settings revert.
let mockRefreshBackend: "available" | "unavailable" | "stale" = "available";
// When set, refreshMiyoStatus returns THIS promise instead of resolving
// immediately — lets a test hold the enable-refresh open, supersede the attempt,
// then resolve it "available" to prove the optimistic writes still roll back.
let mockRefreshGate: Promise<{ backend: string }> | null = null;
jest.mock("@/miyo/miyoStatusStore", () => ({
  refreshMiyoStatus: jest.fn(
    () => mockRefreshGate ?? Promise.resolve({ backend: mockRefreshBackend })
  ),
}));
// Connect probes reachability + registration through MiyoClient before enabling.
// Defaults let the flow reach enableMiyoBackend (reachable + registered).
let mockReachable = true;
let mockRegistration: "registered" | "unregistered" | "error" = "registered";
jest.mock("@/miyo/MiyoClient", () => ({
  MiyoClient: class {
    isBackendAvailable = async () => mockReachable;
    checkFolderRegistration = async () => mockRegistration;
    addFolder = async () => ({ path: "/vault" });
  },
}));
// Quiet by default so the resync banner doesn't render into unrelated tests;
// the banner tests flip this on.
const shouldSurfaceMiyoResync = jest.fn<boolean, unknown[]>(() => false);
jest.mock("@/miyo/miyoUtils", () => ({
  getMiyoCustomUrl: () => "",
  getMiyoFolderExclusions: () => ({}),
  getMiyoFolderInclusions: () => ({}),
  getMiyoFolderName: () => "vault",
  isLocalMiyoUrl: () => true,
  buildMiyoSyncReceipt: () => "receipt",
  shouldSurfaceMiyoResync: (...a: unknown[]) => shouldSurfaceMiyoResync(...a),
  MIYO_ADD_FOLDER_DEEPLINK_URL: "miyo://add",
  MIYO_DEEPLINK_URL: "miyo://",
}));
// The scope-resync module talks to a live Miyo; keep it inert here. The verify
// verdict defaults to "unknown" (the component then falls back to the local
// signal); the banner tests pin it to a definite verdict.
const resyncMiyoFolder = jest.fn<Promise<string>, unknown[]>(async () => "verified");
// Sessions the register flow presented to the queue, so a test can prove the
// producer forwarded the plugin's rather than one of its own.
const enqueuedSessions: unknown[] = [];
const verifyMiyoScope = jest.fn<Promise<string>, unknown[]>(async () => "unknown");
jest.mock("@/miyo/miyoResync", () => ({
  assertCurrentLifecycle: () => undefined,
  enqueueMiyoFolderMutation: (task: (lifecycle: number) => Promise<unknown>, session: unknown) => {
    enqueuedSessions.push(session);
    return task(0);
  },
  resyncMiyoFolder: (...a: unknown[]) => resyncMiyoFolder(...a),
  verifyMiyoScope: (...a: unknown[]) => verifyMiyoScope(...a),
}));
// Capture the options the component passes to the modal so a test can invoke the
// modal's callbacks (onRetry/onAddVault) directly — the Retry button has no
// busy-guard, which is the real path that fires concurrent enable attempts.
let lastModalOptions: {
  onRetry: () => Promise<unknown>;
  onClose: () => void;
  onAddVault?: () => Promise<unknown>;
} | null = null;
jest.mock("@/settings/v2/components/MiyoConnectModal", () => ({
  MiyoConnectModal: class {
    constructor(
      _app: unknown,
      options: {
        onRetry: () => Promise<unknown>;
        onClose: () => void;
        onAddVault?: () => Promise<unknown>;
      }
    ) {
      lastModalOptions = options;
    }
    open = jest.fn();
    close = jest.fn();
  },
}));
// Stable identity, matching production: useApp() reads a context value, so the
// app reference does not change between renders. A fresh object per call would
// re-fire every app-keyed effect on each render.
const mockAppInstance = {};
jest.mock("@/context", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook; name must match the export
  useApp: () => mockAppInstance,
}));
// The Miyo mutation session is owned by the plugin (one per lifecycle) rather
// than captured by this tab, which mounts lazily. Hoisted so the stand-in keeps
// production's referential stability: the session is an effect dependency, and a
// fresh object per render would loop the verify effect forever.
const mockPluginInstance = { miyoMutationSession: Object.freeze({ lifecycle: 0 }) };
jest.mock("@/contexts/PluginContext", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook; name must match the export
  usePlugin: () => mockPluginInstance,
}));
jest.mock("@/plusUtils", () => ({ createPlusPageUrl: () => "https://example.com" }));
jest.mock("@/utils/vaultPath", () => ({ getVaultBase: () => "/vault" }));

const NoticeMock = jest.fn();
jest.mock("obsidian", () => ({
  Notice: class {
    constructor(message: string) {
      NoticeMock(message);
    }
  },
  Platform: { isMobile: false },
}));

import { MiyoSettings } from "./MiyoSettings";

const toggle = () => screen.getByLabelText("Enable Miyo semantic search skill");

/** A promise whose resolution the test controls, to hold a disk op mid-flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  jest.clearAllMocks();
  currentSettings = { ...DEFAULT_SETTINGS, enableMiyoSearchSkill: false };
  mockMiyoBackend = "available";
  mockRefreshBackend = "available";
  mockRefreshGate = null;
  mockReachable = true;
  mockRegistration = "registered";
  lastModalOptions = null;
  enqueuedSessions.length = 0;
});

it("registers through the queue with the plugin's session", async () => {
  // The Connect modal is a standalone Obsidian Modal that outlives onunload, so
  // its Add-this-vault callback is the producer most able to act for a closed
  // lifecycle. It must hand the queue the plugin's session, not a fresh one.
  mockRegistration = "unregistered";
  render(<MiyoSettings />);

  fireEvent.click(await screen.findByText("Connect"));
  await waitFor(() => expect(lastModalOptions).not.toBeNull());
  expect(lastModalOptions?.onAddVault).toBeDefined();

  await lastModalOptions?.onAddVault?.();

  expect(enqueuedSessions).toEqual([mockPluginInstance.miyoMutationSession]);
});

it("verifies scope with the plugin's session, not one this tab obtained itself", async () => {
  // Tabs mount lazily, so a tab first opened after a plugin reload would
  // otherwise vouch for the incoming lifecycle while holding the outgoing
  // vault's app. The session has to come from the plugin instance.
  render(<MiyoSettings />);

  await waitFor(() => expect(verifyMiyoScope).toHaveBeenCalled());
  expect(verifyMiyoScope).toHaveBeenCalledWith(
    expect.anything(),
    mockPluginInstance.miyoMutationSession
  );
});

it("installs the skill, commits the flag, and confirms with a Notice on enable", async () => {
  installMiyoSearchSkill.mockResolvedValue("installed");
  render(<MiyoSettings />);

  fireEvent.click(toggle());

  await waitFor(() => expect(installMiyoSearchSkill).toHaveBeenCalledTimes(1));
  expect(updateSetting).toHaveBeenCalledWith("enableMiyoSearchSkill", true);
  expect(NoticeMock).toHaveBeenCalledWith("Miyo search skill installed");
});

it("installs to the folder derived from a non-default Copilot root, not the retired field", async () => {
  // Regression: a customized root must reach the derived skills folder. The
  // retired agentMode.skills.folder no longer tracks the root, so installing
  // against it would write to the wrong directory (and collide with the path
  // the background seeder uses).
  currentSettings = {
    ...DEFAULT_SETTINGS,
    enableMiyoSearchSkill: false,
    copilotFolder: "team/copilot",
    agentMode: {
      ...DEFAULT_SETTINGS.agentMode,
      skills: { ...DEFAULT_SETTINGS.agentMode.skills, folder: "copilot/skills" },
    },
  };
  installMiyoSearchSkill.mockResolvedValue("installed");
  render(<MiyoSettings />);

  fireEvent.click(toggle());

  await waitFor(() => expect(installMiyoSearchSkill).toHaveBeenCalledTimes(1));
  expect(installMiyoSearchSkill).toHaveBeenCalledWith(expect.anything(), "team/copilot/skills");
});

it("does NOT commit the flag on a collision, and explains why", async () => {
  installMiyoSearchSkill.mockResolvedValue("collision");
  render(<MiyoSettings />);

  fireEvent.click(toggle());

  await waitFor(() => expect(installMiyoSearchSkill).toHaveBeenCalledTimes(1));
  // The user's same-named skill wins: never claim success, never persist true.
  expect(updateSetting).not.toHaveBeenCalledWith("enableMiyoSearchSkill", true);
  expect(NoticeMock).toHaveBeenCalledTimes(1);
  expect(NoticeMock.mock.calls[0][0]).toMatch(/already exists/i);
});

it("leaves the flag off on a failed install", async () => {
  installMiyoSearchSkill.mockResolvedValue("failed");
  render(<MiyoSettings />);

  fireEvent.click(toggle());

  await waitFor(() => expect(installMiyoSearchSkill).toHaveBeenCalledTimes(1));
  expect(updateSetting).not.toHaveBeenCalledWith("enableMiyoSearchSkill", true);
});

it("reconciles the flag to an installed skill even when the tab unmounts mid-op", async () => {
  const gate = deferred<string>();
  installMiyoSearchSkill.mockReturnValue(gate.promise);
  const { unmount } = render(<MiyoSettings />);

  fireEvent.click(toggle());
  await waitFor(() => expect(installMiyoSearchSkill).toHaveBeenCalledTimes(1));

  // Tab closes while the install is still writing to disk, then the disk op
  // completes: the flag must still be persisted so disk and settings agree.
  unmount();
  gate.resolve("installed");

  await waitFor(() => expect(updateSetting).toHaveBeenCalledWith("enableMiyoSearchSkill", true));
  // UI work is suppressed after unmount — no Notice fires.
  expect(NoticeMock).not.toHaveBeenCalled();
});

it("reconciles the flag to a removed skill even when the tab unmounts mid-op", async () => {
  currentSettings = { ...DEFAULT_SETTINGS, enableMiyoSearchSkill: true };
  const gate = deferred<string>();
  removeMiyoSearchSkill.mockReturnValue(gate.promise);
  const { unmount } = render(<MiyoSettings />);

  fireEvent.click(toggle());
  await waitFor(() => expect(removeMiyoSearchSkill).toHaveBeenCalledTimes(1));

  unmount();
  gate.resolve("removed");

  await waitFor(() => expect(updateSetting).toHaveBeenCalledWith("enableMiyoSearchSkill", false));
  expect(NoticeMock).not.toHaveBeenCalled();
});

it("removes the skill and clears the flag on disable", async () => {
  currentSettings = { ...DEFAULT_SETTINGS, enableMiyoSearchSkill: true };
  removeMiyoSearchSkill.mockResolvedValue("removed");
  render(<MiyoSettings />);

  fireEvent.click(toggle());

  await waitFor(() => expect(removeMiyoSearchSkill).toHaveBeenCalledTimes(1));
  expect(updateSetting).toHaveBeenCalledWith("enableMiyoSearchSkill", false);
});

it("keeps the flag ON when a disable fails to remove the skill", async () => {
  currentSettings = { ...DEFAULT_SETTINGS, enableMiyoSearchSkill: true };
  removeMiyoSearchSkill.mockResolvedValue("failed");
  render(<MiyoSettings />);

  fireEvent.click(toggle());

  await waitFor(() => expect(removeMiyoSearchSkill).toHaveBeenCalledTimes(1));
  // UI must not claim the skill is gone while it's still on disk.
  expect(updateSetting).not.toHaveBeenCalledWith("enableMiyoSearchSkill", false);
  expect(NoticeMock.mock.calls[0][0]).toMatch(/couldn't remove/i);
});

it("blocks ENABLING the skill while Miyo is disconnected (skill off)", async () => {
  // Turning the skill ON is connection-gated: it only has an effect once Miyo is
  // reachable, so a disconnected + not-yet-enabled toggle is inert.
  mockMiyoBackend = "unavailable";
  currentSettings = { ...DEFAULT_SETTINGS, enableMiyoSearchSkill: false };
  installMiyoSearchSkill.mockResolvedValue("installed");
  render(<MiyoSettings />);

  const control = toggle();
  expect(control.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(control);

  // Gated: no install runs, no settings write.
  expect(installMiyoSearchSkill).not.toHaveBeenCalled();
  expect(updateSetting).not.toHaveBeenCalledWith("enableMiyoSearchSkill", true);
});

it("ALLOWS disabling an already-installed skill while Miyo is disconnected", async () => {
  // Removal is a local vault file op — it doesn't need Miyo. A user whose Miyo
  // went offline must still be able to turn the skill off (regression: the toggle
  // used to be inert whenever disconnected, stranding an installed skill).
  mockMiyoBackend = "unavailable";
  currentSettings = { ...DEFAULT_SETTINGS, enableMiyoSearchSkill: true };
  removeMiyoSearchSkill.mockResolvedValue("removed");
  render(<MiyoSettings />);

  const control = toggle();
  expect(control.getAttribute("aria-disabled")).toBe("false");
  fireEvent.click(control);

  await waitFor(() => expect(removeMiyoSearchSkill).toHaveBeenCalledTimes(1));
  expect(updateSetting).toHaveBeenCalledWith("enableMiyoSearchSkill", false);
});

it("keeps the skill toggle operable while the status snapshot is stale", async () => {
  // `stale` = was available, snapshot just aged past the TTL — NOT disconnected.
  // The store downgrades available→stale lazily on read, so an unrelated
  // re-render (e.g. toggling Search scope) must not flip the tab to "disconnected"
  // and force a reconnect. Regression guard for that bug.
  mockMiyoBackend = "stale";
  currentSettings = { ...DEFAULT_SETTINGS, enableMiyoSearchSkill: true };
  removeMiyoSearchSkill.mockResolvedValue("removed");
  render(<MiyoSettings />);

  const control = toggle();
  expect(control.getAttribute("aria-disabled")).toBe("false");
  fireEvent.click(control);
  await waitFor(() => expect(removeMiyoSearchSkill).toHaveBeenCalledTimes(1));
});

describe("stranded-enable recovery — Disconnect stays available when Miyo goes offline", () => {
  it("shows Disconnect (not Connect) when enableMiyo=true but Miyo is unavailable", () => {
    // Regression: the pill used to key on live health, so a stranded enableMiyo
    // (Miyo enabled, then it went offline) showed only "Connect" — while search
    // still routed to the dead backend with no way to turn it off. The pill now
    // keys on intent, so Disconnect is always reachable when enableMiyo=true.
    mockMiyoBackend = "unavailable";
    currentSettings = { ...DEFAULT_SETTINGS, enableMiyo: true };
    render(<MiyoSettings />);

    // "Unavailable" rest-label + hover "Disconnect"; no "Connect" button.
    expect(screen.getByTitle("Disconnect Miyo")).toBeTruthy();
    expect(screen.queryByText("Connect")).toBeNull();
    expect(screen.getByText("Unavailable")).toBeTruthy();
  });

  it("shows Connect when Miyo is not enabled", async () => {
    mockMiyoBackend = "unavailable";
    currentSettings = { ...DEFAULT_SETTINGS, enableMiyo: false };
    render(<MiyoSettings />);

    // Wait out the mount refresh so the button settles from "Connecting…" to "Connect".
    expect(await screen.findByText("Connect")).toBeTruthy();
    expect(screen.queryByTitle("Disconnect Miyo")).toBeNull();
  });
});

describe("Connect — two-phase commit rolls back on a failed health check", () => {
  // Start disconnected so the pill shows "Connect".
  beforeEach(() => {
    mockMiyoBackend = "unavailable";
    currentSettings = {
      ...DEFAULT_SETTINGS,
      enableMiyo: false,
      enableSemanticSearchV3: false,
    };
  });

  it("rolls back enableMiyo + enableSemanticSearchV3 when Miyo drops before the enable refresh", async () => {
    // Reachable + registered, so the flow reaches enableMiyoBackend and writes
    // both flags true — but the post-enable refresh reports NOT available.
    mockReachable = true;
    mockRegistration = "registered";
    mockRefreshBackend = "unavailable";
    render(<MiyoSettings />);

    fireEvent.click(await screen.findByText("Connect"));

    // Both flags flip on, then revert once the health check comes back unavailable
    // — otherwise search routing would key off a stranded enableMiyo=true.
    await waitFor(() => expect(updateSetting).toHaveBeenCalledWith("enableMiyo", false));
    expect(updateSetting).toHaveBeenCalledWith("enableMiyo", true);
    expect(updateSetting).toHaveBeenCalledWith("enableSemanticSearchV3", true);
    expect(updateSetting).toHaveBeenCalledWith("enableSemanticSearchV3", false);
  });

  it("does NOT roll back when the enable refresh confirms available", async () => {
    mockReachable = true;
    mockRegistration = "registered";
    mockRefreshBackend = "available";
    render(<MiyoSettings />);

    fireEvent.click(await screen.findByText("Connect"));

    await waitFor(() => expect(updateSetting).toHaveBeenCalledWith("enableMiyo", true));
    // A successful connect must leave the flags on — no revert write.
    expect(updateSetting).not.toHaveBeenCalledWith("enableMiyo", false);
    expect(updateSetting).not.toHaveBeenCalledWith("enableSemanticSearchV3", false);
  });

  it("preserves a user's pre-existing enableSemanticSearchV3 on rollback", async () => {
    // The user already had semantic search on (for non-Miyo use). A failed Miyo
    // connect must revert enableMiyo but MUST NOT clobber their semantic setting.
    currentSettings = {
      ...DEFAULT_SETTINGS,
      enableMiyo: false,
      enableSemanticSearchV3: true,
    };
    mockReachable = true;
    mockRegistration = "registered";
    mockRefreshBackend = "unavailable";
    render(<MiyoSettings />);

    fireEvent.click(await screen.findByText("Connect"));

    await waitFor(() => expect(updateSetting).toHaveBeenCalledWith("enableMiyo", false));
    // We never flipped enableSemanticSearchV3 (it was already true), so we must
    // never write it false on rollback.
    expect(updateSetting).not.toHaveBeenCalledWith("enableSemanticSearchV3", false);
  });

  it("rolls back an optimistic enable when the attempt is superseded mid-refresh, even if it comes back available", async () => {
    // The dangerous race: writes land true, the user cancels (here: unmounts,
    // which bumps the attempt generation), THEN the health check resolves
    // available. A superseded attempt must commit NO settings, so the optimistic
    // writes have to revert despite the available result.
    mockReachable = true;
    mockRegistration = "registered";
    const { unmount } = render(<MiyoSettings />);

    // Let the mount refresh settle (button returns to "Connect") BEFORE arming the
    // gate, so only the enable-refresh is held open.
    const connectBtn = await screen.findByText("Connect");
    let resolveRefresh!: (v: { backend: string }) => void;
    mockRefreshGate = new Promise((r) => {
      resolveRefresh = r;
    });
    fireEvent.click(connectBtn);
    // Let probe + registration resolve so the flow reaches the gated enable refresh.
    await waitFor(() => expect(updateSetting).toHaveBeenCalledWith("enableMiyo", true));

    // Supersede the in-flight attempt, then let the refresh come back healthy.
    unmount();
    resolveRefresh({ backend: "available" });

    await waitFor(() => expect(updateSetting).toHaveBeenCalledWith("enableMiyo", false));
  });

  it("does NOT let an older enable's revert clobber a newer concurrent enable that committed", async () => {
    // The concurrent-Retry race: the modal's Retry has no busy-guard, so two
    // enable attempts can overlap on the store's shared single-flight refresh. The
    // OLDER attempt resolves last; without the ownership token its superseded
    // revert would overwrite the NEWER attempt's committed enableMiyo=true.
    // First Connect fails (unreachable) to open the guide modal and capture its
    // onRetry, which is the concurrent trigger.
    mockRefreshBackend = "unavailable";
    render(<MiyoSettings />);
    fireEvent.click(await screen.findByText("Connect"));
    await waitFor(() => expect(lastModalOptions).not.toBeNull());

    // Both retries share one deferred refresh that resolves available.
    let resolveRefresh!: (v: { backend: string }) => void;
    mockRefreshGate = new Promise((r) => {
      resolveRefresh = r;
    });
    updateSetting.mockClear();
    const enableTrueCount = () =>
      updateSetting.mock.calls.filter((c) => c[0] === "enableMiyo" && c[1] === true).length;

    // Sequence matters: A must actually enter enableMiyoBackend (claim txn=1,
    // write true, park on the gate) BEFORE B starts — otherwise A short-circuits
    // at its own superseded() check after probe and never claims a txn, so the
    // stillOwner=false branch wouldn't run and the test would pass vacuously.
    const retryA = lastModalOptions!.onRetry();
    await waitFor(() => expect(enableTrueCount()).toBe(1)); // A parked on the gate
    const retryB = lastModalOptions!.onRetry();
    await waitFor(() => expect(enableTrueCount()).toBe(2)); // B claimed txn=2, parked too

    // Now both are parked on the shared gate. Resolve available: A resumes first,
    // finds stillOwner=false (B bumped the txn) and skips its revert; B resumes as
    // owner and commits.
    resolveRefresh({ backend: "available" });
    await Promise.all([retryA, retryB]);

    // Without the ownership token, A's superseded revert would write false here.
    expect(updateSetting).not.toHaveBeenCalledWith("enableMiyo", false);
    expect(enableTrueCount()).toBe(2);
  });
});

describe("scope resync banner", () => {
  // The verdict is pinned per test; restore the indefinite default so a pinned
  // verdict can't leak forward.
  beforeEach(() => {
    verifyMiyoScope.mockResolvedValue("unknown");
  });

  it("stays hidden when the local receipt matches", () => {
    render(<MiyoSettings />);
    expect(screen.queryByRole("button", { name: /Resync Miyo/ })).toBeNull();
  });

  it("shows and runs the resync when the scope went stale", async () => {
    shouldSurfaceMiyoResync.mockReturnValue(true);
    render(<MiyoSettings />);

    const button = screen.getByRole("button", { name: /Resync Miyo/ });
    fireEvent.click(button);

    await waitFor(() => expect(resyncMiyoFolder).toHaveBeenCalledTimes(1));
    // Same requirement as the verify probe: the Resync click must present the
    // plugin's session, or a settings tree that outlived its lifecycle could
    // delete and re-register on the incoming vault's queue.
    expect(resyncMiyoFolder).toHaveBeenCalledWith(
      expect.anything(),
      mockPluginInstance.miyoMutationSession
    );
  });

  it("re-verifies when the Copilot root changes while the tab stays mounted", async () => {
    // A "covered" verdict vetoes the local mismatch signal outright, so the
    // banner is hidden despite shouldSurfaceMiyoResync saying otherwise.
    shouldSurfaceMiyoResync.mockReturnValue(true);
    verifyMiyoScope.mockResolvedValue("covered");
    const { rerender } = render(<MiyoSettings />);
    await waitFor(() => expect(verifyMiyoScope).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("button", { name: /Resync Miyo/ })).toBeNull();

    // A root change reaches the shared settings atom without unmounting this
    // tab: its Apply persists to disk before flipping the in-memory root, and
    // the user can be back here by then. A verdict about roots that no longer
    // apply must stop answering for the ones that do.
    currentSettings = { ...currentSettings, copilotFolder: "notes/copilot" };
    verifyMiyoScope.mockResolvedValue("unknown");
    rerender(<MiyoSettings />);

    await waitFor(() => expect(verifyMiyoScope).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("button", { name: /Resync Miyo/ })).toBeTruthy();
  });

  it("re-verifies when Connect adopts a registration this tab did not create", async () => {
    // Nothing was registered at load, so the verdict reads "no exposure".
    verifyMiyoScope.mockResolvedValue("unregistered");
    mockMiyoBackend = "unavailable";
    currentSettings = { ...DEFAULT_SETTINGS, enableMiyo: false };
    render(<MiyoSettings />);
    await waitFor(() => expect(verifyMiyoScope).toHaveBeenCalledTimes(1));

    // The user registered the vault in the Miyo app and Connect finds it
    // already there. That record's exclusions are unknown and no local input
    // moved, so only an explicit re-verify can tell whether it exposes the
    // Copilot roots.
    fireEvent.click(await screen.findByText("Connect"));

    await waitFor(() => expect(verifyMiyoScope).toHaveBeenCalledTimes(2));
  });
});
