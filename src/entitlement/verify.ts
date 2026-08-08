import { ENTITLEMENT_PUBLIC_KEYS } from "./publicKeys";
import type { EntitlementClaims } from "./types";

export interface VerifyEntitlementOptions {
  /** Current time in epoch ms; defaults to `Date.now()`. Injected by tests. */
  now?: number;
  /** Public keys keyed by `kid`; defaults to the embedded set. Injected by tests. */
  publicKeys?: Record<string, JsonWebKey>;
  /** When set, the token's `user_id` must equal this or verification fails. */
  expectedUserId?: string;
  /**
   * SubtleCrypto implementation; defaults to the runtime's `crypto.subtle`
   * (present in Obsidian desktop/Electron and mobile WebViews). Injected by tests
   * so they don't depend on the environment's global WebCrypto.
   */
  subtle?: SubtleCrypto;
}

interface JwsHeader {
  alg?: string;
  kid?: string;
}

/** Decode a base64url segment to bytes. */
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

/**
 * Verify a server-signed entitlement token offline and return its claims, or
 * `null` if the token is malformed, signed by an unknown key, has a bad
 * signature, is expired, or is bound to a different user.
 *
 * ES256 (ECDSA P-256 + SHA-256). The embedded public key can only verify, so
 * this is robust against forged entitlement data (edited `data.json`, faked
 * `/license` responses) even though the client code is public — the only
 * remaining bypass is recompiling the plugin. See the "Copilot Entitlement Token
 * Design" doc.
 */
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
    // Any verification error (malformed JWK, unsupported curve, bad signature
    // bytes) is treated as a non-verifying token; the caller decides the fallback.
    return null;
  }
  if (!verified) return null;

  const claims = parseJsonSegment<EntitlementClaims>(payloadSegment);
  if (!claims || typeof claims.user_id !== "string" || !Array.isArray(claims.features)) {
    return null;
  }
  // `exp` is epoch seconds (JWT convention); compare against epoch ms.
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= now) return null;
  if (expectedUserId && claims.user_id !== expectedUserId) return null;

  return claims;
}
