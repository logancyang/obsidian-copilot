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

/** A request that never answers but throws — a dead connection or a protocol abort. */
function throwWith(cause: unknown): jest.MockedFunction<ReportRequest> {
  return jest.fn<ReturnType<ReportRequest>, Parameters<ReportRequest>>().mockRejectedValue(cause);
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

/** The rejection itself, so one test can assert its class and its message together. */
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

    it("refuses to upload when the install id cannot be resolved, with fixed copy only (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", async () => {
      // The getter's own message must not survive into this one: it can
      // carry whatever storage or the uuid library threw, environment paths
      // included, while this error is written for a person to read.
      const request = respondWith(200, OK_BODY);
      const upload = makeUploader(request, {
        installId: () => {
          throw new Error("SecurityError: /Users/alice/profile is locked");
        },
      });

      const err = await rejection(upload(ATTEMPT));

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
    ])(
      "refuses to upload when the client version is %s (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)",
      async (_label, clientVersion) => {
        const request = respondWith(200, OK_BODY);
        const upload = createReportUploader({
          installId: () => "3f2a1d9e-8b4c-4f6d-9e2a-7c5b3a1d9e8f",
          clientVersion,
          request,
        });

        const err = await rejection(upload(ATTEMPT));

        expect(err.message).toMatch(/could not determine its own version/);
        expect(request).not.toHaveBeenCalled();
      }
    );

    it.each([400, 429, 500, 302])(
      "reports HTTP %i as one upload failure naming the status, whatever its class (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)",
      async (status) => {
        const err = await rejection(makeUploader(respondWith(status, "nope"))(ATTEMPT));
        expect(err.message).toBe(`Upload failed (HTTP ${status})`);
      }
    );

    it("appends the server's own reason on a 413, so the user learns the size limit (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", async () => {
      const body = { detail: "Report ZIP exceeds 25 MiB" };
      const err = await rejection(makeUploader(respondWith(413, body))(ATTEMPT));
      expect(err.message).toBe("Upload failed (HTTP 413): Report ZIP exceeds 25 MiB");
    });

    it.each([
      [
        "joins a multi-line reason onto one line",
        "Report ZIP\n  exceeds\t25 MiB ",
        "Report ZIP exceeds 25 MiB",
      ],
      [
        "cuts a 1,000-character reason to 200 and an ellipsis",
        "x".repeat(1000),
        `${"x".repeat(200)}…`,
      ],
    ])(
      "%s, so a proxy's body cannot flood the failure callout (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)",
      async (_shape, detail, reason) => {
        const err = await rejection(makeUploader(respondWith(413, { detail }))(ATTEMPT));
        expect(err.message).toBe(`Upload failed (HTTP 413): ${reason}`);
      }
    );

    it("never echoes a body that is not a server reason, which a proxy or captive portal can fill with anything (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", async () => {
      const sentinel = "SENTINEL-c0ffee-do-not-leak";
      const bodies: Array<[number, string]> = [
        [400, sentinel],
        [502, `<html>${sentinel}</html>`],
        [422, JSON.stringify({ detail: { loc: sentinel } })],
        [200, `<html>${sentinel}</html>`],
      ];
      for (const [status, body] of bodies) {
        const err = await rejection(makeUploader(respondWith(status, body))(ATTEMPT));
        expect(err.message).not.toContain(sentinel);
      }
    });

    it("times out a request that never settles, saying the outcome is unconfirmed", async () => {
      jest.useFakeTimers();
      try {
        const request: ReportRequest = jest.fn(() => new Promise<never>(() => undefined));
        const pending = makeUploader(request)(ATTEMPT);
        const settled = pending.catch((err: unknown) => err);

        await jest.advanceTimersByTimeAsync(4 * 60 * 1000);

        const err = (await settled) as ReportUploadError;
        expect(err).toBeInstanceOf(ReportUploadError);
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

    it("replaces a thrown transport's message with fixed copy and logs the real cause", async () => {
      // The transport's message can carry paths, so the user sees a fixed
      // sentence; the log is then the only place the actual cause survives,
      // and without it a DNS failure and a reset connection would be
      // indistinguishable after the fact.
      const cause = new Error("net::ERR_CONNECTION_RESET at /Users/alice/vault");

      const err = await rejection(makeUploader(throwWith(cause))(ATTEMPT));

      expect(err.message).toMatch(/did not complete/);
      expect(err.message).not.toContain("alice");
      expect(logError).toHaveBeenCalledWith(expect.stringContaining("[reportUpload]"), cause);
    });

    it("replaces even a transport error of the adapter's own class, recognized by identity not type", async () => {
      // Only the attempt's own deadline error may pass through with its message
      // intact; a transport that happened to throw ReportUploadError must not
      // smuggle its message past the fixed-copy boundary on the class name.
      const cause = new ReportUploadError("EACCES /Users/alice/secret-vault");

      const err = await rejection(makeUploader(throwWith(cause))(ATTEMPT));

      expect(err.message).not.toContain("alice");
      expect(err.message).toMatch(/did not complete/);
    });

    it.each([
      ["a body that is not JSON", "<html>gateway</html>"],
      ["a body that is not an object", "42"],
      ["a response with no report id", { received: true, expiresAt: OK_BODY.expiresAt }],
      ["an empty report id", { ...OK_BODY, reportId: "" }],
      ["a report id that is not 32 hex chars", { ...OK_BODY, reportId: "https://evil.example" }],
      ["a response missing received", { reportId: OK_BODY.reportId, expiresAt: OK_BODY.expiresAt }],
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
        expect(err.message).toMatch(/could not be read/);
      }
    );
  });
});
