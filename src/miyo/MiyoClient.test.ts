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

describe("MiyoClient.parseDoc", () => {
  const mockedRequestUrl = requestUrl as jest.MockedFunction<typeof requestUrl>;
  const mockedGetSettings = getSettings as jest.MockedFunction<typeof getSettings>;
  const mockedGetInstance = MiyoServiceDiscovery.getInstance as unknown as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetSettings.mockReturnValue({
      selfHostApiKey: "",
      debug: false,
    } as any);
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
        contentType: "application/json",
        body: JSON.stringify({ path: "/tmp/sample.pdf" }),
      })
    );
  });

  it("throws when /v0/parse-doc returns an error status", async () => {
    mockedRequestUrl.mockResolvedValue({
      status: 500,
      text: "internal server error",
      json: { detail: "fail" },
    } as any);

    const client = new MiyoClient();

    await expect(client.parseDoc("http://127.0.0.1:8742", "/tmp/sample.pdf")).rejects.toThrow(
      "Miyo request failed with status 500"
    );
  });
});
