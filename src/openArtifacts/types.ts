export interface OpenArtifactsDocument {
  readonly title: string;
  readonly html: string;
  readonly byteLength: number;
}

export type OpenArtifactsLinkAccess = "anyone" | "invited";

// The server's one-time offer to link this Copilot license to an OpenArtifacts account; its text is server-owned.
// https://github.com/Brevilabs/OpenArtifacts/issues/94
export interface OpenArtifactsGuidance {
  message: string;
  url: string;
}

export interface OpenArtifactsReceipt {
  docId: string;
  url: string;
  version: number;
  linkAccess?: OpenArtifactsLinkAccess;
  guidance?: OpenArtifactsGuidance;
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
