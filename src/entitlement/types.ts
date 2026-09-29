export type EntitlementTier = "free" | "lite" | "plus" | "pro";

export type EntitlementFeature = "multi_agent" | "self_host";

export interface EntitlementClaims {
  user_id: string;
  plan: string;
  tier: EntitlementTier;
  features: EntitlementFeature[];
  iat: number;
  exp: number;
}
