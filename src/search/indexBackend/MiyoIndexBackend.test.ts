jest.mock("obsidian", () => ({ Notice: jest.fn(), App: class {} }));
jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock("@/settings/model", () => ({ getSettings: () => ({}) }));
jest.mock("@/miyo/miyoUtils", () => ({
  getMiyoCustomUrl: () => "",
  getMiyoFolderName: () => "MyVault",
  getMiyoFilePath: jest.fn(),
  getVaultRelativeMiyoPath: jest.fn(),
}));

const getFolderMock = jest.fn();
jest.mock("@/miyo/MiyoClient", () => ({
  MiyoClient: class {
    resolveBaseUrl = jest.fn().mockResolvedValue("http://127.0.0.1:8742");
    getFolder = getFolderMock;
  },
}));

import { Notice } from "obsidian";
import { MiyoIndexBackend } from "./MiyoIndexBackend";

const NoticeMock = Notice as unknown as jest.Mock;

describe("MiyoIndexBackend.initialize failure notice", () => {
  beforeEach(() => {
    NoticeMock.mockClear();
    getFolderMock.mockReset();
  });

  it("shows user-facing guidance naming the vault when Miyo can't be reached", async () => {
    getFolderMock.mockRejectedValue(new Error("connection refused"));
    const backend = new MiyoIndexBackend({} as never);

    await backend.initialize(undefined);

    expect(NoticeMock).toHaveBeenCalledTimes(1);
    const msg = String(NoticeMock.mock.calls[0][0]);
    // Names the vault and tells the user to add it to Miyo.
    expect(msg).toContain('"MyVault"');
    expect(msg).toContain("Miyo");
    expect(msg.toLowerCase()).toContain("added to it");
    // No developer jargon.
    expect(msg).not.toContain("service discovery");
    expect(msg.toLowerCase()).not.toContain("initialize");
    expect(msg.toLowerCase()).not.toContain("backend");
  });

  it("does not show a notice when the folder check succeeds", async () => {
    getFolderMock.mockResolvedValue({});
    const backend = new MiyoIndexBackend({} as never);

    await backend.initialize(undefined);

    expect(NoticeMock).not.toHaveBeenCalled();
  });
});
