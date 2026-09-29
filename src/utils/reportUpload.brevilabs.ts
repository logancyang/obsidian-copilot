import { BREVILABS_API_BASE_URL } from "@/constants";
import { logError } from "@/logger";
import {
  ReportUploadError,
  type ReportUploader,
  type ReportUploadResult,
} from "@/utils/reportUpload";
import { requestUrl } from "obsidian";

const REPORTS_ENDPOINT = `${BREVILABS_API_BASE_URL}/reports`;

const CLIENT_VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/;

const REPORT_ID_PATTERN = /^[0-9a-f]{32}$/;

const MAX_REASON_LENGTH = 200;

const UPLOAD_TIMEOUT_MS = 4 * 60 * 1000;

export type ReportRequest = (params: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: ArrayBuffer;
  throw: boolean;
}) => Promise<{ status: number; text: string }>;

export interface ReportUploaderDeps {
  installId: () => string;
  clientVersion: string;
  request?: ReportRequest;
}

function readServerReason(text: string): string | undefined {
  try {
    const detail = (JSON.parse(text) as { detail?: unknown } | null)?.detail;
    if (typeof detail !== "string") return undefined;
    const reason = detail.replace(/\s+/g, " ").trim();
    return reason.length > MAX_REASON_LENGTH ? `${reason.slice(0, MAX_REASON_LENGTH)}…` : reason;
  } catch {
    return undefined;
  }
}

function readUploadResult(status: number, text: string): ReportUploadResult {
  if (status < 200 || status >= 300) {
    const reason = readServerReason(text);
    throw new ReportUploadError(`Upload failed (HTTP ${status})${reason ? `: ${reason}` : ""}`);
  }

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

export function createReportUploader(deps: ReportUploaderDeps): ReportUploader {
  const request = deps.request ?? requestUrl;
  return async (attempt) => {
    // The server rate-limits and dedupes on the install id, so an upload without a usable id would be rejected after spending an upload slot.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/202
    let installId: string;
    try {
      installId = deps.installId();
    } catch {
      throw new ReportUploadError(
        "Copilot could not get a valid saved device ID, so nothing was uploaded."
      );
    }
    if (!CLIENT_VERSION_PATTERN.test(deps.clientVersion) || deps.clientVersion === "unknown") {
      throw new ReportUploadError(
        "Copilot could not determine its own version, so nothing was uploaded."
      );
    }

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
          throw: false,
        }),
        deadline,
      ]);
    } catch (err) {
      if (err === deadlineError) throw err;
      logError("[reportUpload] the transport failed without returning a response:", err);
      throw new ReportUploadError("The upload did not complete, so its outcome is unconfirmed.");
    } finally {
      window.clearTimeout(deadlineTimer);
    }
    return readUploadResult(response.status, response.text);
  };
}
