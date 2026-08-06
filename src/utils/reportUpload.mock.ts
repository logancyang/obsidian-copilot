import { type ReportUploadResult, type ReportUploader } from "@/utils/reportUpload";

/** How long the mock pretends the network takes, so the uploading state is visible. */
const MOCK_UPLOAD_DELAY_MS = 1200;

/** How long the mock claims the fake link stays valid. */
const MOCK_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * DESIGN NOTE — placeholder for the real Brevilabs upload endpoint, which
 * does not exist yet (only process-and-discard endpoints do:
 * `docs4llm`/`pdf4llm`/etc.). Nothing is actually sent anywhere; `zipPath`
 * is unused. `shareUrl` is built on the RFC 2606 `.invalid` TLD so a fake
 * link can never resolve, be mistaken for a real Brevilabs response, or
 * collide with a real `reportId`. Swap this module out for a real adapter
 * once the endpoint's contract (auth, retention, idempotent retry) is
 * settled — see `designdocs/REPORT_UPLOAD_FLOW.md`.
 */
export const mockReportUploader: ReportUploader = async (): Promise<ReportUploadResult> => {
  await new Promise((resolve) => window.setTimeout(resolve, MOCK_UPLOAD_DELAY_MS));
  const reportId = Math.random().toString(36).slice(2, 10);
  return {
    shareUrl: `https://copilot-reports.invalid/r/${reportId}`,
    reportId,
    expiresAt: new Date(Date.now() + MOCK_EXPIRY_MS).toISOString(),
  };
};
