import { BREVILABS_API_BASE_URL } from "@/constants";
import { logError } from "@/logger";
import { createReportUploader, type ReportRequest } from "@/utils/reportUpload.brevilabs";
import { ReportUploadError, type ReportUploadAttempt } from "@/utils/reportUpload";

jest.mock("@/logger");

/** A request that always answers with the given status and body. */
function respondWith(status: number, body: unknown): jest.MockedFunction<ReportRequest> {
  return jest
    .fn<ReturnType<ReportRequest>, Parameters<ReportRequest>>()
    .mockResolvedValue({ status, text: typeof body === "string" ? body : JSON.stringify(body) });
}

const ZIP_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]);

const ATTEMPT: ReportUploadAttempt = {
  body: ZIP_BYTES.buffer.slice(0),
  idempotencyKey: "5d41c9b2-7e3a-4f8b-9c1d-2a6e8f4b0d37",
};

const OK_BODY = {
  reportId: "9f3c1a7b2e4d5f60819a2b3c4d5e6f70",
  received: true,
  expiresAt: "2026-10-18T00:00:00.000Z",
};

function makeUploader(request: ReportRequest, deps: { installId?: () => string } = {}) {
  return createReportUploader({
    installId: deps.installId ?? (() => "3f2a1d9e-8b4c-4f6d-9e2a-7c5b3a1d9e8f"),
    clientVersion: "4.1.0",
    request,
  });
}

/** The rejection, typed — `rejects.toThrow` cannot see `retryable`. */
async function rejection(promise: Promise<unknown>): Promise<ReportUploadError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof ReportUploadError) return err;
    throw new Error(`expected ReportUploadError, got: ${String(err)}`);
  }
  throw new Error("expected the upload to reject");
}

