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

  it("rejects segments containing characters outside the base64url alphabet", async () => {
    const token = await signToken(keyPair.privateKey, plusClaims());
    const [header, payload, signature] = token.split(".");
    // The decoder skips these characters instead of throwing, so each segment
    // must still be rejected downstream by JSON parsing or ES256 verification.
    expect(await verify(`!!!!.${payload}.${signature}`, { publicKeys })).toBeNull();
    expect(await verify(`${header}.!!!!.${signature}`, { publicKeys })).toBeNull();
    expect(await verify(`${header}.${payload}.!!!!`, { publicKeys })).toBeNull();
  });

  it("verifies a token whose segments use the base64url-only '-' and '_' characters", async () => {
    // U+07FF encodes to base64 indices 62 and 63, which base64url spells "-" and
    // "_". A decoder handling only the standard alphabet drops both, corrupting
    // the bytes and silently rejecting a valid license.
    const userId = `${USER_ID}\u07ff\u07ff`;
    const token = await signToken(keyPair.privateKey, plusClaims({ user_id: userId }));
    const payloadSegment = token.split(".")[1];
    expect(payloadSegment).toContain("-");
    expect(payloadSegment).toContain("_");
    expect((await verify(token, { publicKeys }))?.user_id).toBe(userId);
  });

  it("verifies tokens whose unpadded segments cover every base64 remainder length", async () => {
    // base64url segments carry no padding, so each byte length mod 3 produces a
    // different implied-padding case; a decoder mishandling one would reject
    // otherwise-valid licenses.
    const remainders = new Set<number>();
    for (const filler of ["", "x", "xx"]) {
      const token = await signToken(keyPair.privateKey, plusClaims({ user_id: USER_ID + filler }));
      expect(await verify(token, { publicKeys })).not.toBeNull();
      remainders.add(token.split(".")[1].length % 4);
    }
    // Guard the premise: the three fillers must land on distinct remainders.
    expect(remainders.size).toBe(3);
  });
});
