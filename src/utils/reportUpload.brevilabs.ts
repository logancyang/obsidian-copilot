import { BREVILABS_API_BASE_URL } from "@/constants";
import { logError } from "@/logger";
import {
  ReportUploadError,
  type ReportUploader,
  type ReportUploadResult,
} from "@/utils/reportUpload";
import { requestUrl } from "obsidian";

/** Where a packed report is stored. Appended to a base that already ends in `/v1`. */
const REPORTS_ENDPOINT = `${BREVILABS_API_BASE_URL}/reports`;

/**
 * The endpoint validates this header and rejects the whole upload when it
 * normalizes to "unknown", so an invalid version is refused locally — the
 * request would fail anyway, after spending a slot of the upload allowance.
 */
const CLIENT_VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/;

/** The stored report's id: 32 lowercase hex characters, and nothing else. */
const REPORT_ID_PATTERN = /^[0-9a-f]{32}$/;

/** Longest server reason shown in the failure callout. */
const MAX_REASON_LENGTH = 200;

/**
 * How long one upload may run before this function settles. Not a
 * cancellation — `requestUrl` has no abort, so the underlying request keeps
 * running — just a bound on how long the caller is made to wait: a TCP black
 * hole or a proxy that holds the connection open would otherwise leave the
 * returned promise pending forever, with no way back to the caller.
 *
 * The value is an assumption, not a server contract: 24 MiB at a 1 Mbps
 * uplink is ≈ 201 s, so four minutes leaves ~19% headroom for protocol
 * overhead and speed dips. The late response may still land, which is fine:
 * the attempt's idempotency key makes re-sending it safe.
 */
const UPLOAD_TIMEOUT_MS = 4 * 60 * 1000;

/**
 * The transport, narrowed to what this adapter uses. Injectable so the upload
 * can be tested without a network; the real value is Obsidian's `requestUrl`.
 */
export type ReportRequest = (params: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: ArrayBuffer;
  throw: boolean;
}) => Promise<{ status: number; text: string }>;

/** What the adapter needs from the host to identify the client. */
export interface ReportUploaderDeps {
  /**
   * Resolves the persisted device UUIDv4 for this vault, called at upload time rather than at
   * construction so its failure (unusable storage) surfaces on the click that
   * needs it. May throw; the adapter turns that into a `ReportUploadError`.
   */
  installId: () => string;
  /** The plugin's `manifest.version`, so a report can be read against its build. */
  clientVersion: string;
  request?: ReportRequest;
}

/**
 * The server's own reason for refusing an upload, when the body carries one.
 * Only a string `detail` counts — the shape the endpoint refuses with, e.g.
 * "Report ZIP exceeds 25 MiB" on a 413. Anything else is dropped: this text is
 * put in front of a person, and a body from a proxy or captive portal can
 * carry arbitrary or echoed content.
 */
function readServerReason(text: string): string | undefined {
  try {
    const detail = (JSON.parse(text) as { detail?: unknown } | null)?.detail;
    if (typeof detail !== "string") return undefined;
    // Only keeps a proxy's long body from flooding the failure callout; redaction is the assembler's.
    const reason = detail.replace(/\s+/g, " ").trim();
    return reason.length > MAX_REASON_LENGTH ? `${reason.slice(0, MAX_REASON_LENGTH)}…` : reason;
  } catch {
    return undefined;
  }
}

/**
 * Read the report id out of a response body, refusing anything that would put
 * a placeholder in front of the user. A proxy, a captive portal, or a deploy
 * mid-rollout can all answer 200 with something else entirely, and an "upload
 * succeeded" page quoting `undefined` is worse than a failure the user can
 * retry. Unknown extra fields are ignored, so the server may add fields
 * without breaking older clients.
 */
function readUploadResult(status: number, text: string): ReportUploadResult {
  if (status < 200 || status >= 300) {
    const reason = readServerReason(text);
    throw new ReportUploadError(`Upload failed (HTTP ${status})${reason ? `: ${reason}` : ""}`);
  }

  // 2xx with an unreadable or malformed body leaves it unknown whether the
  // report is stored; the message says so rather than claiming either way.
  const malformed = () =>
    new ReportUploadError(
      "The report server's response could not be read, so the upload is unconfirmed."
    );
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw malformed();
  }
  if (typeof payload !== "object" || payload === null) throw malformed();
  const body = payload as { reportId?: unknown; received?: unknown; expiresAt?: unknown };
  if (typeof body.reportId !== "string" || !REPORT_ID_PATTERN.test(body.reportId)) {
    throw malformed();
  }
  if (body.received !== true) throw malformed();
  if (typeof body.expiresAt !== "string" || !Number.isFinite(Date.parse(body.expiresAt))) {
    throw malformed();
  }
  return { reportId: body.reportId, expiresAt: body.expiresAt };
}

