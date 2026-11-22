import { verifyEntitlement, type EntitlementFeature } from "@/entitlement";
import { applyEntitlement, verifyCachedEntitlement } from "@/plusUtils";
import { setSettings } from "@/settings/model";

export type NavigatorAccess = "supporter" | "plus-without-navigator" | "free" | "unverified";

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

export async function setNavigatorAccess(access: NavigatorAccess): Promise<void> {
  setSettings({ userId: "user-1", plusLicenseKey: "license-key", entitlementToken: "" });
  await verifyCachedEntitlement();
  if (access === "free") return;
  mockSignedClaims(
    access === "plus-without-navigator" ? ["multi_agent"] : ["multi_agent", "navigator"]
  );
  setSettings({ entitlementToken: STORED_TOKEN });
  if (access === "unverified") return;
  await verifyCachedEntitlement();
}

export async function verifyStoredToken(grantsNavigator: boolean): Promise<void> {
  mockSignedClaims(grantsNavigator ? ["multi_agent", "navigator"] : ["multi_agent"]);
  await verifyCachedEntitlement();
}

export async function applyLicenseWithNavigator(): Promise<void> {
  mockSignedClaims(["multi_agent", "navigator"]);
  await applyEntitlement("license-entitlement-token");
}
