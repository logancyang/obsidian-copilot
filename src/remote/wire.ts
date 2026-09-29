export interface RemoteChannel {
  send(text: string): void;
  onMessage(handler: (text: string) => void): () => void;
  onClose(handler: (event: { code: number }) => void): () => void;
  close(code?: number): void;
}

export const AUTH_FRAME_MAX_BYTES = 4096;

export const CLOSE_CODE = {
  denied: 4401,
  revoked: 4403,
  authTimeout: 4408,
  serverStopping: 1001,
} as const;

export type DenyReason = "pairing-rejected" | "token-rejected" | "bad-request";

export type ChannelClientFrame =
  | { type: "pair"; secret: string; deviceName: string }
  | { type: "auth"; token: string };

export type ChannelServerFrame =
  | { type: "paired"; token: string; deviceId: string; desktopName: string }
  | { type: "authed"; deviceId: string }
  | { type: "denied"; reason: DenyReason };

const DENY_REASONS: readonly string[] = ["pairing-rejected", "token-rejected", "bad-request"];

function parseObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

export function parseClientFrame(text: string): ChannelClientFrame | null {
  const frame = parseObject(text);
  if (!frame) return null;
  if (frame.type === "pair") {
    if (!isBoundedString(frame.secret, 128) || typeof frame.deviceName !== "string") return null;
    return { type: "pair", secret: frame.secret, deviceName: frame.deviceName.slice(0, 200) };
  }
  if (frame.type === "auth") {
    return isBoundedString(frame.token, 128) ? { type: "auth", token: frame.token } : null;
  }
  return null;
}

export function parseServerFrame(text: string): ChannelServerFrame | null {
  const frame = parseObject(text);
  if (!frame) return null;
  if (frame.type === "paired") {
    if (
      !isBoundedString(frame.token, 128) ||
      !isBoundedString(frame.deviceId, 128) ||
      typeof frame.desktopName !== "string"
    ) {
      return null;
    }
    return {
      type: "paired",
      token: frame.token,
      deviceId: frame.deviceId,
      desktopName: frame.desktopName.slice(0, 200),
    };
  }
  if (frame.type === "authed") {
    return isBoundedString(frame.deviceId, 128)
      ? { type: "authed", deviceId: frame.deviceId }
      : null;
  }
  if (frame.type === "denied") {
    return typeof frame.reason === "string" && DENY_REASONS.includes(frame.reason)
      ? { type: "denied", reason: frame.reason as DenyReason }
      : null;
  }
  return null;
}
