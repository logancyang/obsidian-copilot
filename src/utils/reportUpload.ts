/**
 * The contract between the "Report an issue" flow and whatever stores the
 * packed zip. Kept apart from `issueReport.ts` (which owns bundling the zip)
 * and from the adapter that talks to the endpoint, so either side can be
 * tested against this file alone.
 */

/**
 * One upload attempt: the exact bytes to send and the idempotency key minted
 * with them. The two travel as a pair on purpose — the key identifies *these
 * bytes* to the server, so re-sending the pair reaches the same stored object
 * rather than a second one. The invariant a producer has to keep is one set of
 * bytes to one key: different bytes must arrive under a new key, or the server
 * answers them with the object the old key already names. Handing an uploader
 * a path instead would let the file change under a key that still names the
 * old contents, which is why this carries the bytes themselves.
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
  /** When the stored report is scheduled for deletion; for a person to read. */
  expiresAt: string;
}

/**
 * An upload failure the user can read and retry. Its message is the whole
 * story — what went wrong, in words meant for a person — and it never says
 * whether the report was stored: a timeout, a dropped connection or an
 * unreadable response all leave that unknown. Re-sending the same attempt is
 * always safe, because its idempotency key makes a duplicate store impossible.
 */
export class ReportUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportUploadError";
  }
}

/**
 * Upload one attempt and resolve once it is durably stored. No `signal` and no
 * progress callback: Obsidian's `requestUrl` transport supports neither, and an
 * interface that promised what the transport cannot do would invite a caller to
 * offer cancellation or progress it could never deliver. Rejects with
 * `ReportUploadError` on any failure.
 */
export type ReportUploader = (attempt: ReportUploadAttempt) => Promise<ReportUploadResult>;
