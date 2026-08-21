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
 * request would fail anyway, after spending a slot of the daily allowance.
 */
const CLIENT_VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/;

/** The stored report's id: 32 lowercase hex characters, and nothing else. */
const REPORT_ID_PATTERN = /^[0-9a-f]{32}$/;

/**
 * How long one upload may run before the UI gets its hands back. Not a
 * cancellation — `requestUrl` has no abort, so the underlying request keeps
 * running — just a bound on how long the flow stays locked on "Uploading…":
 * a TCP black hole or a proxy that holds the connection open would otherwise
 * pin the user there forever, with Retry and the manual path unreachable.
 *
 * The value is an assumption, not a server contract: 24 MiB at a 1 Mbps
 * uplink is ≈ 201 s, so four minutes leaves ~19% headroom for protocol
 * overhead and speed dips. A timeout is an *uncertain* outcome — the late
 * response may still land — and retrying the same attempt is safe because its
 * idempotency key makes a duplicate store impossible.
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
   * Resolves the per-installation UUIDv4, called at upload time rather than at
   * construction so its failure (unusable storage) surfaces on the click that
   * needs it. May throw; the adapter turns that into a non-retryable error.
   */
  installId: () => string;
  /** The plugin's `manifest.version`, so a report can be read against its build. */
  clientVersion: string;
  request?: ReportRequest;
}

/**
 * Statuses where the server definitively rejected this attempt: re-sending the
 * identical bytes can only fail the same way, while still spending the user's
 * daily upload allowance — so the UI must not offer a Retry for these.
 *
 * Fixed local copy only, never the response body: the error text reaches a
 * Notice and the log, and a body from a proxy or captive portal can carry
 * arbitrary or echoed content. And causes only, never actions — which buttons
 * the user still has (Retry, Open issue anyway) is the review page's decision,
 * driven by `retryable`; an action sentence here would be said twice.
 */
const REJECTION_MESSAGES: Record<number, string> = {
  400: "The report server rejected the report bundle (HTTP 400).",
  413: "The report is larger than the server accepts (HTTP 413).",
  415: "The report server rejected the upload format (HTTP 415).",
  422: "The report server rejected the request headers (HTTP 422).",
  // Neither "today's" nor "yours": the window starts at the first attempt
  // rather than at midnight, and the limit is enforced per installation *and*
  // per address, so a 429 can be someone else on the same network having spent
  // it.
  429: "The report upload allowance is used up for now.",
};

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
    const rejection = REJECTION_MESSAGES[status];
    if (rejection) throw new ReportUploadError(rejection, false);
    if (status >= 500) {
      throw new ReportUploadError(
        `The report service is temporarily unavailable (HTTP ${status}).`,
        true
      );
    }
    // Statuses whose semantics leave the outcome unknown: 408/425 are timing
    // failures a gateway can emit after the server already wrote, and a bare
    // 3xx reaching this code means an unexpected topology — the transport
    // normally follows redirects, and nothing proves the origin did not
    // process the request before redirecting. With the idempotency key making
    // a re-send safe, "unknown" must never be presented as "rejected".
    if (status === 408 || status === 425 || (status >= 300 && status < 400)) {
      throw new ReportUploadError(
        `The report server's answer was inconclusive (HTTP ${status}), so the upload is unconfirmed.`,
        true
      );
    }
    // Remaining 4xx: the server understood the request and refused it.
    throw new ReportUploadError(`The report server rejected the upload (HTTP ${status}).`, false);
  }

  // 2xx with an unreadable or malformed body is an *uncertain* outcome — the
  // report may or may not be stored. Retrying the same attempt is safe either
  // way: its idempotency key makes the server return the stored copy instead
  // of storing a second one.
  const malformed = () =>
    new ReportUploadError(
      "The report server's response could not be read, so the upload is unconfirmed.",
      true
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
 * to the user's licence is exactly what the report flow's privacy copy
 * promises it does not do. The headers below are the request's entire
 * identity; tests pin them with an exact match so nothing extra can creep in.
 *
 * @param deps - Client identity and (in tests) the transport.
 */
export function createReportUploader(deps: ReportUploaderDeps): ReportUploader {
  const request = deps.request ?? requestUrl;
  return async (attempt) => {
    // Local pre-send checks: both failures are ones the server would reject
    // anyway (as a 400/422), after spending a slot of the daily allowance.
    let installId: string;
    try {
      installId = deps.installId();
    } catch {
      // The getter's own message is discarded, not forwarded: this error
      // reaches a Notice and the chat log (itself a report attachment), and
      // whatever storage or the uuid library threw can carry environment
      // details. The single trust boundary for that lives here.
      throw new ReportUploadError(
        "Copilot could not create its report install ID (local storage may be unavailable), so nothing was uploaded.",
        false
      );
    }
    // The exact-lowercase comparison mirrors the endpoint's own check, which
    // does not case-fold either; only the literal sentinel is rejected there.
    if (!CLIENT_VERSION_PATTERN.test(deps.clientVersion) || deps.clientVersion === "unknown") {
      throw new ReportUploadError(
        "Copilot could not determine its own version, so nothing was uploaded.",
        false
      );
    }

    // A deadline, not a cancellation: losing the race only hands the UI back
    // (the request itself cannot be aborted and may still land — an uncertain
    // outcome the idempotency key makes safe to retry). Held as an instance so
    // the catch below can recognize it by identity, not by type — a transport
    // that happened to throw this class would otherwise smuggle its own
    // message past the fixed-copy boundary.
    const deadlineError = new ReportUploadError(
      "The upload timed out, so the outcome is unconfirmed.",
      true
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
          // so a rejection can be classified instead of surfacing as a generic
          // error.
          throw: false,
        }),
        deadline,
      ]);
    } catch (err) {
      // Identity, not `instanceof`: only this attempt's own deadline error may
      // pass through with its message intact.
      if (err === deadlineError) throw err;
      // Fixed copy for the user, the real cause for whoever has to diagnose it.
      // Discarding the transport's message outright left "could not reach the
      // server" indistinguishable from a dozen different failures, with nothing
      // anywhere to tell them apart. The log is the right home for it: it is a
      // developer surface, and `redactLogText` scrubs it on the way into a
      // report bundle, the same as every other `logError` in this flow.
      logError("[reportUpload] the transport failed without returning a response:", err);
      // Not "could not reach the server": the throw covers a protocol-level
      // abort just as much as a dead connection, and a real one was observed
      // where the request did reach the server. All that is actually known is
      // that no response came back, so the report may already be stored and
      // the allowance already spent — an uncertain outcome, not a clean
      // "nothing happened".
      throw new ReportUploadError(
        "The upload did not complete, so its outcome is unconfirmed.",
        true
      );
    } finally {
      window.clearTimeout(deadlineTimer);
    }
    return readUploadResult(response.status, response.text);
  };
}
