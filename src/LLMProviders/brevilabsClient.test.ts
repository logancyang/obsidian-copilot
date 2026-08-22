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

/** The obsidian mock's seam for stubbing `requestUrl` per test. */
const { __setRequestUrlImpl: setRequestUrlImpl } = obsidianModule as unknown as {
  __setRequestUrlImpl: (impl: unknown) => void;
};

interface RequestOutcome {
  data: unknown;
  error: Error | null;
  status?: number;
}

/**
 * Stub the private HTTP layer so the test drives `validateLicenseKey`'s
 * response handling without touching the network. `onRequest` runs at the
 * moment the request is in flight, which is where a concurrent key change has
 * to be injected to reproduce the overlap.
 */
function stubRequest(outcome: RequestOutcome, onRequest?: () => void): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- reaching the private transport is the point
  (BrevilabsClient.getInstance() as any).makeRequest = async () => {
    onRequest?.();
    return { status: outcome.error ? 500 : 200, ...outcome };
  };
}

/**
 * How `/license` refuses a key: HTTP 403, with a reason that names the key's
 * prefix so support can tell which key was tried.
 */
function licenseRejection(keyPrefix: string): RequestOutcome {
  const error = new Error(`Invalid license key (prefix: ${keyPrefix}...)`);
  error.name = "FORBIDDEN";
  return { data: null, error, status: 403 };
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
        // `stubRequest` installs an own property over the prototype method;
        // dropping it puts the real transport back for the tests that need it.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors how stubRequest reaches it
        delete (BrevilabsClient.getInstance() as any).makeRequest;
        mockApplyEntitlement.mockResolvedValue(true);
        mockGetSettings.mockReturnValue({ plusLicenseKey: "key-A", userId: "user-1" });
      });

      // Drives the real transport, because the defect lived in the seam between
      // the HTTP layer and this method: the layer discarded the status, leaving
      // the reason text — which names the rejected key's prefix — as the only
      // thing left to classify on.
      // https://github.com/logancyang/obsidian-copilot-preview/issues/352
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

      // The rejection is recognised by its 403, not by its reason text: the
      // server names the rejected key's prefix in that text, so an exact-string
      // match silently reclassified every refusal as an unreachable server and
      // left the previous key's entitlement in force.
      // https://github.com/logancyang/obsidian-copilot-preview/issues/352
      it("revokes entitlement when the server answers 403, whatever the reason text says", async () => {
        stubRequest(licenseRejection("key-A-gar"));

        const result = await BrevilabsClient.getInstance().validateLicenseKey(
          undefined,
          MANUAL_LICENSE_CHECK
        );

        expect(result).toEqual({ isValid: false });
        expect(mockTurnOffPaid).toHaveBeenCalled();
      });

      it("leaves the entitlement alone when the server fails for a reason other than refusing the key", async () => {
        stubRequest({ data: null, error: new Error("HTTP error: 502"), status: 502 });

        const result = await BrevilabsClient.getInstance().validateLicenseKey(
          undefined,
          MANUAL_LICENSE_CHECK
        );

        expect(result).toEqual({ isValid: undefined });
        expect(mockTurnOffPaid).not.toHaveBeenCalled();
      });

      it("discards a success that arrives after the license key changed", async () => {
        // An eligible key's slow response landing after the user switched to a
        // different key would otherwise re-grant that key's features — and
        // re-persist its token — for the rest of the token's lifetime.
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
        // The mirror case: a stale rejection must not revoke the entitlement
        // the user's newly entered key just earned.
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
        // The caps are enforced by the model proxy, so their read side lives beside
        // them; api.brevilabs.com has no such route and answers 404.
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
        // This feeds a meter; a meter that cannot be drawn is not an error worth
        // interrupting anyone over.
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
