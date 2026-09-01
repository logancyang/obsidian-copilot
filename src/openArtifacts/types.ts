export interface OpenArtifactsDocument {
  readonly title: string;
  readonly html: string;
  readonly byteLength: number;
}

export interface OpenArtifactsReceipt {
  docId: string;
  url: string;
  version: number;
}

export type OpenArtifactsAction = "publish" | "update" | "delete";

export interface OpenArtifactsErrorPayload {
  code: string;
  message: string;
}

export interface OpenArtifactsErrorResponse {
  error: OpenArtifactsErrorPayload;
}