/**
 * Build the uploader that sends a packed report to Brevilabs.
 *
 * Deliberately not routed through `BrevilabsClient`: both of its request
 * helpers attach an `Authorization` header or a `user_id`, and this path must
 * send neither — a diagnostic report is not a licensed API call, and tying one
 * to the user's licence is exactly what a diagnostic upload must not do. The
 * headers below are the request's entire identity — an installation id, the
 * idempotency key and the client version, and nothing that names a person or
 * an account; tests pin them with an exact match so nothing can creep in.
 *
 * @param deps - Client identity and (in tests) the transport.
 */
export function createReportUploader(deps: ReportUploaderDeps): ReportUploader {
  const request = deps.request ?? requestUrl;
  return async (attempt) => {
    // Local pre-send checks. The server keys its rate limit and its duplicate
    // detection on the install id and refuses an unreadable client version, so
    // an upload without a usable id could be neither throttled nor deduplicated
    // per install; both would be rejected anyway (as a 400/422), after spending
    // a slot of the upload allowance
    // (https://github.com/Brevilabs/obsidian-copilot-private/issues/202).
    let installId: string;
    try {
      installId = deps.installId();
    } catch {
      // The getter's own message is discarded, not forwarded: this one is
      // written for a person to read, and whatever storage or the uuid library
      // threw can carry environment details such as home paths. The single
      // trust boundary for that lives here.
      throw new ReportUploadError(
        "Copilot could not get a valid saved device ID, so nothing was uploaded."
      );
    }
    // The exact-lowercase comparison mirrors the endpoint's own check, which
    // does not case-fold either; only the literal sentinel is rejected there.
    if (!CLIENT_VERSION_PATTERN.test(deps.clientVersion) || deps.clientVersion === "unknown") {
      throw new ReportUploadError(
        "Copilot could not determine its own version, so nothing was uploaded."
      );
    }

    // A deadline, not a cancellation: losing the race only settles this call;
    // the request itself cannot be aborted and may still land. Held as an
    // instance so the catch below can recognize it by identity, not by type —
    // a transport that happened to throw this class would otherwise smuggle
    // its own message past the fixed-copy boundary.
    const deadlineError = new ReportUploadError(
      "The upload timed out, so the outcome is unconfirmed."
    );
    let deadlineTimer: number | undefined;
    const deadline = new Promise<never>((_, reject) => {
      deadlineTimer = window.setTimeout(() => reject(deadlineError), UPLOAD_TIMEOUT_MS);
    });

    let response: { status: number; text: string };
    try {
      response = await Promise.race([
        request({
          url: REPORTS_ENDPOINT,
          method: "POST",
          headers: {
            "Content-Type": "application/zip",
            "X-Copilot-Install-ID": installId,
            "Idempotency-Key": attempt.idempotencyKey,
            "X-Client-Version": deps.clientVersion,
          },
          body: attempt.body,
          // Read the status ourselves rather than letting the transport throw,
          // so the status and the server's reason reach the user instead of a
          // generic transport error.
          throw: false,
        }),
        deadline,
      ]);
    } catch (err) {
      // Identity, not `instanceof`: only this attempt's own deadline error may
      // pass through with its message intact.
      if (err === deadlineError) throw err;
      // Fixed copy for the user, the real cause for whoever has to diagnose it.
      // The transport's message can carry paths and is the only thing that
      // tells a DNS failure, a reset connection and a protocol abort apart, so
      // it goes to the log — a developer surface that `redactLogText` scrubs
      // before it is ever packed into a bundle.
      logError("[reportUpload] the transport failed without returning a response:", err);
      // Not "could not reach the server": a throw covers a protocol-level
      // abort just as much as a dead connection, and the request may have
      // reached the server before it. All that is known is that no response
      // came back, so the report may already be stored.
      throw new ReportUploadError("The upload did not complete, so its outcome is unconfirmed.");
    } finally {
      window.clearTimeout(deadlineTimer);
    }
    return readUploadResult(response.status, response.text);
  };
}
