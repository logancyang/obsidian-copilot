export interface SymposiumDocument {
  readonly title: string;
  readonly html: string;
  readonly byteLength: number;
}

export interface SymposiumReceipt {
  docId: string;
  url: string;
  version: number;
}

export type SymposiumAction = "publish" | "update" | "delete";

export interface SymposiumErrorPayload {
  code: string;
  message: string;
}

export interface SymposiumErrorResponse {
  error: SymposiumErrorPayload;
}
