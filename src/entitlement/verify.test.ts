import type { EntitlementClaims } from "./types";
import { verifyEntitlement } from "./verify";

const KID = "test-key";
const USER_ID = "user-123";

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
  const signature = await crypto.subtle.sign(
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
    keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ]);
    publicKeys = { [KID]: await crypto.subtle.exportKey("jwk", keyPair.publicKey) };
  });

  it("returns claims for a valid, correctly-signed token", async () => {
    const token = await signToken(keyPair.privateKey, plusClaims());
    const claims = await verifyEntitlement(token, { publicKeys, expectedUserId: USER_ID });
    expect(claims).not.toBeNull();
    expect(claims?.tier).toBe("plus");
    expect(claims?.features).toContain("multi_agent");
  });

  it("returns Lite claims without the multi_agent feature", async () => {
    const token = await signToken(
      keyPair.privateKey,
      plusClaims({ plan: "lite", tier: "lite", features: [] })
    );
    const claims = await verifyEntitlement(token, { publicKeys });
    expect(claims?.tier).toBe("lite");
    expect(claims?.features).not.toContain("multi_agent");
  });

  it("rejects an expired token", async () => {
    const token = await signToken(
      keyPair.privateKey,
      plusClaims({ exp: Math.floor(Date.UTC(2020, 0, 1) / 1000) })
    );
    expect(await verifyEntitlement(token, { publicKeys })).toBeNull();
  });

  it("rejects a token whose user_id does not match the local user", async () => {
    const token = await signToken(keyPair.privateKey, plusClaims());
    expect(
      await verifyEntitlement(token, { publicKeys, expectedUserId: "someone-else" })
    ).toBeNull();
  });

  it("rejects a token signed by an unknown key (kid not in the trust set)", async () => {
    const otherPair = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"]
    );
    const token = await signToken(otherPair.privateKey, plusClaims());
    expect(await verifyEntitlement(token, { publicKeys })).toBeNull();
  });

  it("rejects a token whose payload was tampered with after signing", async () => {
    const token = await signToken(keyPair.privateKey, plusClaims({ tier: "lite", features: [] }));
    const [header, , signature] = token.split(".");
    const forgedPayload = base64UrlEncode(
      JSON.stringify(plusClaims({ tier: "pro", features: ["multi_agent"] }))
    );
    const forged = `${header}.${forgedPayload}.${signature}`;
    expect(await verifyEntitlement(forged, { publicKeys })).toBeNull();
  });

  it("rejects a non-ES256 algorithm", async () => {
    const token = await signToken(keyPair.privateKey, plusClaims(), {
      alg: "none",
      typ: "JWT",
      kid: KID,
    });
    expect(await verifyEntitlement(token, { publicKeys })).toBeNull();
  });

  it("rejects malformed tokens and the empty string", async () => {
    expect(await verifyEntitlement("", { publicKeys })).toBeNull();
    expect(await verifyEntitlement("not-a-jwt", { publicKeys })).toBeNull();
    expect(await verifyEntitlement("only.two", { publicKeys })).toBeNull();
  });
});
