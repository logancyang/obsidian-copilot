import type { RawData } from "ws";

export interface Reply {
  type: string;
  token: string;
  deviceId: string;
  desktopName: string;
  reason: string;
}

export function rawText(data: RawData): string {
  if (Array.isArray(data)) return data.map((chunk) => chunk.toString("utf8")).join("");
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  return new TextDecoder().decode(new Uint8Array(data));
}

export function parseReply(text: string): Reply {
  return JSON.parse(text) as Reply;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
