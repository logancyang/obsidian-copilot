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
let mockMiyoBackend: "available" | "unavailable" | "unknown" | "stale" = "available";
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
// Bodies the register flow submitted, so a test can assert exactly which scope
// fields reach Miyo.
const addFolderBodies: unknown[] = [];
const syncMiyoSystemExclusions = jest.fn<Promise<boolean>, unknown[]>().mockResolvedValue(false);
jest.mock("@/miyo/miyoSystemExclusions", () => ({
  syncMiyoSystemExclusions: (...args: unknown[]) => syncMiyoSystemExclusions(...args),
}));
jest.mock("@/miyo/MiyoClient", () => ({
  MiyoClient: class {
    isBackendAvailable = async () => mockReachable;
    checkFolderRegistration = async () => mockRegistration;
    addFolder = async (request: unknown) => {
      addFolderBodies.push(request);
      return { path: "/vault" };
    };
  },
}));
jest.mock("@/miyo/miyoUtils", () => ({
  getMiyoCustomUrl: () => "",
  getMiyoFolderName: () => "vault",
  isLocalMiyoUrl: () => true,
  MIYO_ADD_FOLDER_DEEPLINK_URL: "miyo://add",
  MIYO_DEEPLINK_URL: "miyo://",
}));
const notifyMiyoIndexChanged = jest.fn<void, []>();
jest.mock("@/miyo/miyoIndex", () => ({
  notifyMiyoIndexChanged: () => notifyMiyoIndexChanged(),
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
let mockIgnoreFilters: string[] = [];
const mockAppInstance = {
  vault: {
    getConfig: (key: string) => (key === "userIgnoreFilters" ? mockIgnoreFilters : undefined),
  },
};
jest.mock("@/context", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook; name must match the export
  useApp: () => mockAppInstance,
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
import { refreshMiyoStatus } from "@/miyo/miyoStatusStore";

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
  addFolderBodies.length = 0;
  mockIgnoreFilters = [];
  syncMiyoSystemExclusions.mockResolvedValue(false);
});

it("registers the vault with system roots and Obsidian ignores, but no user QA rules — https://github.com/Brevilabs/obsidian-copilot-private/issues/284", async () => {
  mockRegistration = "unregistered";
  mockIgnoreFilters = ["private/"];
  render(<MiyoSettings />);

  fireEvent.click(await screen.findByText("Connect"));
  await waitFor(() => expect(lastModalOptions).not.toBeNull());
  expect(lastModalOptions?.onAddVault).toBeDefined();

  await lastModalOptions?.onAddVault?.();

  // Copilot's roots and Obsidian's own ignored paths are always excluded so
  // they cannot consume Miyo's bounded result pool. User QA rules stay local.
  expect(addFolderBodies).toEqual([
    {
      path: "/vault",
      exclude_folders: ["copilot", "private"],
      allow_remote_read: true,
    },
  ]);
  expect(notifyMiyoIndexChanged).toHaveBeenCalledTimes(1);
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

describe("connection status and recovery", () => {
  it("shows Retry and Disconnect when enabled Miyo is unavailable (https://github.com/Brevilabs/obsidian-copilot-private/issues/356)", async () => {
    // Regression: the pill used to key on live health, so a stranded enableMiyo
    // (Miyo enabled, then it went offline) showed only "Connect" — while search
    // still routed to the dead backend with no way to turn it off. The pill now
    // keys on intent, so Disconnect is always reachable when enableMiyo=true.
    mockMiyoBackend = "unavailable";
    currentSettings = { ...DEFAULT_SETTINGS, enableMiyo: true };
    render(<MiyoSettings />);

    expect(await screen.findByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeTruthy();
    expect(screen.queryByText("Connect")).toBeNull();
    expect(screen.getByText("Unavailable")).toBeTruthy();
    expect(
      screen.getByText("Miyo is unavailable. Open it, then retry the connection above.")
    ).toBeTruthy();
  });

  it("shows Connect when Miyo is not enabled (https://github.com/Brevilabs/obsidian-copilot-private/issues/356)", async () => {
    mockMiyoBackend = "unavailable";
    currentSettings = { ...DEFAULT_SETTINGS, enableMiyo: false };
    render(<MiyoSettings />);

    // Wait out the mount refresh so the button settles from "Connecting…" to "Connect".
    expect(await screen.findByText("Connect")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull();
  });

  it("shows checking without unavailable guidance while a stale snapshot is rechecked (https://github.com/Brevilabs/obsidian-copilot-private/issues/356)", async () => {
    const gate = deferred<{ backend: string }>();
    mockRefreshGate = gate.promise;
    mockMiyoBackend = "stale";
    currentSettings = { ...DEFAULT_SETTINGS, enableMiyo: true };
    render(<MiyoSettings />);

    expect(screen.getByRole("status").textContent).toContain("Checking…");
    expect(screen.queryByText(/Connected ·/)).toBeNull();
    expect(
      screen.queryByText("Miyo is unavailable. Open it, then retry the connection above.")
    ).toBeNull();

    mockMiyoBackend = "available";
    gate.resolve({ backend: "available" });
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Connected ·"));
  });

  it("forces a status refresh without toggling enableMiyo when Retry succeeds (https://github.com/Brevilabs/obsidian-copilot-private/issues/356)", async () => {
    mockMiyoBackend = "unavailable";
    mockRefreshBackend = "available";
    currentSettings = { ...DEFAULT_SETTINGS, enableMiyo: true };
    render(<MiyoSettings />);
    await waitFor(() => expect(refreshMiyoStatus).toHaveBeenCalledWith({ force: false }));
    jest.mocked(refreshMiyoStatus).mockClear();
    updateSetting.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(refreshMiyoStatus).toHaveBeenCalledWith({ force: true }));
    expect(updateSetting).not.toHaveBeenCalledWith("enableMiyo", expect.anything());
  });
});

describe("Connect — two-phase commit rolls back on a failed health check", () => {
  // Start disconnected so the pill shows "Connect".
  beforeEach(() => {
    mockMiyoBackend = "unavailable";
    currentSettings = {
      ...DEFAULT_SETTINGS,
      enableMiyo: false,
    };
  });

  it("reconciles system roots before enabling an existing registration (https://github.com/Brevilabs/obsidian-copilot-private/issues/284)", async () => {
    mockReachable = true;
    mockRegistration = "registered";
    mockRefreshBackend = "available";
    render(<MiyoSettings />);

    fireEvent.click(await screen.findByText("Connect"));

    await waitFor(() => expect(syncMiyoSystemExclusions).toHaveBeenCalledTimes(1));
    expect(updateSetting).toHaveBeenCalledWith("enableMiyo", true);
  });

  it("rolls back Miyo without writing retired index settings when the enable refresh fails (https://github.com/Brevilabs/obsidian-copilot-private/issues/283)", async () => {
    // Reachable + registered, so the flow reaches enableMiyoBackend and writes
    // the Miyo flag true — but the post-enable refresh reports NOT available.
    mockReachable = true;
    mockRegistration = "registered";
    mockRefreshBackend = "unavailable";
    render(<MiyoSettings />);

    fireEvent.click(await screen.findByText("Connect"));

    // The flag flips on, then reverts once the health check comes back unavailable
    // — otherwise search routing would key off a stranded enableMiyo=true.
    await waitFor(() => expect(updateSetting).toHaveBeenCalledWith("enableMiyo", false));
    expect(updateSetting).toHaveBeenCalledWith("enableMiyo", true);
    expect(updateSetting).toHaveBeenCalledTimes(2);
  });

  it("does NOT roll back when the enable refresh confirms available", async () => {
    mockReachable = true;
    mockRegistration = "registered";
    mockRefreshBackend = "available";
    render(<MiyoSettings />);

    fireEvent.click(await screen.findByText("Connect"));

    await waitFor(() => expect(updateSetting).toHaveBeenCalledWith("enableMiyo", true));
    // A successful connect must leave the flag on — no revert write.
    expect(updateSetting).not.toHaveBeenCalledWith("enableMiyo", false);
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
