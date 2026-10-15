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
  // Whether the server sends invite and request emails; when false the owner shares the link.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/707
  email: boolean;
  people: { email: string; role: "view" | "comment"; addedAt: number }[];
  requests: { email: string; requestedAt: number }[];
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
