import { logInfo } from "@/logger";
import { MiyoClient } from "@/miyo/MiyoClient";
import { MiyoServiceDiscovery } from "@/miyo/MiyoServiceDiscovery";
import { getSettings } from "@/settings/model";
import { requestUrl, type RequestUrlResponse } from "obsidian";
import type { CopilotSettings } from "@/settings/model";

jest.mock("obsidian", () => ({
  requestUrl: jest.fn(),
}));

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(),
}));

const mockResolveBaseUrl = jest.fn();

jest.mock("@/miyo/MiyoServiceDiscovery", () => ({
  MiyoServiceDiscovery: {
    getInstance: jest.fn(() => ({
      resolveBaseUrl: (...args: unknown[]): unknown => mockResolveBaseUrl(...args),
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

  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetSettings.mockReturnValue({
      plusLicenseKey: "plus-test-license",
      debug: false,
    } as CopilotSettings);
    mockResolveBaseUrl.mockResolvedValue("http://127.0.0.1:8742");
    mockedGetInstance.mockReturnValue({
      resolveBaseUrl: mockResolveBaseUrl,
    });
  });

  it("posts vault-relative path to /v0/parse-doc and returns parsed payload", async () => {
    mockedRequestUrl.mockResolvedValue({
      status: 200,
      json: {
        text: "parsed text",
        format: "pdf",
        source_path: "docs/sample.pdf",
        title: "Sample",
        page_count: 3,
      },
      text: "",
    } as RequestUrlResponse);

    const client = new MiyoClient();
    const result = await client.parseDoc("http://127.0.0.1:8742", "TestVault", "docs/sample.pdf");

    expect(result).toEqual({
      text: "parsed text",
      format: "pdf",
      source_path: "docs/sample.pdf",
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
        body: JSON.stringify({ folder_name: "TestVault", path: "docs/sample.pdf" }),
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

  it("sends folder_name in /v0/search requests", async () => {
    mockedRequestUrl.mockResolvedValue({
      status: 200,
      json: { results: [] },
      text: "",
    } as RequestUrlResponse);

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
          folder_name: "/vault",
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
    } as RequestUrlResponse);

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

  it("lists indexed files from /v0/folder/files with folder_name query params", async () => {
    mockedRequestUrl.mockResolvedValue({
      status: 200,
      json: { files: [], total: 0 },
      text: "",
    } as RequestUrlResponse);

    const client = new MiyoClient();
    await client.listFolderFiles("http://127.0.0.1:8742", {
      folderName: "/vault",
      offset: 10,
      limit: 25,
      orderBy: "mtime",
    });

    expect(mockedRequestUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "http://127.0.0.1:8742/v0/folder/files?folder_name=%2Fvault&offset=10&limit=25&order_by=mtime",
        method: "GET",
      })
    );
  });

  it("throws detailed errors when a request fails", async () => {
    mockedRequestUrl.mockResolvedValue({
      status: 404,
      text: "not found",
      json: { detail: "folder not registered" },
    } as RequestUrlResponse);

    const client = new MiyoClient();

    await expect(client.getFolder("http://127.0.0.1:8742", "/vault")).rejects.toThrow(
      "Miyo request failed with status 404: folder not registered"
    );
  });

  describe("checkFolderRegistration", () => {
    it("returns 'registered' on HTTP 200 and queries /v0/folder with the folder path", async () => {
      mockedRequestUrl.mockResolvedValue({
        status: 200,
        json: { path: "MyVault" },
        text: "",
      } as RequestUrlResponse);

      const client = new MiyoClient();
      const result = await client.checkFolderRegistration("MyVault");

      expect(result).toBe("registered");
      expect(mockedRequestUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "http://127.0.0.1:8742/v0/folder?path=MyVault",
          method: "GET",
          throw: false,
        })
      );
    });

    it("returns 'unregistered' on HTTP 404", async () => {
      mockedRequestUrl.mockResolvedValue({
        status: 404,
        json: { detail: "folder not registered" },
        text: "",
      } as RequestUrlResponse);

      const client = new MiyoClient();
      await expect(client.checkFolderRegistration("MyVault")).resolves.toBe("unregistered");
    });

    it("returns 'error' on a 5xx status (not misread as unregistered)", async () => {
      mockedRequestUrl.mockResolvedValue({
        status: 500,
        json: {},
        text: "",
      } as RequestUrlResponse);

      const client = new MiyoClient();
      await expect(client.checkFolderRegistration("MyVault")).resolves.toBe("error");
    });

    it("returns 'error' when the request throws (network failure)", async () => {
      mockedRequestUrl.mockRejectedValue(new Error("network down"));

      const client = new MiyoClient();
      await expect(client.checkFolderRegistration("MyVault")).resolves.toBe("error");
    });

    it("returns 'error' when the base URL can't be resolved", async () => {
      mockResolveBaseUrl.mockResolvedValue(null);

      const client = new MiyoClient();
      await expect(client.checkFolderRegistration("MyVault")).resolves.toBe("error");
      expect(mockedRequestUrl).not.toHaveBeenCalled();
    });

    it("honors an explicit override URL", async () => {
      mockedRequestUrl.mockResolvedValue({
        status: 200,
        json: { path: "MyVault" },
        text: "",
      } as RequestUrlResponse);

      const client = new MiyoClient();
      await client.checkFolderRegistration("MyVault", "http://192.168.1.10:8742");

      expect(mockResolveBaseUrl).toHaveBeenCalledWith({ overrideUrl: "http://192.168.1.10:8742" });
    });
  });

  describe("constructor", () => {
    it("authenticates with the snapshot it was given, not whatever settings hold later", async () => {
      // A queued Miyo mutation can outlive the vault that started it. Reading
      // the key per request would then send the newly-opened vault's credential
      // to the outgoing vault's endpoint, so callers whose work spans that
      // boundary capture the key up front.
      mockedRequestUrl.mockResolvedValue({
        status: 201,
        json: { path: "/Users/me/vault" },
        text: "",
      } as RequestUrlResponse);
      const client = new MiyoClient({ plusLicenseKey: "key-of-the-vault-that-asked" });

      // The vault switches while the mutation is queued.
      mockedGetSettings.mockReturnValue({
        plusLicenseKey: "key-of-a-different-vault",
        debug: false,
      } as CopilotSettings);
      await client.addFolder({ path: "/Users/me/vault" });

      expect(mockedRequestUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: { Authorization: "Bearer key-of-the-vault-that-asked" },
        })
      );
    });

    it("reads the live key when given no snapshot, as short-lived callers expect", async () => {
      mockedRequestUrl.mockResolvedValue({
        status: 201,
        json: { path: "/Users/me/vault" },
        text: "",
      } as RequestUrlResponse);
      await new MiyoClient().addFolder({ path: "/Users/me/vault" });

      expect(mockedRequestUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: { Authorization: "Bearer plus-test-license" },
        })
      );
    });
  });

  describe("addFolder", () => {
    it("POSTs the request to /v0/folder and returns the created record on 201", async () => {
      const folderRecord = { path: "/Users/me/vault", exclude_folders: ["copilot"] };
      mockedRequestUrl.mockResolvedValue({
        status: 201,
        json: folderRecord,
        text: "",
      } as RequestUrlResponse);

      const client = new MiyoClient();
      const result = await client.addFolder({
        path: "/Users/me/vault",
        exclude_folders: ["copilot"],
      });

      expect(result).toEqual(folderRecord);
      expect(mockedRequestUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "http://127.0.0.1:8742/v0/folder",
          method: "POST",
          contentType: "application/json",
          body: JSON.stringify({ path: "/Users/me/vault", exclude_folders: ["copilot"] }),
          throw: false,
        })
      );
    });

    it("treats 409 already-registered as success and returns null", async () => {
      mockedRequestUrl.mockResolvedValue({
        status: 409,
        json: { detail: "folder already registered" },
        text: "",
      } as RequestUrlResponse);

      const client = new MiyoClient();
      await expect(client.addFolder({ path: "/Users/me/vault" })).resolves.toBeNull();
    });

    it("throws a detailed validation error on 400", async () => {
      mockedRequestUrl.mockResolvedValue({
        status: 400,
        json: { detail: "path must be absolute" },
        text: "",
      } as RequestUrlResponse);

      const client = new MiyoClient();
      await expect(client.addFolder({ path: "relative/path" })).rejects.toThrow(
        "Miyo add-folder failed with status 400: path must be absolute"
      );
    });

    it("throws when the request fails at the network level", async () => {
      mockedRequestUrl.mockRejectedValue(new Error("network down"));

      const client = new MiyoClient();
      await expect(client.addFolder({ path: "/Users/me/vault" })).rejects.toThrow("network down");
    });

    it("honors an explicit override URL", async () => {
      mockedRequestUrl.mockResolvedValue({
        status: 201,
        json: { path: "/Users/me/vault" },
        text: "",
      } as RequestUrlResponse);

      const client = new MiyoClient();
      await client.addFolder({ path: "/Users/me/vault" }, "http://127.0.0.1:9999");

      expect(mockResolveBaseUrl).toHaveBeenCalledWith({ overrideUrl: "http://127.0.0.1:9999" });
    });

    it("refuses addFolder after the URL and credentials resolve, so nothing is sent", async () => {
      // The caller's own check runs before this method; URL resolution is
      // asynchronous, so only a hook here can stop a request whose caller went
      // stale in between.
      mockedRequestUrl.mockResolvedValue({
        status: 201,
        json: { path: "/Users/me/vault" },
        text: "",
      } as RequestUrlResponse);
      const client = new MiyoClient();

      await expect(
        client.addFolder({ path: "/Users/me/vault" }, undefined, () => {
          throw new Error("lifecycle expired");
        })
      ).rejects.toThrow("lifecycle expired");

      expect(mockResolveBaseUrl).toHaveBeenCalled();
      expect(mockedRequestUrl).not.toHaveBeenCalled();
    });
  });

  describe("deleteFolder", () => {
    it("DELETEs /v0/folder with the folder name in the JSON body", async () => {
      mockedRequestUrl.mockResolvedValue({
        status: 200,
        json: { deleted: true },
        text: "",
      } as RequestUrlResponse);

      const client = new MiyoClient();
      await client.deleteFolder("my-vault");

      expect(mockedRequestUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "http://127.0.0.1:8742/v0/folder",
          method: "DELETE",
          contentType: "application/json",
          body: JSON.stringify({ path: "my-vault" }),
          throw: false,
        })
      );
    });

    it("treats 404 not-registered as success", async () => {
      // The caller's goal — no registration under that name — already holds
      // (e.g. a prior resync deleted it but never got to re-add).
      mockedRequestUrl.mockResolvedValue({
        status: 404,
        json: { detail: "Folder not registered: my-vault" },
        text: "",
      } as RequestUrlResponse);

      const client = new MiyoClient();
      await expect(client.deleteFolder("my-vault")).resolves.toBeUndefined();
    });

    it("throws a detailed error on other failures", async () => {
      mockedRequestUrl.mockResolvedValue({
        status: 500,
        json: { detail: "boom" },
        text: "",
      } as RequestUrlResponse);

      const client = new MiyoClient();
      await expect(client.deleteFolder("my-vault")).rejects.toThrow(
        "Miyo delete-folder failed with status 500: boom"
      );
    });

    it("refuses deleteFolder after the URL and credentials resolve, so nothing is sent", async () => {
      mockedRequestUrl.mockResolvedValue({
        status: 200,
        json: { deleted: true },
        text: "",
      } as RequestUrlResponse);
      const client = new MiyoClient();

      await expect(
        client.deleteFolder("my-vault", undefined, () => {
          throw new Error("lifecycle expired");
        })
      ).rejects.toThrow("lifecycle expired");

      expect(mockResolveBaseUrl).toHaveBeenCalled();
      expect(mockedRequestUrl).not.toHaveBeenCalled();
    });

    it("sends the request when the hook is absent or returns", async () => {
      mockedRequestUrl.mockResolvedValue({
        status: 200,
        json: { deleted: true },
        text: "",
      } as RequestUrlResponse);
      const client = new MiyoClient();
      const hook = jest.fn();

      await client.deleteFolder("my-vault", undefined, hook);

      expect(hook).toHaveBeenCalledTimes(1);
      expect(mockedRequestUrl).toHaveBeenCalledTimes(1);
    });
  });

  describe("fetchHealth()", () => {
    it("resolves null once the probe timeout elapses when the request never responds", async () => {
      jest.useFakeTimers();
      try {
        // A connection that opens but never sends a response: requestUrl (which
        // ignores abort) stays pending forever, so only the timeout can settle it.
        mockedRequestUrl.mockReturnValue(new Promise<never>(() => {}) as never);

        const client = new MiyoClient();
        const resultPromise = client.fetchHealth("http://127.0.0.1:8742");

        // Advance past the 8s health bound; the timeout must resolve the probe to
        // null instead of leaving it pending (which would wedge the status store's
        // single-flight refresh forever).
        await jest.advanceTimersByTimeAsync(8001);

        await expect(resultPromise).resolves.toBeNull();
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
