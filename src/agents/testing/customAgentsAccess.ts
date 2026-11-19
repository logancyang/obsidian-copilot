import { verifyEntitlement, type EntitlementFeature } from "@/entitlement";
import { verifyCachedEntitlement } from "@/plusUtils";
import { setSettings } from "@/settings/model";

export type CustomAgentsAccess =
  | "team"
  | "plus-without-custom-agents"
  | "free"
  | "keyless"
  | "unverified";

const STORED_TOKEN = "stored-entitlement-token";

function mockSignedClaims(features: EntitlementFeature[]): void {
  jest.mocked(verifyEntitlement).mockResolvedValue({
    user_id: "user-1",
    plan: "supporter",
    tier: "plus",
    features,
    iat: 0,
    exp: 9_999_999_999,
  });
}

export async function setCustomAgentsAccess(access: CustomAgentsAccess): Promise<void> {
  setSettings({
    userId: "user-1",
    plusLicenseKey: access === "keyless" ? "" : "license-key",
    entitlementToken: "",
  });
  await verifyCachedEntitlement();
  if (access === "free" || access === "keyless") return;
  mockSignedClaims(
    access === "plus-without-custom-agents" ? ["multi_agent"] : ["multi_agent", "custom_agents"]
  );
  setSettings({ entitlementToken: STORED_TOKEN });
  if (access === "unverified") return;
  await verifyCachedEntitlement();
}

export async function verifyStoredToken(grantsCustomAgents: boolean): Promise<void> {
  mockSignedClaims(grantsCustomAgents ? ["multi_agent", "custom_agents"] : ["multi_agent"]);
  await verifyCachedEntitlement();
}
