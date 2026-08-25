/**
 * The contract between the "Report an issue" flow and whatever stores the
 * packed zip. Kept apart from `issueReport.ts` (which owns bundling the zip)
 * and from the adapter that talks to the endpoint, so either side can be
 * tested against this file alone.
 */

/**
 * One upload attempt: the exact bytes to send and the idempotency key minted
 * with them. The two travel as a pair on purpose — the key identifies *these
 * bytes* to the server, so retrying re-sends the same object, and a rebuild
 * that produces different bytes mints a whole new pair. A rebuild that
 * produces identical bytes keeps this one, so a retry stays repeatable rather
 * than becoming a second stored copy. Handing an uploader a path instead would
 * let the file change under a key that still names the old contents.
 */
export interface ReportUploadAttempt {
  readonly body: ArrayBuffer;
  readonly idempotencyKey: string;
}

/** What a successful upload hands back. */
export interface ReportUploadResult {
  /**
   * Opaque reference the maintainer resolves against the report store — never
   * a URL, and never generated client-side: only the server's response says
   * the report was actually stored.
   */
  reportId: string;
  /** When the stored report is scheduled for deletion; shown to the user. */
  expiresAt: string;
}

/**
 * Upload failure that says whether re-sending the same attempt can help.
 *
 * `retryable: true` means the outcome is unknown (network error, unreadable
 * response, service unavailable) — re-sending the same attempt is safe because
 * its idempotency key makes a duplicate store impossible. `retryable: false`
 * means the server (or a local pre-send check) definitively rejected this
 * attempt, and sending the identical bytes again can only fail the same way —
 * while still spending the upload allowance.
 */
export class ReportUploadError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean
  ) {
    super(message);
    this.name = "ReportUploadError";
  }
}

/**
 * Upload one attempt and resolve once it is durably stored. No `signal` and no
 * progress callback: Obsidian's `requestUrl` transport supports neither, so an
 * interface that promised them would be a lie a UI could build a Cancel button
 * or a percentage bar around. Rejects with `ReportUploadError` where the
 * failure's retryability is known.
 */
export type ReportUploader = (attempt: ReportUploadAttempt) => Promise<ReportUploadResult>;
