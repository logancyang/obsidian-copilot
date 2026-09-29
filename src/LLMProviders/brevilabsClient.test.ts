import type { CopilotSettings } from "@/settings/model";

const mockGetSettings = jest.fn<Partial<CopilotSettings>, []>();
jest.mock("@/settings/model", () => ({
  getSettings: () => mockGetSettings(),
}));

const mockApplyEntitlement = jest.fn<Promise<boolean>, [string]>();
const mockMarkPaidPendingEntitlement = jest.fn<void, []>();
const mockTurnOffPaid = jest.fn<void, [unknown?]>();
jest.mock("@/plusUtils", () => ({
  applyEntitlement: (token: string) => mockApplyEntitlement(token),
  markPaidPendingEntitlement: () => mockMarkPaidPendingEntitlement(),
  turnOffPaid: (app?: unknown) => mockTurnOffPaid(app),
}));

import { BrevilabsClient } from "@/LLMProviders/brevilabsClient";
import { BREVILABS_MODELS_BASE_URL } from "@/constants";

import * as obsidianModule from "obsidian";

const { __setRequestUrlImpl: setRequestUrlImpl } = obsidianModule as unknown as {
  __setRequestUrlImpl: (impl: unknown) => void;
};

interface RequestOutcome {
  data: unknown;
  error: Error | null;
  status?: number;
  detail?: { reason?: string; error?: string };
}

function stubRequest(outcome: RequestOutcome, onRequest?: () => void): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- reaching the private transport is the point
  (BrevilabsClient.getInstance() as any).makeRequest = async () => {
    onRequest?.();
    return { status: outcome.error ? 500 : 200, ...outcome };
  };
}

function licenseRejection(keyPrefix: string): RequestOutcome {
  const reason = `Invalid license key (prefix: ${keyPrefix}...)`;
  const error = new Error(reason);
  error.name = "FORBIDDEN";
  return { data: null, error, status: 403, detail: { reason, error: "FORBIDDEN" } };
}

const VALID_LICENSE_RESPONSE = { entitlement: "signed-token", plan: "supporter" };
const MANUAL_LICENSE_CHECK = { trigger: "manual" } as const;

