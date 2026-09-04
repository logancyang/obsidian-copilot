import { MiyoClient } from "@/miyo/MiyoClient";
import {
  notifyMiyoIndexChanged,
  onMiyoIndexChanged,
  requestMiyoIndexRefresh,
} from "@/miyo/miyoIndex";
import { getSettings } from "@/settings/model";

const resolveBaseUrl = jest.fn();
const scanFolder = jest.fn();

jest.mock("@/miyo/MiyoClient", () => ({
  MiyoClient: jest.fn().mockImplementation(() => ({ resolveBaseUrl, scanFolder })),
}));

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(),
}));

jest.mock("@/miyo/miyoUtils", () => ({
  getMiyoCustomUrl: jest.fn(() => "http://miyo.test"),
  getMiyoFolderName: jest.fn(() => "Test vault"),
}));

describe("miyoIndex", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getSettings as jest.Mock).mockReturnValue({ plusLicenseKey: "license" });
    resolveBaseUrl.mockResolvedValue("http://resolved.test");
    scanFolder.mockResolvedValue(undefined);
  });

  describe("requestMiyoIndexRefresh()", () => {
    it("requests a normal scan and invalidates subscribers after success https://github.com/Brevilabs/obsidian-copilot-private/issues/281", async () => {
      const listener = jest.fn();
      const unsubscribe = onMiyoIndexChanged(listener);

      await requestMiyoIndexRefresh({} as never);

      expect(MiyoClient).toHaveBeenCalledWith({ plusLicenseKey: "license" });
      expect(resolveBaseUrl).toHaveBeenCalledWith("http://miyo.test");
      expect(scanFolder).toHaveBeenCalledWith("http://resolved.test", "Test vault", false);
      expect(listener).toHaveBeenCalledTimes(1);
      unsubscribe();
    });

    it("does not invalidate subscribers when the scan request fails", async () => {
      const listener = jest.fn();
      const unsubscribe = onMiyoIndexChanged(listener);
      scanFolder.mockRejectedValue(new Error("offline"));

      await expect(requestMiyoIndexRefresh({} as never)).rejects.toThrow("offline");

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
