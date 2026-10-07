import { DEFAULT_SETTINGS } from "@/constants";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

const refreshSkills = jest.fn<Promise<{ ok: boolean; reconcileErrorCount?: number }>, unknown[]>();
jest.mock("@/agentMode", () => ({
  SkillManager: { getInstance: () => ({ refresh: refreshSkills }) },
}));

const updateSetting = jest.fn<void, unknown[]>();
let currentSettings = { ...DEFAULT_SETTINGS };
jest.mock("@/settings/model", () => ({
  updateSetting: (...a: unknown[]) => updateSetting(...a),
  getSettings: () => currentSettings,
  setSettings: (patch: Partial<typeof currentSettings>) => {
    currentSettings = { ...currentSettings, ...patch };
  },
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook; name must match the export
  useSettingsValue: () => currentSettings,
  normalizeRootFolders:
    jest.requireActual<typeof import("@/settings/model")>("@/settings/model").normalizeRootFolders,
  normalizeMiyoFolderNames:
    jest.requireActual<typeof import("@/settings/model")>("@/settings/model")
      .normalizeMiyoFolderNames,
}));

let mockMiyoBackend: "available" | "unavailable" | "unknown" | "stale" = "available";
jest.mock("@/miyo/useMiyoStatus", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook; name must match the export
  useMiyoStatus: () => ({
    backend: mockMiyoBackend,
    connector: mockMiyoBackend,
    chatSync: mockMiyoBackend,
  }),
}));
let mockRefreshBackend: "available" | "unavailable" | "stale" = "available";
let mockRefreshGate: Promise<{ backend: string }> | null = null;
jest.mock("@/miyo/miyoStatusStore", () => ({
  refreshMiyoStatus: jest.fn(
    () => mockRefreshGate ?? Promise.resolve({ backend: mockRefreshBackend })
  ),
}));
let mockReachable = true;
let mockProbeGate: Promise<boolean> | null = null;
const mockProbeUrls: Array<string | undefined> = [];
let mockRegistrationGate: Promise<"registered"> | null = null;
let mockRegistration: "registered" | "unregistered" | "error" = "registered";
const addFolderBodies: unknown[] = [];
let expireLifecycleBeforeAddRequest = false;
let addFolderError: Error | null = null;
let mockFolders: Array<{ path: string; origin?: string }> = [];
let mockListFoldersError: Error | null = null;
const mockListedBaseUrls: string[] = [];
jest.mock("@/miyo/MiyoClient", () => ({
  MiyoClient: class {
    resolveBaseUrl = async (url?: string) => url || "http://127.0.0.1:8742";
    listFolders = async (baseUrl: string) => {
      mockListedBaseUrls.push(baseUrl);
      if (mockListFoldersError) throw mockListFoldersError;
      return { folders: mockFolders };
    };
    isBackendAvailable = async (url?: string) => {
      mockProbeUrls.push(url);
      return mockProbeGate ?? mockReachable;
    };
    checkFolderRegistration = async () => mockRegistrationGate ?? mockRegistration;
    addFolder = async (request: unknown, _overrideUrl?: string, beforeRequest?: () => void) => {
      if (expireLifecycleBeforeAddRequest) {
        mockLifecycleActive = false;
      }
      beforeRequest?.();
      addFolderBodies.push(request);
      if (addFolderError) throw addFolderError;
      return { path: "/vault" };
    };
  },
}));
jest.mock("@/miyo/miyoUtils", () => ({
  getMiyoCustomUrl: jest.requireActual<typeof import("@/miyo/miyoRuntimePolicy")>(
    "@/miyo/miyoRuntimePolicy"
  ).getMiyoCustomUrl,
  getMiyoFolderName: () => "vault",
  getExtraSearchFolderOptions:
    jest.requireActual<typeof import("@/miyo/miyoUtils")>("@/miyo/miyoUtils")
      .getExtraSearchFolderOptions,
  isLocalMiyoUrl: () => true,
  MIYO_ADD_FOLDER_DEEPLINK_URL: "miyo://add",
  MIYO_DEEPLINK_URL: "miyo://",
}));
const notifyMiyoIndexChanged = jest.fn<void, []>();
jest.mock("@/miyo/miyoIndex", () => ({
  notifyMiyoIndexChanged: () => notifyMiyoIndexChanged(),
}));
let lastModalOptions: {
  downloadUrl: string;
  onRetry: () => Promise<unknown>;
  onClose: () => void;
  onAddVault?: () => Promise<unknown>;
} | null = null;
jest.mock("@/settings/v2/components/MiyoConnectModal", () => ({
  MiyoConnectModal: class {
    constructor(
      _app: unknown,
      options: {
        downloadUrl: string;
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
let mockIgnoreFilters: string[] = [];
const mockAppInstance = {
  vault: {
    getConfig: (key: string) => (key === "userIgnoreFilters" ? mockIgnoreFilters : undefined),
  },
};
let mockLifecycleActive = true;
jest.mock("@/context", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook; name must match the export
  useApp: () => mockAppInstance,
}));
jest.mock("@/contexts/PluginContext", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook; name must match the export
  usePlugin: () => ({ isPluginLifecycleActive: () => mockLifecycleActive }),
}));
jest.mock("@/utils/vaultPath", () => ({ getVaultBase: () => "/vault" }));

const mockOnDesktop = jest.fn<boolean, []>().mockReturnValue(true);
jest.mock("@/utils/desktopRuntime", () => ({ isDesktopRuntime: () => mockOnDesktop() }));

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

function disconnectedMiyo() {
  mockMiyoBackend = "unavailable";
  currentSettings = { ...DEFAULT_SETTINGS, enableMiyo: false };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("MiyoSettings", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    refreshSkills.mockResolvedValue({ ok: true });
    currentSettings = { ...DEFAULT_SETTINGS, enableMiyoSearchSkill: false };
    updateSetting.mockImplementation((key, value) => {
      currentSettings = { ...currentSettings, [key as string]: value };
    });
    mockMiyoBackend = "available";
    mockRefreshBackend = "available";
    mockRefreshGate = null;
    mockReachable = true;
    mockProbeGate = null;
    mockProbeUrls.length = 0;
    mockRegistration = "registered";
    mockRegistrationGate = null;
    lastModalOptions = null;
    addFolderBodies.length = 0;
    mockIgnoreFilters = [];
    mockOnDesktop.mockReturnValue(true);
    mockLifecycleActive = true;
    expireLifecycleBeforeAddRequest = false;
    addFolderError = null;
    mockFolders = [];
    mockListFoldersError = null;
    mockListedBaseUrls.length = 0;
  });

  describe("MiyoSettings()", () => {
    it("shows an Offline badge on the saved option while disconnected and omits the intro and Tailscale hint — https://github.com/Brevilabs/obsidian-copilot-private/issues/466", async () => {
      currentSettings = {
        ...currentSettings,
        enableMiyo: false,
        miyoConnectionMode: "remote",
        miyoServerUrl: "http://home:8742",
      };
      render(<MiyoSettings />);
      await act(async () => {});
      expect(screen.getByRole("status").textContent).toBe("Offline");
      expect(screen.getByRole("status").closest("label")?.textContent).toContain("Remote server");
      expect(screen.queryByText("Private context from your Miyo server.")).toBeNull();
      expect(screen.queryByText(/Tailscale/)).toBeNull();
      expect(screen.getByRole("button", { name: "Connect" })).toBeTruthy();
    });

    it("describes Document Processor using the selected backend — https://github.com/Brevilabs/obsidian-copilot-private/issues/466", async () => {
      currentSettings.docProcessorBackend = "plus";
      const { rerender } = render(<MiyoSettings />);
      await act(async () => {});
      expect(
        screen.getByText("Use Copilot Cloud to process PDF, EPUB, and other formats.")
      ).toBeTruthy();
      expect(screen.queryByText(/uses credits/)).toBeNull();
      currentSettings.docProcessorBackend = "miyo";
      rerender(<MiyoSettings />);
      expect(
        screen.getByText("Miyo processes PDF and EPUB. Other formats use Copilot Cloud.")
      ).toBeTruthy();
      expect(
        screen.queryByText("Use Copilot Cloud to process PDF, EPUB, and other formats.")
      ).toBeNull();
    });

    it("shows Search scope only while Semantic search is enabled — https://github.com/Brevilabs/obsidian-copilot-private/issues/466", async () => {
      render(<MiyoSettings />);
      await act(async () => {});
      expect(screen.queryByLabelText("Search scope")).toBeNull();
      fireEvent.click(toggle());
      expect(screen.getByLabelText("Search scope")).toBeTruthy();
      await waitFor(() => expect(currentSettings.enableMiyoSearchSkill).toBe(true));
      fireEvent.click(toggle());
      expect(screen.queryByLabelText("Search scope")).toBeNull();
      await waitFor(() => expect(currentSettings.enableMiyoSearchSkill).toBe(false));
    });
    it("lists the connected Miyo host's other folders under Current vault scope, ticked as saved and without this vault — https://github.com/logancyang/obsidian-copilot/issues/3508", async () => {
      currentSettings = {
        ...currentSettings,
        enableMiyo: true,
        miyoConnectionMode: "remote",
        miyoServerUrl: "http://home:8742",
        enableMiyoSearchSkill: true,
        miyoExtraSearchFolders: ["Research"],
      };
      mockFolders = [
        { path: "vault", origin: "user" },
        { path: "Research", origin: "user" },
        { path: "ChatGPT", origin: "chat_sync" },
      ];
      render(<MiyoSettings />);

      const research = await screen.findByRole("checkbox", { name: "Research" });
      expect(research.getAttribute("aria-checked")).toBe("true");
      const chat = screen.getByRole("checkbox", { name: "ChatGPT" });
      expect(chat.getAttribute("aria-checked")).toBe("false");
      expect(chat.closest("label")?.textContent).toContain("Chat");
      expect(screen.queryByRole("checkbox", { name: "vault" })).toBeNull();
      expect(mockListedBaseUrls).toContain("http://home:8742");
    });

    it("saves the ticked folders as the extra search folder list — https://github.com/logancyang/obsidian-copilot/issues/3508", async () => {
      currentSettings = {
        ...currentSettings,
        enableMiyo: true,
        enableMiyoSearchSkill: true,
        miyoExtraSearchFolders: ["Research"],
      };
      mockFolders = [{ path: "Research" }, { path: "ChatGPT", origin: "chat_sync" }];
      render(<MiyoSettings />);

      fireEvent.click(await screen.findByRole("checkbox", { name: "ChatGPT" }));

      expect(updateSetting).toHaveBeenCalledWith("miyoExtraSearchFolders", ["Research", "ChatGPT"]);
    });

    it("shows no folder list and fetches none while the scope is Unrestricted — https://github.com/logancyang/obsidian-copilot/issues/3508", async () => {
      currentSettings = {
        ...currentSettings,
        enableMiyo: true,
        enableMiyoSearchSkill: true,
        miyoSearchAll: true,
      };
      mockFolders = [{ path: "Research" }];
      render(<MiyoSettings />);
      await act(async () => {});

      expect(screen.getByLabelText("Search scope")).toBeTruthy();
      expect(screen.queryByText("Also search these Miyo folders")).toBeNull();
      expect(mockListedBaseUrls).toEqual([]);
    });

    it("shows no folder list and fetches none while Miyo is unavailable — https://github.com/logancyang/obsidian-copilot/issues/3508", async () => {
      mockMiyoBackend = "unavailable";
      currentSettings = { ...currentSettings, enableMiyo: true, enableMiyoSearchSkill: true };
      render(<MiyoSettings />);
      await act(async () => {});

      expect(screen.queryByText("Also search these Miyo folders")).toBeNull();
      expect(mockListedBaseUrls).toEqual([]);
    });

    it("says the folder list could not be loaded when Miyo rejects the request — https://github.com/logancyang/obsidian-copilot/issues/3508", async () => {
      currentSettings = { ...currentSettings, enableMiyo: true, enableMiyoSearchSkill: true };
      mockListFoldersError = new Error("Miyo request failed with status 500");
      render(<MiyoSettings />);

      expect(await screen.findByText("Couldn't load your Miyo folders.")).toBeTruthy();
    });

    it("hides the agent search skill row on mobile, where Agent mode cannot run — https://github.com/Brevilabs/obsidian-copilot-private/issues/471", async () => {
      mockOnDesktop.mockReturnValue(false);
      currentSettings = { ...currentSettings, enableMiyoSearchSkill: true };
      render(<MiyoSettings />);
      await act(async () => {});
      expect(screen.queryByLabelText("Enable Miyo semantic search skill")).toBeNull();
      expect(screen.queryByText("Semantic search for agents")).toBeNull();
    });

    it("offers only a remote connection on mobile without persisting the fallback over the synced mode — https://github.com/Brevilabs/obsidian-copilot-private/issues/471", async () => {
      mockOnDesktop.mockReturnValue(false);
      currentSettings = { ...currentSettings, miyoConnectionMode: "local", miyoServerUrl: "" };
      render(<MiyoSettings />);
      await act(async () => {});
      const local = screen.getByRole<HTMLInputElement>("radio", { name: /^Local/ });
      expect(local.disabled).toBe(true);
      expect(local.checked).toBe(false);
      expect(screen.getByRole<HTMLInputElement>("radio", { name: /^Remote server/ }).checked).toBe(
        true
      );
      expect(screen.getByLabelText("Server address")).toBeTruthy();
      expect(currentSettings.miyoConnectionMode).toBe("local");
      expect(updateSetting).not.toHaveBeenCalledWith("miyoConnectionMode", expect.anything());
    });

    it.each(["reachability", "registration"])(
      "keeps an external disconnect when a retry's %s check completes — https://github.com/Brevilabs/obsidian-copilot-private/issues/466",
      async (phase) => {
        mockReachable = false;
        render(<MiyoSettings />);
        fireEvent.click(await screen.findByText("Connect"));
        await waitFor(() => expect(lastModalOptions?.onRetry).toBeDefined());
        currentSettings = { ...currentSettings, enableMiyo: true };
        mockReachable = true;
        const probe = deferred<boolean>();
        const registration = deferred<"registered">();
        if (phase === "reachability") mockProbeGate = probe.promise;
        else mockRegistrationGate = registration.promise;
        let retry!: Promise<unknown>;
        await act(async () => {
          retry = lastModalOptions!.onRetry();
        });
        currentSettings = { ...currentSettings, enableMiyo: false };
        updateSetting.mockClear();
        await act(async () => {
          probe.resolve(true);
          registration.resolve("registered");
          await retry;
        });
        expect(currentSettings.enableMiyo).toBe(false);
        expect(updateSetting).not.toHaveBeenCalledWith("enableMiyo", true);
      }
    );

    it("attributes the settings Download link and connection guide separately", async () => {
      mockReachable = false;
      render(<MiyoSettings />);

      expect(screen.getByRole("link", { name: "Download" }).getAttribute("href")).toBe(
        "https://www.miyo.md/?utm_source=obsidian_copilot&utm_medium=miyo_settings"
      );
      fireEvent.click(await screen.findByText("Connect"));
      await waitFor(() =>
        expect(lastModalOptions?.downloadUrl).toBe(
          "https://www.miyo.md/?utm_source=obsidian_copilot&utm_medium=connection"
        )
      );
    });

    it("keeps registration incomplete without enabling or announcing index changes after a folder conflict (https://github.com/Brevilabs/obsidian-copilot-private/issues/402)", async () => {
      mockRegistration = "unregistered";
      addFolderError = new Error(
        "Miyo add-folder failed with status 409: Folder overlaps with existing registration"
      );
      render(<MiyoSettings />);
      fireEvent.click(await screen.findByText("Connect"));
      await waitFor(() => expect(lastModalOptions?.onAddVault).toBeDefined());
      jest.mocked(refreshMiyoStatus).mockClear();
      await act(async () => {
        await expect(lastModalOptions?.onAddVault?.()).resolves.toBe("error");
      });
      expect(updateSetting).not.toHaveBeenCalledWith("enableMiyo", true);
      expect(refreshMiyoStatus).not.toHaveBeenCalled();
      expect(notifyMiyoIndexChanged).not.toHaveBeenCalled();
    });

    it("connects to a healthy explicit loopback server without local registration when this vault is missing — https://github.com/Brevilabs/obsidian-copilot-private/issues/466", async () => {
      currentSettings = {
        ...currentSettings,
        enableMiyo: false,
        miyoServerUrl: "http://127.0.0.1:8742",
      };
      mockRegistration = "unregistered";
      render(<MiyoSettings />);
      fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
      await waitFor(() => expect(updateSetting).toHaveBeenCalledWith("enableMiyo", true));
      expect(mockProbeUrls).toContain("http://127.0.0.1:8742");
      expect(lastModalOptions).toBeNull();
      expect(addFolderBodies).toEqual([]);
      expect(await screen.findByText("Connected")).toBeTruthy();
      expect(screen.queryByText(/Current vault isn't confirmed/)).toBeNull();
      expect(screen.queryByText("Current vault registered on this server.")).toBeNull();
      expect(screen.getByText("Set up Relay on the Miyo host.")).toBeTruthy();
    });

    it("keeps an unreachable remote address editable without asking for a local installation — https://github.com/Brevilabs/obsidian-copilot-private/issues/466", async () => {
      currentSettings = {
        ...currentSettings,
        enableMiyo: false,
        miyoServerUrl: "http://remote:8742",
      };
      mockReachable = false;
      render(<MiyoSettings />);
      fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
      expect((await screen.findByRole("alert")).textContent).toContain(
        "Couldn't connect to this server"
      );
      expect(lastModalOptions).toBeNull();
      expect(screen.queryByRole("link", { name: "Download" })).toBeNull();
      expect(currentSettings.miyoServerUrl).toBe("http://remote:8742");
    });

    it("keeps the active remote connection while browsing this computer and confirms only on Connect — https://github.com/Brevilabs/obsidian-copilot-private/issues/466", async () => {
      currentSettings = {
        ...currentSettings,
        enableMiyo: true,
        miyoServerUrl: "http://remote:8742",
        enableMiyoSearchSkill: true,
        miyoSearchAll: true,
        docProcessorBackend: "miyo",
      };
      render(<MiyoSettings />);
      fireEvent.click(screen.getByRole("radio", { name: /Local/ }));
      expect(currentSettings.enableMiyo).toBe(true);
      expect(currentSettings.miyoConnectionMode).not.toBe("local");
      expect(await screen.findByText("Connected")).toBeTruthy();
      expect(screen.getByRole("status").closest("label")?.textContent).toContain("Remote server");
      expect(screen.getByRole("button", { name: "Connect" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Check connection" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull();
      expect(screen.getByText("Set up Relay on the Miyo host.")).toBeTruthy();
      expect(screen.queryByText(/Switching disconnects/)).toBeNull();
      fireEvent.click(screen.getByRole("radio", { name: /Remote server/ }));
      expect(screen.getByLabelText<HTMLInputElement>("Server address").value).toBe(
        "http://remote:8742"
      );
      expect(currentSettings).toMatchObject({
        enableMiyoSearchSkill: true,
        miyoSearchAll: true,
        docProcessorBackend: "miyo",
      });
      expect(updateSetting).not.toHaveBeenCalledWith("miyoServerUrl", "");
      expect(mockProbeUrls).toEqual([]);
      fireEvent.click(screen.getByRole("radio", { name: /Local/ }));
      fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
      await waitFor(() => expect(mockProbeUrls).toContain(undefined));
      expect(currentSettings.miyoConnectionMode).toBe("local");
      expect(await screen.findByText("Connected")).toBeTruthy();
    });

    it("preserves local capabilities while drafting remote and changes the endpoint only on Connect — https://github.com/Brevilabs/obsidian-copilot-private/issues/466", async () => {
      currentSettings = { ...currentSettings, enableMiyo: true, miyoConnectionMode: "local" };
      render(<MiyoSettings />);
      await screen.findByText("Connected");
      fireEvent.click(screen.getByRole("radio", { name: /Remote server/ }));
      fireEvent.change(screen.getByLabelText("Server address"), {
        target: { value: "http://new:8742" },
      });
      expect(currentSettings.miyoConnectionMode).toBe("local");
      expect(currentSettings.miyoServerUrl).toBe("");
      expect(currentSettings.enableMiyo).toBe(true);
      expect(screen.getByText("Connected")).toBeTruthy();
      expect(screen.getByRole("status").closest("label")?.textContent).toContain("Local");
      expect(screen.queryByRole("button", { name: "Check connection" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull();
      expect(screen.queryByText("Set up Relay on the Miyo host.")).toBeNull();
      expect(toggle().hasAttribute("disabled")).toBe(false);
      expect(mockProbeUrls).toEqual([]);
      fireEvent.click(screen.getByRole("button", { name: "Connect" }));
      await waitFor(() => expect(mockProbeUrls).toContain("http://new:8742"));
      expect(currentSettings).toMatchObject({
        miyoConnectionMode: "remote",
        miyoServerUrl: "http://new:8742",
        enableMiyo: true,
      });
      expect(await screen.findByText("Connected")).toBeTruthy();
    });

    it("shows only Connect for a changed remote address while keeping the badge on the active remote option — https://github.com/Brevilabs/obsidian-copilot-private/issues/466", async () => {
      currentSettings = { ...currentSettings, enableMiyo: true, miyoServerUrl: "http://old:8742" };
      render(<MiyoSettings />);
      await screen.findByText("Connected");
      fireEvent.change(screen.getByLabelText("Server address"), {
        target: { value: "http://new:8742" },
      });
      expect(currentSettings.enableMiyo).toBe(true);
      expect(currentSettings.miyoServerUrl).toBe("http://old:8742");
      expect(screen.getByRole("status").closest("label")?.textContent).toContain("Remote server");
      expect(screen.queryByRole("button", { name: "Check connection" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull();
      expect(mockProbeUrls).toEqual([]);
      fireEvent.click(screen.getByRole("button", { name: "Connect" }));
      await waitFor(() => expect(mockProbeUrls).toContain("http://new:8742"));
      expect(currentSettings.miyoServerUrl).toBe("http://new:8742");
    });

    it("rejects an empty remote draft before any local discovery request — https://github.com/Brevilabs/obsidian-copilot-private/issues/466", async () => {
      currentSettings.enableMiyo = false;
      render(<MiyoSettings />);
      fireEvent.click(screen.getByRole("radio", { name: /Remote server/ }));
      fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
      expect((await screen.findByRole("alert")).textContent).toContain(
        "Enter a valid HTTP or HTTPS"
      );
      expect(mockProbeUrls).toEqual([]);
      expect(currentSettings.miyoConnectionMode).not.toBe("remote");
    });

    it("shows externally synced settings instead of applying a stale draft on connect — https://github.com/Brevilabs/obsidian-copilot-private/issues/466", async () => {
      currentSettings = { ...currentSettings, enableMiyo: false, miyoServerUrl: "http://old:8742" };
      const { rerender } = render(<MiyoSettings />);
      fireEvent.change(screen.getByLabelText("Server address"), {
        target: { value: "http://draft:8742" },
      });
      currentSettings = {
        ...currentSettings,
        miyoServerUrl: "http://synced:8742",
        miyoConnectionMode: "remote",
      };
      rerender(<MiyoSettings />);
      expect(screen.getByLabelText<HTMLInputElement>("Server address").value).toBe(
        "http://synced:8742"
      );
      fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
      await waitFor(() => expect(mockProbeUrls).toContain("http://synced:8742"));
      expect(mockProbeUrls).not.toContain("http://draft:8742");
    });

    it("preserves a synced connection when an old enable check finishes late — https://github.com/Brevilabs/obsidian-copilot-private/issues/466", async () => {
      currentSettings = { ...currentSettings, enableMiyo: false, miyoServerUrl: "http://old:8742" };
      const { rerender } = render(<MiyoSettings />);
      const connect = await screen.findByRole("button", { name: "Connect" });
      const gate = deferred<{ backend: string }>();
      mockRefreshGate = gate.promise;
      fireEvent.click(connect);
      await waitFor(() => expect(updateSetting).toHaveBeenCalledWith("enableMiyo", true));
      currentSettings = {
        ...currentSettings,
        enableMiyo: true,
        miyoServerUrl: "http://synced:8742",
      };
      rerender(<MiyoSettings />);
      await act(async () => gate.resolve({ backend: "available" }));
      expect(currentSettings.enableMiyo).toBe(true);
      expect(currentSettings.miyoServerUrl).toBe("http://synced:8742");
      expect(updateSetting).not.toHaveBeenCalledWith("enableMiyo", false);
    });

    it("finishes a confirmed remote connection when the user browses this computer during its probe — https://github.com/Brevilabs/obsidian-copilot-private/issues/466", async () => {
      currentSettings = {
        ...currentSettings,
        enableMiyo: false,
        miyoServerUrl: "http://remote:8742",
      };
      const gate = deferred<boolean>();
      mockProbeGate = gate.promise;
      const { rerender } = render(<MiyoSettings />);
      fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
      await waitFor(() => expect(mockProbeUrls).toHaveLength(1));
      fireEvent.click(screen.getByRole("radio", { name: /Local/ }));
      await act(async () => gate.resolve(true));
      expect(updateSetting).toHaveBeenCalledWith("enableMiyo", true);
      expect(currentSettings.miyoConnectionMode).toBe("remote");
      expect(screen.getByRole<HTMLInputElement>("radio", { name: /Local/ }).checked).toBe(true);
      rerender(<MiyoSettings />);
      expect(await screen.findByText("Connected")).toBeTruthy();
      expect(lastModalOptions).toBeNull();
    });

    it("registers the vault with system roots and Obsidian ignores, but no user QA rules — https://github.com/Brevilabs/obsidian-copilot-private/issues/284", async () => {
      mockRegistration = "unregistered";
      mockIgnoreFilters = ["private/", ".", "./", "..", "./notes", "/pattern/", "nested//ignored/"];
      render(<MiyoSettings />);

      fireEvent.click(await screen.findByText("Connect"));
      await waitFor(() => expect(lastModalOptions).not.toBeNull());
      expect(lastModalOptions?.onAddVault).toBeDefined();

      await act(async () => {
        await lastModalOptions?.onAddVault?.();
      });

      expect(addFolderBodies).toEqual([
        {
          path: "/vault",
          exclude_folders: ["copilot", "private", "./notes", "/pattern", "nested//ignored"],
          allow_remote_read: true,
        },
      ]);
      expect(notifyMiyoIndexChanged).toHaveBeenCalledTimes(1);
    });

    it("registers with the roots configured when the user confirms, not the ones open on the modal (https://github.com/Brevilabs/obsidian-copilot-private/issues/284)", async () => {
      mockRegistration = "unregistered";
      render(<MiyoSettings />);

      fireEvent.click(await screen.findByText("Connect"));
      await waitFor(() => expect(lastModalOptions?.onAddVault).toBeDefined());

      currentSettings = { ...currentSettings, copilotFolder: "team-ai" };

      await act(async () => {
        await lastModalOptions?.onAddVault?.();
      });

      expect(addFolderBodies).toEqual([
        {
          path: "/vault",
          exclude_folders: ["copilot", "team-ai"],
          allow_remote_read: true,
        },
      ]);
    });

    it("does not register or enable from an expired plugin lifecycle (https://github.com/Brevilabs/obsidian-copilot-private/issues/284)", async () => {
      mockRegistration = "unregistered";
      expireLifecycleBeforeAddRequest = true;
      render(<MiyoSettings />);

      fireEvent.click(await screen.findByText("Connect"));
      await waitFor(() => expect(lastModalOptions?.onAddVault).toBeDefined());
      await act(async () => {
        await lastModalOptions?.onAddVault?.();
      });

      expect(addFolderBodies).toEqual([]);
      expect(updateSetting).not.toHaveBeenCalledWith("enableMiyo", true);
      expect(notifyMiyoIndexChanged).not.toHaveBeenCalled();
    });

    it("saves the gate before using shared preference-aware reconciliation (https://github.com/logancyang/obsidian-copilot/issues/3022)", async () => {
      refreshSkills.mockImplementation(async () => {
        expect(updateSetting).toHaveBeenCalledWith("enableMiyoSearchSkill", true);
        return { ok: true };
      });
      render(<MiyoSettings />);
      fireEvent.click(toggle());
      await waitFor(() => expect(refreshSkills).toHaveBeenCalledWith(true));
      expect(NoticeMock).not.toHaveBeenCalled();
    });

    it.each([{ ok: false }, { ok: true, reconcileErrorCount: 1 }])(
      "restores the disabled Miyo gate after an enable failure %j (https://github.com/logancyang/obsidian-copilot/issues/3022)",
      async (result) => {
        refreshSkills.mockResolvedValue(result);
        render(<MiyoSettings />);
        fireEvent.click(toggle());
        await waitFor(() =>
          expect(updateSetting).toHaveBeenLastCalledWith("enableMiyoSearchSkill", false)
        );
        expect(updateSetting).toHaveBeenCalledWith("enableMiyoSearchSkill", true);
      }
    );

    it("retains a disable preference and reports unsuccessful cleanup (https://github.com/logancyang/obsidian-copilot/issues/3022)", async () => {
      currentSettings = { ...DEFAULT_SETTINGS, enableMiyoSearchSkill: true };
      refreshSkills.mockResolvedValue({ ok: true, reconcileErrorCount: 1 });
      render(<MiyoSettings />);
      fireEvent.click(toggle());
      await waitFor(() =>
        expect(NoticeMock).toHaveBeenCalledWith(expect.stringContaining("preference saved"))
      );
      expect(updateSetting).toHaveBeenCalledWith("enableMiyoSearchSkill", false);
      expect(updateSetting).not.toHaveBeenCalledWith("enableMiyoSearchSkill", true);
    });

    it("does not notify an unmounted tab after reconciliation (https://github.com/logancyang/obsidian-copilot/issues/3022)", async () => {
      const gate = deferred<{ ok: boolean }>();
      refreshSkills.mockReturnValue(gate.promise);
      const { unmount } = render(<MiyoSettings />);
      fireEvent.click(toggle());
      await waitFor(() => expect(refreshSkills).toHaveBeenCalledTimes(1));
      unmount();
      await act(async () => {
        gate.resolve({ ok: false });
      });
      expect(NoticeMock).not.toHaveBeenCalled();
      expect(updateSetting).toHaveBeenLastCalledWith("enableMiyoSearchSkill", false);
    });

    it("reports an unexpected reconciliation failure (https://github.com/logancyang/obsidian-copilot/issues/3022)", async () => {
      refreshSkills.mockRejectedValue(new Error("unavailable"));
      render(<MiyoSettings />);
      fireEvent.click(toggle());
      await waitFor(() =>
        expect(NoticeMock).toHaveBeenCalledWith(
          "Couldn't update the Miyo search skill. Please try again."
        )
      );
    });

    it("blocks ENABLING the skill while Miyo is disconnected (skill off)", async () => {
      mockMiyoBackend = "unavailable";
      currentSettings = { ...DEFAULT_SETTINGS, enableMiyoSearchSkill: false };
      render(<MiyoSettings />);

      const control = toggle();
      expect(control.getAttribute("aria-disabled")).toBe("true");
      fireEvent.click(control);

      expect(refreshSkills).not.toHaveBeenCalled();
      expect(updateSetting).not.toHaveBeenCalledWith("enableMiyoSearchSkill", true);
    });

    it("ALLOWS disabling an already-installed skill while Miyo is disconnected", async () => {
      mockMiyoBackend = "unavailable";
      currentSettings = { ...DEFAULT_SETTINGS, enableMiyoSearchSkill: true };
      render(<MiyoSettings />);

      const control = toggle();
      expect(control.getAttribute("aria-disabled")).toBe("false");
      fireEvent.click(control);

      await waitFor(() => expect(refreshSkills).toHaveBeenCalledTimes(1));
      expect(updateSetting).toHaveBeenCalledWith("enableMiyoSearchSkill", false);
    });

    it("keeps the skill toggle operable while the status snapshot is stale", async () => {
      mockMiyoBackend = "stale";
      currentSettings = { ...DEFAULT_SETTINGS, enableMiyoSearchSkill: true };
      render(<MiyoSettings />);

      const control = toggle();
      expect(control.getAttribute("aria-disabled")).toBe("false");
      fireEvent.click(control);
      await waitFor(() => expect(refreshSkills).toHaveBeenCalledTimes(1));
    });

    it("shows Offline with Check connection and Disconnect when enabled Miyo is unavailable (https://github.com/Brevilabs/obsidian-copilot-private/issues/356)", async () => {
      mockMiyoBackend = "unavailable";
      currentSettings = { ...DEFAULT_SETTINGS, enableMiyo: true };
      render(<MiyoSettings />);

      expect(await screen.findByRole("button", { name: "Check connection" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Disconnect" })).toBeTruthy();
      expect(screen.queryByText("Connect")).toBeNull();
      expect(screen.getByText("Offline")).toBeTruthy();
      expect(
        screen.getByText("Miyo is unavailable. Check your server, then retry the connection above.")
      ).toBeTruthy();
    });

    it("shows Connect when Miyo is not enabled (https://github.com/Brevilabs/obsidian-copilot-private/issues/356)", async () => {
      mockMiyoBackend = "unavailable";
      currentSettings = { ...DEFAULT_SETTINGS, enableMiyo: false };
      render(<MiyoSettings />);

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
      expect(screen.queryByText(/Connected/)).toBeNull();
      expect(
        screen.queryByText(
          "Miyo is unavailable. Check your server, then retry the connection above."
        )
      ).toBeNull();

      mockMiyoBackend = "available";
      gate.resolve({ backend: "available" });
      await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Connected"));
    });

    it("forces a status refresh without toggling enableMiyo when Check connection succeeds (https://github.com/Brevilabs/obsidian-copilot-private/issues/356)", async () => {
      mockMiyoBackend = "unavailable";
      mockRefreshBackend = "available";
      currentSettings = { ...DEFAULT_SETTINGS, enableMiyo: true };
      render(<MiyoSettings />);
      await waitFor(() => expect(refreshMiyoStatus).toHaveBeenCalledWith({ force: false }));
      jest.mocked(refreshMiyoStatus).mockClear();
      updateSetting.mockClear();

      fireEvent.click(screen.getByRole("button", { name: "Check connection" }));

      await waitFor(() => expect(refreshMiyoStatus).toHaveBeenCalledWith({ force: true }));
      expect(updateSetting).not.toHaveBeenCalledWith("enableMiyo", expect.anything());
    });

    it("rolls back Miyo without writing retired index settings when the enable refresh fails (https://github.com/Brevilabs/obsidian-copilot-private/issues/283)", async () => {
      disconnectedMiyo();
      mockReachable = true;
      mockRegistration = "registered";
      mockRefreshBackend = "unavailable";
      render(<MiyoSettings />);

      fireEvent.click(await screen.findByText("Connect"));

      await waitFor(() => expect(updateSetting).toHaveBeenCalledWith("enableMiyo", false));
      expect(updateSetting).toHaveBeenCalledWith("enableMiyo", true);
      expect(updateSetting).toHaveBeenCalledTimes(2);
    });

    it("does NOT roll back when the enable refresh confirms available", async () => {
      disconnectedMiyo();
      mockReachable = true;
      mockRegistration = "registered";
      mockRefreshBackend = "available";
      render(<MiyoSettings />);

      fireEvent.click(await screen.findByText("Connect"));

      await waitFor(() => expect(updateSetting).toHaveBeenCalledWith("enableMiyo", true));
      expect(updateSetting).not.toHaveBeenCalledWith("enableMiyo", false);
    });

    it("rolls back an optimistic enable when the attempt is superseded mid-refresh, even if it comes back available", async () => {
      disconnectedMiyo();
      mockReachable = true;
      mockRegistration = "registered";
      const { unmount } = render(<MiyoSettings />);

      const connectBtn = await screen.findByText("Connect");
      let resolveRefresh!: (v: { backend: string }) => void;
      mockRefreshGate = new Promise((r) => {
        resolveRefresh = r;
      });
      fireEvent.click(connectBtn);
      await waitFor(() => expect(updateSetting).toHaveBeenCalledWith("enableMiyo", true));

      unmount();
      resolveRefresh({ backend: "available" });

      await waitFor(() => expect(updateSetting).toHaveBeenCalledWith("enableMiyo", false));
    });

    it("does NOT let an older enable's revert clobber a newer concurrent enable that committed", async () => {
      disconnectedMiyo();
      mockRefreshBackend = "unavailable";
      render(<MiyoSettings />);
      fireEvent.click(await screen.findByText("Connect"));
      await waitFor(() => expect(lastModalOptions).not.toBeNull());

      let resolveRefresh!: (v: { backend: string }) => void;
      mockRefreshGate = new Promise((r) => {
        resolveRefresh = r;
      });
      updateSetting.mockClear();
      const enableTrueCount = () =>
        updateSetting.mock.calls.filter((c) => c[0] === "enableMiyo" && c[1] === true).length;

      const retryA = lastModalOptions!.onRetry();
      await waitFor(() => expect(enableTrueCount()).toBe(1));
      const retryB = lastModalOptions!.onRetry();
      await waitFor(() => expect(enableTrueCount()).toBe(2));

      resolveRefresh({ backend: "available" });
      await Promise.all([retryA, retryB]);

      expect(updateSetting).not.toHaveBeenCalledWith("enableMiyo", false);
      expect(enableTrueCount()).toBe(2);
    });
  });
});
