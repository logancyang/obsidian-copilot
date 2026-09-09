import { logInfo, logError } from "@/logger";
import { MiyoClient, MiyoRequestError } from "@/miyo/MiyoClient";
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

  describe("MiyoRequestError", () => {
    describe("constructor()", () => {
      it("preserves the Miyo status and detail without changing the request message (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", () => {
        const error = new MiyoRequestError(404, "folder not registered");
        const errorWithoutDetail = new MiyoRequestError(503, "");
        const unsupportedEndpoint = new MiyoRequestError(
          501,
          '{"error":"not_implemented"}',
          "not_implemented"
        );

        expect(error).toBeInstanceOf(Error);
        expect(error).toMatchObject({
          name: "MiyoRequestError",
          status: 404,
          detail: "folder not registered",
          message: "Miyo request failed with status 404: folder not registered",
        });
        expect(errorWithoutDetail.message).toBe("Miyo request failed with status 503");
        expect(unsupportedEndpoint.errorCode).toBe("not_implemented");
      });
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

  describe("recommend()", () => {
    it("sends the agreed contract without logging conversation text even with debug enabled (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", async () => {
      mockedGetSettings.mockReturnValue({ plusLicenseKey: "key", debug: true } as CopilotSettings);
      const response = {
        status: "ok",
        results: [],
        count: 0,
        skipped_files: [],
        context_truncated: true,
        execution_time_ms: 420,
      };
      mockedRequestUrl.mockResolvedValue({ status: 200, json: response } as RequestUrlResponse);
      const request = {
        folder_name: "Vault",
        messages: [{ role: "user" as const, content: "private conversation" }],
        draft: "private draft",
        excerpts: ["private excerpt"],
        file_paths: ["Vault/file.md"],
      };
      expect(await new MiyoClient().recommend("http://localhost:8742", request)).toEqual(response);
      expect(mockedRequestUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "http://localhost:8742/v0/recommend",
          body: JSON.stringify(request),
        })
      );
      expect(JSON.stringify(mockedLogInfo.mock.calls)).not.toContain("private");
    });
    it("redacts malformed response parse errors (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", async () => {
      mockedGetSettings.mockReturnValue({ plusLicenseKey: "key", debug: true } as CopilotSettings);
      mockedRequestUrl.mockResolvedValue({
        status: 400,
        json: "private echoed draft",
      } as RequestUrlResponse);
      await expect(
        new MiyoClient().recommend("http://localhost:8742", {
          folder_name: "Vault",
          draft: "private echoed draft",
        })
      ).rejects.toBeInstanceOf(MiyoRequestError);
      expect(JSON.stringify((logError as jest.Mock).mock.calls)).not.toContain(
        "private echoed draft"
      );
    });
    it("retains error codes without retaining a server echo (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", async () => {
      mockedRequestUrl.mockResolvedValue({
        status: 400,
        json: { code: "empty_context", detail: "private draft" },
      } as RequestUrlResponse);
      await expect(
        new MiyoClient().recommend("http://localhost:8742", { folder_name: "Vault" })
      ).rejects.toMatchObject({
        status: 400,
        errorCode: "empty_context",
        message: expect.not.stringContaining("private draft") as unknown,
      });
    });
    it.each([true, false])(
      "confirms a gateway 404 against Miyo health before classifying support: %s (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)",
      async (healthy) => {
        mockedRequestUrl
          .mockResolvedValueOnce({ status: 404, json: {} } as RequestUrlResponse)
          .mockResolvedValueOnce({
            status: healthy ? 200 : 503,
            json: healthy ? { status: "ok" } : {},
          } as RequestUrlResponse);
        await expect(
          new MiyoClient().recommend("http://localhost:8742", {
            folder_name: "Vault",
            draft: "topic",
          })
        ).rejects.toMatchObject(
          healthy ? { status: 501, errorCode: "not_implemented" } : { status: 404 }
        );
        expect(mockedRequestUrl).toHaveBeenCalledTimes(2);
        expect(mockedRequestUrl).toHaveBeenNthCalledWith(
          2,
          expect.objectContaining({ url: "http://127.0.0.1:8742/v0/health" })
        );
      }
    );
  });

  describe("searchRelated()", () => {
    const baseUrl = "http://localhost:8742";
    const response = {
      status: "ok",
      results: [{ path: "Vault/answer.md", score: 0.8 }],
      count: 1,
      skipped_files: [],
      context_truncated: false,
      execution_time_ms: 1,
    };
    it("uses one file reference and preserves server results (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", async () => {
      mockedRequestUrl.mockResolvedValue({ status: 200, json: response } as RequestUrlResponse);
      expect(
        await new MiyoClient().searchRelated(baseUrl, "Vault/seed.md", {
          folderName: "Vault",
          limit: 20,
        })
      ).toEqual(response);
      expect(mockedRequestUrl).toHaveBeenCalledTimes(1);
      expect(mockedRequestUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          url: `${baseUrl}/v0/recommend`,
          body: JSON.stringify({ folder_name: "Vault", file_paths: ["Vault/seed.md"], limit: 20 }),
        })
      );
    });
    it("falls back on an old service's structured 501 (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", async () => {
      mockedRequestUrl
        .mockResolvedValueOnce({
          status: 501,
          json: { error: "not_implemented" },
        } as RequestUrlResponse)
        .mockResolvedValueOnce({
          status: 200,
          json: { results: response.results },
        } as RequestUrlResponse);
      expect(
        await new MiyoClient().searchRelated(baseUrl, "Vault/seed.md", {
          folderName: "Vault",
          limit: 20,
        })
      ).toEqual({ results: response.results });
      expect(mockedRequestUrl).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          url: `${baseUrl}/v0/search/related`,
          body: JSON.stringify({ file_path: "Vault/seed.md", folder_name: "Vault", limit: 20 }),
        })
      );
    });
    it("preserves folderless legacy calls (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", async () => {
      mockedRequestUrl.mockResolvedValue({
        status: 200,
        json: { results: [] },
      } as RequestUrlResponse);
      await new MiyoClient().searchRelated(baseUrl, "Vault/seed.md");
      expect(mockedRequestUrl).toHaveBeenCalledWith(
        expect.objectContaining({ url: `${baseUrl}/v0/search/related` })
      );
    });
    it("keeps source classification without legacy retrieval for skipped context (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", async () => {
      mockedRequestUrl.mockResolvedValue({
        status: 200,
        json: { ...response, status: "no_usable_context", results: [] },
      } as RequestUrlResponse);
      await expect(
        new MiyoClient().searchRelated(baseUrl, "Vault/seed.md", { folderName: "Vault" })
      ).rejects.toMatchObject({ status: 404 });
      expect(mockedRequestUrl).toHaveBeenCalledTimes(1);
    });
    it.each([400, 401, 403, 413, 500, 501, 503])(
      "does not fall back on HTTP %s without unsupported-route proof (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)",
      async (status) => {
        mockedRequestUrl.mockResolvedValue({
          status,
          json: { code: "failure" },
        } as RequestUrlResponse);
        await expect(
          new MiyoClient().searchRelated(baseUrl, "Vault/seed.md", { folderName: "Vault" })
        ).rejects.toMatchObject({ status });
        expect(mockedRequestUrl).toHaveBeenCalledTimes(1);
      }
    );
    it("does not fall back on empty results or a transport failure (https://github.com/Brevilabs/obsidian-copilot-private/issues/383)", async () => {
      mockedRequestUrl.mockResolvedValueOnce({
        status: 200,
        json: { ...response, results: [], count: 0 },
      } as RequestUrlResponse);
      expect(
        (await new MiyoClient().searchRelated(baseUrl, "Vault/seed.md", { folderName: "Vault" }))
          .results
      ).toEqual([]);
      mockedRequestUrl.mockRejectedValueOnce(new Error("offline"));
      await expect(
        new MiyoClient().searchRelated(baseUrl, "Vault/seed.md", { folderName: "Vault" })
      ).rejects.toThrow("offline");
      expect(mockedRequestUrl).toHaveBeenCalledTimes(2);
    });
  });

  describe("fileStatus()", () => {
    it("gets one file status using Miyo's encoded public path (https://github.com/Brevilabs/miyo/issues/543)", async () => {
      mockedRequestUrl.mockResolvedValue({
        status: 200,
        json: {
          status: "excluded",
          reason: "exclude_pattern",
          rule: "daily notes/**",
        },
        text: "",
      } as RequestUrlResponse);

      const result = await new MiyoClient().fileStatus(
        "http://127.0.0.1:8742",
        "Work Vault/daily notes/Today.md"
      );

      expect(result).toEqual({
        status: "excluded",
        reason: "exclude_pattern",
        rule: "daily notes/**",
      });
      expect(mockedRequestUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "http://127.0.0.1:8742/v0/folder/file-status?file_path=Work+Vault%2Fdaily+notes%2FToday.md",
          method: "GET",
          throw: false,
        })
      );
    });

    it("preserves the old-build error code as structured data (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", async () => {
      mockedRequestUrl.mockResolvedValue({
        status: 501,
        json: { error: "not_implemented" },
        text: '{"error":"not_implemented"}',
      } as RequestUrlResponse);

      await expect(
        new MiyoClient().fileStatus("http://127.0.0.1:8742", "vault/source.md")
      ).rejects.toMatchObject({
        status: 501,
        errorCode: "not_implemented",
      });
    });
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

    it("refuses addFolder after the URL and credentials resolve, so nothing is sent (https://github.com/Brevilabs/obsidian-copilot-private/issues/284)", async () => {
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
