/**
 * Public keys that verify entitlement tokens, keyed by the token header's `kid`
 * so a new signing key can roll out before old tokens expire. These are PUBLIC
 * (verify-only) — safe to ship in open-source client code; they grant no power
 * to mint tokens. The matching private key signs tokens in `brevilabs-api`.
 *
 * To rotate: generate a new ES256 (P-256) pair, add the public JWK under a new
 * `kid` here while keeping the old one until its tokens expire, then point the
 * server at the new private key. See the "Copilot Entitlement Token Design" doc
 * and obsidian-copilot-preview#201.
 */
export const ENTITLEMENT_PUBLIC_KEYS: Record<string, JsonWebKey> = {
  "ent-2026-06": {
    kty: "EC",
    crv: "P-256",
    x: "9j3HVz0TWJ5VFMTiaNhExKQJAPWjduz2wdZpKAXIkzk",
    y: "ZA9ARslf7l1XUK5zL5Tgbm-eY-zxWaVLzQD7nTnId6Y",
  },
};
