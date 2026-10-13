export interface OpenArtifactsDocument {
  readonly title: string;
  readonly html: string;
  readonly byteLength: number;
}

export type OpenArtifactsLinkAccess = "anyone" | "invited";

export interface OpenArtifactsReceipt {
  docId: string;
  url: string;
  version: number;
  linkAccess?: OpenArtifactsLinkAccess;
}

export interface OpenArtifactsAccess {
  docId: string;
  url: string;
  linkAccess: OpenArtifactsLinkAccess;
  people: { email: string; addedAt: string }[];
}

export type OpenArtifactsAction = "publish" | "update" | "delete";

export interface OpenArtifactsErrorPayload {
  code: string;
  message: string;
  limit?: string;
  upgrade_url?: string;
}

export interface OpenArtifactsErrorResponse {
  error: OpenArtifactsErrorPayload;
}
