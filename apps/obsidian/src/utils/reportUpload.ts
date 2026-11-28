export interface ReportUploadAttempt {
  readonly body: ArrayBuffer;
  readonly idempotencyKey: string;
}

export interface ReportUploadResult {
  reportId: string;
  expiresAt: string;
}

export class ReportUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportUploadError";
  }
}

export type ReportUploader = (attempt: ReportUploadAttempt) => Promise<ReportUploadResult>;
