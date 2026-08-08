// Uses Node's WebCrypto (imported explicitly, not the global) for ECDSA P-256 key
// generation/signing, and injects it into verifyEntitlement via the `subtle`
// option. This keeps the test independent of the environment's global WebCrypto —
// jsdom ships only a partial SubtleCrypto (no generateKey/ECDSA), and patching it
// proved unreliable across CI. The verification logic is WebCrypto-spec behavior,
// identical between Node and the Obsidian webview.
import { webcrypto } from "crypto";

import type { EntitlementClaims } from "./types";
import { verifyEntitlement, type VerifyEntitlementOptions } from "./verify";

// Node's webcrypto.SubtleCrypto and the DOM SubtleCrypto differ only in unrelated
// overloads (e.g. Ed25519); cast to the DOM type the API expects.
const subtle = webcrypto.subtle as unknown as SubtleCrypto;
const KID = "test-key";
const USER_ID = "user-123";

/** verifyEntitlement with Node's subtle injected; tests pass the rest of opts. */
function verify(token: string, opts: Omit<VerifyEntitlementOptions, "subtle"> = {}) {
  return verifyEntitlement(token, { subtle, ...opts });
}

function base64UrlEncode(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signToken(
  privateKey: CryptoKey,
  claims: Record<string, unknown>,
  header: Record<string, unknown> = { alg: "ES256", typ: "JWT", kid: KID }
): Promise<string> {
  const headerSegment = base64UrlEncode(JSON.stringify(header));
  const payloadSegment = base64UrlEncode(JSON.stringify(claims));
  const signature = await subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(`${headerSegment}.${payloadSegment}`)
  );
  return `${headerSegment}.${payloadSegment}.${base64UrlEncode(new Uint8Array(signature))}`;
}

// Far-future expiry (epoch seconds) so tokens are valid unless a test overrides it.
const FUTURE_EXP = Math.floor(Date.UTC(2099, 0, 1) / 1000);

function plusClaims(overrides: Partial<EntitlementClaims> = {}): Record<string, unknown> {
  return {
    user_id: USER_ID,
    plan: "plus",
    tier: "plus",
    features: ["multi_agent", "self_host"],
    iat: 0,
    exp: FUTURE_EXP,
    ...overrides,
  };
}

describe("verifyEntitlement", () => {
  let keyPair: CryptoKeyPair;
  let publicKeys: Record<string, JsonWebKey>;

  beforeAll(async () => {
    keyPair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ]);
    publicKeys = { [KID]: await subtle.exportKey("jwk", keyPair.publicKey) };
  });

  it("returns claims for a valid, correctly-signed token", async () => {
    const token = await signToken(keyPair.privateKey, plusClaims());
    const claims = await verify(token, { publicKeys, expectedUserId: USER_ID });
    expect(claims).not.toBeNull();
    expect(claims?.tier).toBe("plus");
    expect(claims?.features).toContain("multi_agent");
  });

  it("returns Lite claims without the multi_agent feature", async () => {
    const token = await signToken(
      keyPair.privateKey,
      plusClaims({ plan: "lite", tier: "lite", features: [] })
    );
    const claims = await verify(token, { publicKeys });
    expect(claims?.tier).toBe("lite");
    expect(claims?.features).not.toContain("multi_agent");
  });

  it("rejects an expired token", async () => {
    const token = await signToken(
      keyPair.privateKey,
      plusClaims({ exp: Math.floor(Date.UTC(2020, 0, 1) / 1000) })
    );
    expect(await verify(token, { publicKeys })).toBeNull();
  });

  it("rejects a token whose user_id does not match the local user", async () => {
    const token = await signToken(keyPair.privateKey, plusClaims());
    expect(await verify(token, { publicKeys, expectedUserId: "someone-else" })).toBeNull();
  });

  it("rejects a token signed by an unknown key (kid not in the trust set)", async () => {
    const otherPair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ]);
    const token = await signToken(otherPair.privateKey, plusClaims());
    expect(await verify(token, { publicKeys })).toBeNull();
  });

  it("rejects a token whose payload was tampered with after signing", async () => {
    const token = await signToken(keyPair.privateKey, plusClaims({ tier: "lite", features: [] }));
    const [header, , signature] = token.split(".");
    const forgedPayload = base64UrlEncode(
      JSON.stringify(plusClaims({ tier: "pro", features: ["multi_agent"] }))
    );
    const forged = `${header}.${forgedPayload}.${signature}`;
    expect(await verify(forged, { publicKeys })).toBeNull();
  });

  it("rejects a non-ES256 algorithm", async () => {
    const token = await signToken(keyPair.privateKey, plusClaims(), {
      alg: "none",
      typ: "JWT",
      kid: KID,
    });
    expect(await verify(token, { publicKeys })).toBeNull();
  });

  it("rejects malformed tokens and the empty string", async () => {
    expect(await verify("", { publicKeys })).toBeNull();
    expect(await verify("not-a-jwt", { publicKeys })).toBeNull();
    expect(await verify("only.two", { publicKeys })).toBeNull();
  });
});
