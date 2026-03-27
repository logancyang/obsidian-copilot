import { getDecryptedKey } from "@/encryptionService";
import { logInfo } from "@/logger";
import { MiyoClient } from "@/miyo/MiyoClient";
import { MiyoServiceDiscovery } from "@/miyo/MiyoServiceDiscovery";
import { getSettings } from "@/settings/model";
import { requestUrl } from "obsidian";

jest.mock("obsidian", () => ({
  requestUrl: jest.fn(),
}));

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(),
}));

jest.mock("@/encryptionService", () => ({
  getDecryptedKey: jest.fn(async (value: string) => value),
}));

const mockResolveBaseUrl = jest.fn();

jest.mock("@/miyo/MiyoServiceDiscovery", () => ({
  MiyoServiceDiscovery: {
    getInstance: jest.fn(() => ({
      resolveBaseUrl: (...args: unknown[]) => mockResolveBaseUrl(...args),
    })),
  },
}));

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

describe("MiyoClient", () => {
  const mockedRequestUrl = requestUrl as jest.MockedFunction<typeof requestUrl>;
  const mockedGetSettings = getSettings as jest.MockedFunction<typeof getSettings>;
  const mockedGetInstance = MiyoServiceDiscovery.getInstance as unknown as jest.Mock;
  const mockedLogInfo = logInfo as jest.MockedFunction<typeof logInfo>;
  const mockedGetDecryptedKey = getDecryptedKey as jest.MockedFunction<typeof getDecryptedKey>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetSettings.mockReturnValue({
      plusLicenseKey: "plus-test-license",
      debug: false,
    } as any);
    mockedGetDecryptedKey.mockResolvedValue("plus-test-license");
    mockResolveBaseUrl.mockResolvedValue("http://127.0.0.1:8742");
    mockedGetInstance.mockReturnValue({
      resolveBaseUrl: mockResolveBaseUrl,
    });
  });

  it("posts absolute path to /v0/parse-doc and returns parsed payload", async () => {
    mockedRequestUrl.mockResolvedValue({
      status: 200,
      json: {
        text: "parsed text",
        format: "pdf",
        source_path: "/tmp/sample.pdf",
        title: "Sample",
        page_count: 3,
      },
      text: "",
    } as any);

    const client = new MiyoClient();
    const result = await client.parseDoc("http://127.0.0.1:8742", "/tmp/sample.pdf");

    expect(result).toEqual({
      text: "parsed text",
      format: "pdf",
      source_path: "/tmp/sample.pdf",
      title: "Sample",
      page_count: 3,
    });
    expect(mockedRequestUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "http://127.0.0.1:8742/v0/parse-doc",
        method: "POST",
        headers: {
          Authorization: "Bearer plus-test-license",
        },
        contentType: "application/json",
        body: JSON.stringify({ path: "/tmp/sample.pdf" }),
      })
    );
    expect(mockedLogInfo).toHaveBeenCalledWith(
      "Miyo request:",
      expect.objectContaining({
        method: "POST",
        url: "http://127.0.0.1:8742/v0/parse-doc",
        hasAuthorizationHeader: true,
      })
    );
  });

  it("sends folder_path in /v0/search requests", async () => {
    mockedRequestUrl.mockResolvedValue({
      status: 200,
      json: { results: [] },
      text: "",
    } as any);

    const client = new MiyoClient();
    await client.search("http://127.0.0.1:8742", "/vault", "project notes", 10, [
      { field: "mtime", gte: 1, lte: 2 },
    ]);

    expect(mockedRequestUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "http://127.0.0.1:8742/v0/search",
        method: "POST",
        body: JSON.stringify({
          query: "project notes",
          folder_path: "/vault",
          limit: 10,
          filters: [{ field: "mtime", gte: 1, lte: 2 }],
        }),
      })
    );
  });

  it("requests folder scans through /v0/scan", async () => {
    mockedRequestUrl.mockResolvedValue({
      status: 202,
      json: { status: "started", path: "/vault" },
      text: "",
    } as any);

    const client = new MiyoClient();
    const result = await client.scanFolder("http://127.0.0.1:8742", "/vault", true);

    expect(result).toEqual({ status: "started", path: "/vault" });
    expect(mockedRequestUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "http://127.0.0.1:8742/v0/scan",
        method: "POST",
        body: JSON.stringify({ path: "/vault", force: true }),
      })
    );
  });

  it("lists indexed files from /v0/folder/files with folder_path query params", async () => {
    mockedRequestUrl.mockResolvedValue({
      status: 200,
      json: { files: [], total: 0 },
      text: "",
    } as any);

    const client = new MiyoClient();
    await client.listFolderFiles("http://127.0.0.1:8742", {
      folderPath: "/vault",
      offset: 10,
      limit: 25,
      orderBy: "mtime",
    });

    expect(mockedRequestUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "http://127.0.0.1:8742/v0/folder/files?folder_path=%2Fvault&offset=10&limit=25&order_by=mtime",
        method: "GET",
      })
    );
  });

  it("throws detailed errors when a request fails", async () => {
    mockedRequestUrl.mockResolvedValue({
      status: 404,
      text: "not found",
      json: { detail: "folder not registered" },
    } as any);

    const client = new MiyoClient();

    await expect(client.getFolder("http://127.0.0.1:8742", "/vault")).rejects.toThrow(
      "Miyo request failed with status 404: folder not registered"
    );
  });
});
