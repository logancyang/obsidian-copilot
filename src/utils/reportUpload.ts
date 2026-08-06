/**
 * The contract between the "Report an issue" flow and whatever stores the
 * packed zip and hands back a link to embed in the GitHub issue. Kept apart
 * from `issueReport.ts` (which owns bundling the zip itself) and from any
 * implementation, so a real backend-backed adapter can replace
 * `reportUpload.mock.ts` without touching this file.
 */

/** What a successful upload hands back. */
export interface ReportUploadResult {
  /** Stable, non-secret reference for the issue body — never a bearer credential. */
  shareUrl: string;
  /** Server-side id, for revocation and support correlation. */
  reportId: string;
  /**
   * When `shareUrl` stops working, shown to the user alongside it.
   *
   * Optional because retention is the endpoint's to enforce, not this type's to
   * assert: requiring the field would only oblige an adapter to supply some
   * string, which an adapter that ignores retention can do as easily as one
   * that honours it. An adapter that validates a live contract can narrow it.
   */
  expiresAt?: string;
}

/**
 * Upload the zip at `zipPath` and resolve once it is durably stored. No
 * `signal` and no progress callback: Obsidian's `requestUrl` transport
 * supports neither, so an interface that promised them would be a lie a UI
 * could build a Cancel button or a percentage bar around.
 */
export type ReportUploader = (zipPath: string) => Promise<ReportUploadResult>;
