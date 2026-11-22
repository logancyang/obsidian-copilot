import { refreshMiyoFolderName } from "@/miyo/miyoUtils";
import { useMiyoFolderName } from "@/miyo/useMiyoFolderName";
import { setSettings } from "@/settings/model";
import { act, renderHook } from "@testing-library/react";
import { Platform, type App } from "obsidian";

jest.mock("@/miyo/miyoStatusStore", () => ({
  isMiyoAvailableForCapability: jest.fn(),
  getMiyoStatusSnapshot: jest.fn(),
  refreshMiyoStatus: jest.fn(),
}));
jest.mock("@/utils/vaultPath", () => ({ getVaultBase: () => "/Users/me/Vedas" }));

const app = { vault: { getName: () => "Vedas" } } as unknown as App;
const miyoWithFolder = (name: string | null) => ({
  resolveBaseUrl: jest.fn().mockResolvedValue("http://127.0.0.1:8742"),
  getFolder: jest.fn().mockResolvedValue(name === null ? null : { path: name }),
});

describe("useMiyoFolderName", () => {
  describe("useMiyoFolderName()", () => {
    beforeEach(() => {
      (Platform as { isMobile: boolean }).isMobile = false;
      setSettings({ enableMiyo: true, miyoConnectionMode: "local", miyoServerUrl: "" });
    });

    afterEach(async () => {
      await act(async () => {
        await refreshMiyoFolderName(app, miyoWithFolder(null));
      });
      setSettings({ enableMiyo: false });
    });

    it("https://github.com/logancyang/obsidian-copilot/issues/3690 returns the vault's name until a lookup finds Miyo's name for it, then re-renders with that name", async () => {
      const { result } = renderHook(() => useMiyoFolderName(app));
      expect(result.current).toBe("Vedas");

      await act(async () => {
        await refreshMiyoFolderName(app, miyoWithFolder("Notes"));
      });

      expect(result.current).toBe("Notes");
    });
  });
});
