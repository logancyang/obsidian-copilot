import { MiyoClient } from "@/miyo/MiyoClient";
import {
  notifyMiyoIndexChanged,
  onMiyoIndexChanged,
  requestMiyoIndexRefresh,
} from "@/miyo/miyoIndex";
import { resolveMiyoFolderName } from "@/miyo/miyoUtils";
import { getSettings } from "@/settings/model";
import type { App } from "obsidian";

const resolveBaseUrl = jest.fn();
const scanFolder = jest.fn();

jest.mock("@/miyo/MiyoClient", () => ({
  MiyoClient: jest.fn().mockImplementation(() => ({ resolveBaseUrl, scanFolder })),
}));

jest.mock("@/miyo/miyoStatusStore", () => ({}));

jest.mock("@/miyo/miyoUtils", () => ({
  ...jest.requireActual<typeof import("@/miyo/miyoUtils")>("@/miyo/miyoUtils"),
  resolveMiyoFolderName: jest.fn(),
}));

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(),
}));

const app = { vault: { getName: () => "Test vault" } } as unknown as App;

describe("miyoIndex", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getSettings as jest.Mock).mockReturnValue({
      plusLicenseKey: "license",
      enableMiyo: true,
      miyoServerUrl: "http://miyo.test",
    });
    resolveBaseUrl.mockResolvedValue("http://resolved.test");
    scanFolder.mockResolvedValue(undefined);
    (resolveMiyoFolderName as jest.Mock).mockResolvedValue("Notes");
  });

  describe("requestMiyoIndexRefresh()", () => {
    it("requests a normal scan of the folder Miyo resolves for the vault and invalidates subscribers after success https://github.com/Brevilabs/obsidian-copilot-private/issues/281 https://github.com/logancyang/obsidian-copilot/issues/3690", async () => {
      const listener = jest.fn();
      const unsubscribe = onMiyoIndexChanged(listener);

      await requestMiyoIndexRefresh(app);

      expect(MiyoClient).toHaveBeenCalledWith({ plusLicenseKey: "license" });
      expect(resolveBaseUrl).toHaveBeenCalledWith("http://miyo.test");
      expect(resolveMiyoFolderName).toHaveBeenCalledWith(
        app,
        expect.anything(),
        "http://resolved.test"
      );
      expect(scanFolder).toHaveBeenCalledWith("http://resolved.test", "Notes", false);
      expect(listener).toHaveBeenCalledTimes(1);
      unsubscribe();
    });

    it("does not invalidate subscribers when the scan request fails", async () => {
      const listener = jest.fn();
      const unsubscribe = onMiyoIndexChanged(listener);
      scanFolder.mockRejectedValue(new Error("offline"));

      await expect(requestMiyoIndexRefresh(app)).rejects.toThrow("offline");

      expect(listener).not.toHaveBeenCalled();
      unsubscribe();
    });
  });

  describe("onMiyoIndexChanged()", () => {
    it("stops delivering changes after unsubscribe", () => {
      const listener = jest.fn();
      const unsubscribe = onMiyoIndexChanged(listener);

      unsubscribe();
      notifyMiyoIndexChanged();

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("notifyMiyoIndexChanged()", () => {
    it("delivers a change to every active subscriber", () => {
      const first = jest.fn();
      const second = jest.fn();
      const unsubscribeFirst = onMiyoIndexChanged(first);
      const unsubscribeSecond = onMiyoIndexChanged(second);

      notifyMiyoIndexChanged();

      expect(first).toHaveBeenCalledTimes(1);
      expect(second).toHaveBeenCalledTimes(1);
      unsubscribeFirst();
      unsubscribeSecond();
    });
  });
});