describe("brevilabsClient", () => {
  describe("BrevilabsClient", () => {
    describe("getPluginVersionHeaders()", () => {
      it("exposes the plugin version as the shared client-version header", () => {
        const client = BrevilabsClient.getInstance();
        client.setPluginVersion("4.0.0-preview-260802");

        expect(client.getPluginVersionHeaders()).toEqual({
          "X-Client-Version": "4.0.0-preview-260802",
        });
      });
    });

    describe("validateLicenseKey()", () => {
      beforeEach(() => {
        jest.clearAllMocks();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors how stubRequest reaches it
        delete (BrevilabsClient.getInstance() as any).makeRequest;
        mockApplyEntitlement.mockResolvedValue(true);
        mockGetSettings.mockReturnValue({ plusLicenseKey: "key-A", userId: "user-1" });
      });

      it("revokes entitlement for the 403 body the license endpoint actually returns", async () => {
        setRequestUrlImpl(
          jest.fn().mockResolvedValue({
            status: 403,
            json: {
              detail: {
                status: 403,
                error: "FORBIDDEN",
                message: "NO_PERMISSION",
                reason: "Invalid license key (prefix: garbage-ke...)",
              },
            },
          })
        );

        const result = await BrevilabsClient.getInstance().validateLicenseKey(
          undefined,
          MANUAL_LICENSE_CHECK
        );

        expect(result).toEqual({ isValid: false });
        expect(mockTurnOffPaid).toHaveBeenCalled();
      });

      it("answers invalid without a request when no license key is stored (https://github.com/Brevilabs/obsidian-copilot-private/issues/307)", async () => {
        mockGetSettings.mockReturnValue({ plusLicenseKey: "" });
        const makeRequest = jest.fn();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- verifies the private HTTP boundary
        (BrevilabsClient.getInstance() as any).makeRequest = makeRequest;

        const result = await BrevilabsClient.getInstance().validateLicenseKey(
          undefined,
          MANUAL_LICENSE_CHECK
        );

        expect(result).toEqual({ isValid: false });
        expect(makeRequest).not.toHaveBeenCalled();
        expect(mockTurnOffPaid).not.toHaveBeenCalled();
      });

      it("applies the signed entitlement when the license key is unchanged", async () => {
        stubRequest({ data: VALID_LICENSE_RESPONSE, error: null });

        const result = await BrevilabsClient.getInstance().validateLicenseKey(
          undefined,
          MANUAL_LICENSE_CHECK
        );

        expect(result).toEqual({ isValid: true, plan: "supporter" });
        expect(mockApplyEntitlement).toHaveBeenCalledWith("signed-token");
        expect(mockMarkPaidPendingEntitlement).not.toHaveBeenCalled();
      });

      it("forwards the required trigger to the license endpoint", async () => {
        const makeRequest = jest.fn().mockResolvedValue({
          data: VALID_LICENSE_RESPONSE,
          error: null,
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- verifies the private HTTP boundary
        (BrevilabsClient.getInstance() as any).makeRequest = makeRequest;

        await BrevilabsClient.getInstance().validateLicenseKey(undefined, {
          trigger: "legacy_chat_turn",
        });

        expect(makeRequest).toHaveBeenCalledWith(
          "/license",
          {
            license_key: "key-A",
            trigger: "legacy_chat_turn",
          },
          "POST",
          true,
          true
        );
      });

      it("falls back to paid-pending when the server's token cannot be verified", async () => {
        mockApplyEntitlement.mockResolvedValue(false);
        stubRequest({ data: VALID_LICENSE_RESPONSE, error: null });

        const result = await BrevilabsClient.getInstance().validateLicenseKey(
          undefined,
          MANUAL_LICENSE_CHECK
        );

        expect(result).toEqual({ isValid: true, plan: "supporter" });
        expect(mockApplyEntitlement).toHaveBeenCalledWith("signed-token");
        expect(mockMarkPaidPendingEntitlement).toHaveBeenCalled();
      });

      it.each(["lite", "plus"])(
        "marks a tokenless %s license as paid pending entitlement",
        async (plan) => {
          stubRequest({ data: { plan }, error: null });

          const result = await BrevilabsClient.getInstance().validateLicenseKey(
            undefined,
            MANUAL_LICENSE_CHECK
          );

          expect(result).toEqual({ isValid: true, plan });
          expect(mockMarkPaidPendingEntitlement).toHaveBeenCalled();
          expect(mockApplyEntitlement).not.toHaveBeenCalled();
        }
      );

      it("revokes entitlement when the server answers 403, whatever the reason text says", async () => {
        stubRequest(licenseRejection("key-A-gar"));

        const result = await BrevilabsClient.getInstance().validateLicenseKey(
          undefined,
          MANUAL_LICENSE_CHECK
        );

        expect(result).toEqual({ isValid: false });
        expect(mockTurnOffPaid).toHaveBeenCalled();
      });

      it.each([
        ["a 502 from the gateway", 502],
        ["an unexplained 403 from infrastructure", 403],
      ])("leaves the entitlement alone for %s", async (_label, status) => {
        stubRequest({ data: null, error: new Error(`HTTP error: ${status}`), status });

        const result = await BrevilabsClient.getInstance().validateLicenseKey(
          undefined,
          MANUAL_LICENSE_CHECK
        );

        expect(result).toEqual({ isValid: undefined });
        expect(mockTurnOffPaid).not.toHaveBeenCalled();
      });

      it("discards a success that arrives after the license key changed", async () => {
        stubRequest({ data: VALID_LICENSE_RESPONSE, error: null }, () => {
          mockGetSettings.mockReturnValue({ plusLicenseKey: "key-B" });
        });

        const result = await BrevilabsClient.getInstance().validateLicenseKey(
          undefined,
          MANUAL_LICENSE_CHECK
        );

        expect(result).toEqual({ isValid: undefined });
        expect(mockApplyEntitlement).not.toHaveBeenCalled();
        expect(mockMarkPaidPendingEntitlement).not.toHaveBeenCalled();
      });

      it("discards a rejection that arrives after the license key changed", async () => {
        stubRequest(licenseRejection("key-A-gar"), () => {
          mockGetSettings.mockReturnValue({ plusLicenseKey: "key-B" });
        });

        const result = await BrevilabsClient.getInstance().validateLicenseKey(
          undefined,
          MANUAL_LICENSE_CHECK
        );

        expect(result).toEqual({ isValid: undefined });
        expect(mockTurnOffPaid).not.toHaveBeenCalled();
      });
    });

    describe("getUsage()", () => {
      const requestUrlMock = jest.fn();
      beforeEach(() => {
        jest.clearAllMocks();
        mockGetSettings.mockReturnValue({ plusLicenseKey: "key-A" });
        setRequestUrlImpl(requestUrlMock);
      });

      it("reads the usage endpoint on the MODELS host with the license key as bearer auth", async () => {
        requestUrlMock.mockResolvedValue({
          status: 200,
          json: { used: { weekly: { usedPercent: 21 } } },
        });

        const usage = await BrevilabsClient.getInstance().getUsage();

        expect(usage).toEqual({ used: { weekly: { usedPercent: 21 } } });
        const call = requestUrlMock.mock.calls[0][0] as {
          url: string;
          method: string;
          headers: Record<string, string>;
        };
        expect(call.url).toBe(`${BREVILABS_MODELS_BASE_URL}/usage`);
        expect(call.method).toBe("GET");
        expect(call.headers.Authorization).toBe("Bearer key-A");
      });

      it("answers null without a request when there is no license key", async () => {
        mockGetSettings.mockReturnValue({ plusLicenseKey: "" });

        await expect(BrevilabsClient.getInstance().getUsage()).resolves.toBeNull();
        expect(requestUrlMock).not.toHaveBeenCalled();
      });

      it.each([
        ["a non-200 response", () => requestUrlMock.mockResolvedValue({ status: 503 })],
        ["a thrown request", () => requestUrlMock.mockRejectedValue(new Error("offline"))],
      ])("answers null for %s rather than throwing", async (_label, arrange) => {
        arrange();

        await expect(BrevilabsClient.getInstance().getUsage()).resolves.toBeNull();
      });
    });

    describe("getModels()", () => {
      const requestUrlMock = jest.fn();
      beforeEach(() => {
        jest.clearAllMocks();
        setRequestUrlImpl(requestUrlMock);
      });

      it("reads the public catalog from the MODELS host without authorization", async () => {
        requestUrlMock.mockResolvedValue({
          status: 200,
          json: { data: [{ id: "gemini-3-pro", context_length: "1M" }] },
        });

        const models = await BrevilabsClient.getInstance().getModels();

        expect(models).toEqual({ data: [{ id: "gemini-3-pro", context_length: "1M" }] });
        const call = requestUrlMock.mock.calls[0][0] as { url: string; headers: object };
        expect(call.url).toBe(`${BREVILABS_MODELS_BASE_URL}/models`);
        expect(call.headers).not.toHaveProperty("Authorization");
      });

      it.each([
        ["a non-200 response", () => requestUrlMock.mockResolvedValue({ status: 500 })],
        ["a thrown request", () => requestUrlMock.mockRejectedValue(new Error("offline"))],
      ])("answers null for %s rather than throwing", async (_label, arrange) => {
        arrange();

        await expect(BrevilabsClient.getInstance().getModels()).resolves.toBeNull();
      });
    });
  });
});
