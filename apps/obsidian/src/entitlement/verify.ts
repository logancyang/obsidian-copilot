import { ENTITLEMENT_PUBLIC_KEYS } from "./publicKeys";
import type { EntitlementClaims } from "./types";

export interface VerifyEntitlementOptions {
  now?: number;
  publicKeys?: Record<string, JsonWebKey>;
  expectedUserId?: string;
  subtle?: SubtleCrypto;
}

interface JwsHeader {
  alg?: string;
  kid?: string;
}

function base64UrlToBytes(segment: string): Uint8Array {
  const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function parseJsonSegment<T>(segment: string): T | null {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment))) as T;
  } catch {
    return null;
  }
}

export async function verifyEntitlement(
  token: string,
  options: VerifyEntitlementOptions = {}
): Promise<EntitlementClaims | null> {
  const {
    now = Date.now(),
    publicKeys = ENTITLEMENT_PUBLIC_KEYS,
    expectedUserId,
    subtle = crypto.subtle,
  } = options;
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerSegment, payloadSegment, signatureSegment] = parts;

  const header = parseJsonSegment<JwsHeader>(headerSegment);
  if (!header || header.alg !== "ES256" || !header.kid) return null;

  const jwk = publicKeys[header.kid];
  if (!jwk) return null;

  let verified = false;
  try {
    const key = await subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, [
      "verify",
    ]);
    verified = await subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      base64UrlToBytes(signatureSegment),
      new TextEncoder().encode(`${headerSegment}.${payloadSegment}`)
    );
  } catch {
    return null;
  }
  if (!verified) return null;

  const claims = parseJsonSegment<EntitlementClaims>(payloadSegment);
  if (!claims || typeof claims.user_id !== "string" || !Array.isArray(claims.features)) {
    return null;
  }
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= now) return null;
  if (expectedUserId && claims.user_id !== expectedUserId) return null;

  return claims;
}