describe("reportUpload.brevilabs", () => {
  describe("createReportUploader()", () => {
    it("posts the attempt's bytes to the reports endpoint with exactly the contract's headers", async () => {
      const request = respondWith(201, OK_BODY);

      await makeUploader(request)(ATTEMPT);

      const sent = request.mock.calls[0][0];
      expect(sent.url).toBe(`${BREVILABS_API_BASE_URL}/reports`);
      expect(sent.method).toBe("POST");
      // `toEqual`, not `toMatchObject`: the four headers are the request's
      // entire identity — an Authorization header, a user id, or a
      // Content-Encoding sneaking in is exactly what this pins against.
      expect(sent.headers).toEqual({
        "Content-Type": "application/zip",
        "X-Copilot-Install-ID": "3f2a1d9e-8b4c-4f6d-9e2a-7c5b3a1d9e8f",
        "Idempotency-Key": "5d41c9b2-7e3a-4f8b-9c1d-2a6e8f4b0d37",
        "X-Client-Version": "4.1.0",
      });
      expect(new Uint8Array(sent.body)).toEqual(ZIP_BYTES);
    });

    it("returns the report id and expiry the server confirmed", async () => {
      await expect(makeUploader(respondWith(200, OK_BODY))(ATTEMPT)).resolves.toEqual({
        reportId: "9f3c1a7b2e4d5f60819a2b3c4d5e6f70",
        expiresAt: "2026-10-18T00:00:00.000Z",
      });
    });

    it("tolerates extra response fields, so the server can add fields without breaking clients", async () => {
      const body = { ...OK_BODY, storageRegion: "auto", schemaVersion: 2 };
      await expect(makeUploader(respondWith(200, body))(ATTEMPT)).resolves.toEqual({
        reportId: OK_BODY.reportId,
        expiresAt: OK_BODY.expiresAt,
      });
    });

    describe("local pre-send refusals", () => {
      it("refuses to upload when the install id cannot be resolved, with fixed copy only", async () => {
        // The getter's own message never reaches the user: it can carry
        // whatever storage or the uuid library threw, environment paths
        // included, and this error lands in a Notice and the chat log.
        const request = respondWith(200, OK_BODY);
        const upload = makeUploader(request, {
          installId: () => {
            throw new Error("SecurityError: /Users/alice/profile is locked");
          },
        });

        const err = await rejection(upload(ATTEMPT));

        expect(err.retryable).toBe(false);
        expect(err.message).toMatch(/nothing was uploaded/);
        expect(err.message).not.toContain("alice");
        // Refused locally — the server must not be reached, or the failed
        // request would still spend a slot of the upload allowance.
        expect(request).not.toHaveBeenCalled();
      });

      it.each([
        ["the literal unknown sentinel", "unknown"],
        ["an empty string", ""],
        ["a value the server's pattern rejects", "4.1.0 beta!"],
      ])("refuses to upload when the client version is %s", async (_label, clientVersion) => {
        const request = respondWith(200, OK_BODY);
        const upload = createReportUploader({
          installId: () => "3f2a1d9e-8b4c-4f6d-9e2a-7c5b3a1d9e8f",
          clientVersion,
          request,
        });

        const err = await rejection(upload(ATTEMPT));

        expect(err.retryable).toBe(false);
        expect(request).not.toHaveBeenCalled();
      });
    });

    describe("definitive server rejections — not retryable", () => {
      it.each([400, 413, 415, 422, 429, 404])(
        "classifies HTTP %i as not retryable, so the UI withholds Retry",
        async (status) => {
          const err = await rejection(makeUploader(respondWith(status, "nope"))(ATTEMPT));
          expect(err.retryable).toBe(false);
        }
      );

      it("names the upload allowance on 429 without promising a number or a reset time", async () => {
        const err = await rejection(makeUploader(respondWith(429, "slow down"))(ATTEMPT));
        expect(err.message).toMatch(/allowance is used up/);
        // The tripped limit is unknowable from the response: the server enforces
        // one per installation and one per address, and says which only by
        // refusing.
        expect(err.message).not.toMatch(/\d+ (uploads|times|per)/);
        // And its window starts at the first attempt, so any word implying a
        // midnight reset would send the user off to wait for one that never
        // comes.
        expect(err.message).not.toMatch(/today|daily/i);
      });
    });

    describe("uncertain outcomes — retryable, because the idempotency key makes it safe", () => {
      it.each([500, 502, 503])("classifies HTTP %i as retryable", async (status) => {
        const err = await rejection(makeUploader(respondWith(status, "boom"))(ATTEMPT));
        expect(err.retryable).toBe(true);
      });

      it.each([
        // Timing failures a gateway can emit after the server already wrote.
        408, 425,
        // A bare 3xx here means an unexpected topology, not a proven rejection.
        301, 302, 307,
      ])(
        "classifies HTTP %i as retryable, since it does not prove the report was refused",
        async (status) => {
          const err = await rejection(makeUploader(respondWith(status, "moved"))(ATTEMPT));
          expect(err.retryable).toBe(true);
        }
      );

      it("times out a request that never settles, handing the UI back as an uncertain outcome", async () => {
        jest.useFakeTimers();
        try {
          const request: ReportRequest = jest.fn(() => new Promise<never>(() => undefined));
          const pending = makeUploader(request)(ATTEMPT);
          const settled = pending.catch((err: unknown) => err);

          await jest.advanceTimersByTimeAsync(4 * 60 * 1000);

          const err = (await settled) as ReportUploadError;
          expect(err).toBeInstanceOf(ReportUploadError);
          expect(err.retryable).toBe(true);
          expect(err.message).toMatch(/timed out/);
        } finally {
          jest.useRealTimers();
        }
      });

      it("clears the deadline when the response arrives first, so no timer outlives the upload", async () => {
        jest.useFakeTimers();
        try {
          const clearSpy = jest.spyOn(window, "clearTimeout");
          await makeUploader(respondWith(200, OK_BODY))(ATTEMPT);

          expect(clearSpy).toHaveBeenCalled();
          expect(jest.getTimerCount()).toBe(0);
          clearSpy.mockRestore();
        } finally {
          jest.useRealTimers();
        }
      });

      it("classifies a thrown transport (network down mid-flight) as retryable", async () => {
        const request = jest
          .fn<ReturnType<ReportRequest>, Parameters<ReportRequest>>()
          .mockRejectedValue(new Error("net::ERR_CONNECTION_RESET at /Users/alice/vault"));

        const err = await rejection(makeUploader(request)(ATTEMPT));

        expect(err.retryable).toBe(true);
        expect(err.message).toMatch(/unconfirmed/);
      });

      it("logs the transport's own error, which the fixed user-facing copy replaces", async () => {
        // The message the user sees is deliberately the same sentence for every
        // transport failure, which leaves the log as the only place the actual
        // cause survives. Without this, a DNS failure, a reset connection and a
        // protocol abort are indistinguishable after the fact.
        const cause = new Error("net::ERR_HTTP2_PROTOCOL_ERROR");
        const request = jest
          .fn<ReturnType<ReportRequest>, Parameters<ReportRequest>>()
          .mockRejectedValue(cause);

        await rejection(makeUploader(request)(ATTEMPT));

        expect(logError).toHaveBeenCalledWith(expect.stringContaining("[reportUpload]"), cause);
      });

      it.each([
        ["a body that is not JSON", "<html>gateway</html>"],
        ["a body that is not an object", "42"],
        ["a response with no report id", { received: true, expiresAt: OK_BODY.expiresAt }],
        ["an empty report id", { ...OK_BODY, reportId: "" }],
        ["a report id that is not 32 hex chars", { ...OK_BODY, reportId: "https://evil.example" }],
        [
          "a response missing received",
          { reportId: OK_BODY.reportId, expiresAt: OK_BODY.expiresAt },
        ],
        ["an explicit refusal", { ...OK_BODY, received: false }],
        ["a response missing expiresAt", { reportId: OK_BODY.reportId, received: true }],
        ["a non-string expiresAt", { ...OK_BODY, expiresAt: 1760745600 }],
        ["an unparseable expiresAt", { ...OK_BODY, expiresAt: "whenever" }],
      ])(
        "treats a 200 carrying %s as unconfirmed rather than showing a placeholder as success",
        async (_label, body) => {
          // A proxy, captive portal, or deploy mid-rollout can answer 200 with
          // anything; only a fully well-formed receipt counts as stored.
          const err = await rejection(makeUploader(respondWith(200, body))(ATTEMPT));
          expect(err.retryable).toBe(true);
        }
      );
    });

    it("never echoes the response body into the error, which reaches a Notice and the log", async () => {
      const sentinel = "SENTINEL-c0ffee-do-not-leak";
      const statuses: Array<[number, string]> = [
        [400, sentinel],
        [429, JSON.stringify({ detail: sentinel })],
        [500, sentinel],
        [200, `<html>${sentinel}</html>`],
      ];
      for (const [status, body] of statuses) {
        const err = await rejection(makeUploader(respondWith(status, body))(ATTEMPT));
        expect(err.message).not.toContain(sentinel);
      }
    });

    it("never echoes the transport's own message, which can carry paths, into the error", async () => {
      const request = jest
        .fn<ReturnType<ReportRequest>, Parameters<ReportRequest>>()
        .mockRejectedValue(new Error("EACCES /Users/alice/secret-vault/report.zip"));

      const err = await rejection(makeUploader(request)(ATTEMPT));

      expect(err.message).not.toContain("alice");
    });

    it("replaces even a transport error of the adapter's own class, recognized by identity not type", async () => {
      // Only the attempt's own deadline error may pass through with its message
      // intact; a transport that happened to throw ReportUploadError must not
      // smuggle its message past the fixed-copy boundary on the class name.
      const request = jest
        .fn<ReturnType<ReportRequest>, Parameters<ReportRequest>>()
        .mockRejectedValue(new ReportUploadError("EACCES /Users/alice/secret-vault", true));

      const err = await rejection(makeUploader(request)(ATTEMPT));

      expect(err.message).not.toContain("alice");
      expect(err.message).toMatch(/unconfirmed/);
    });
  });
});
