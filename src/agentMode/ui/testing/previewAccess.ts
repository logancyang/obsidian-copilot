import { verifyEntitlement, type EntitlementFeature } from "@/entitlement";
import { applyEntitlement, verifyCachedEntitlement } from "@/plusUtils";
import { setSettings } from "@/settings/model";

export type PreviewAccess = "believer" | "plus-without-preview" | "free" | "unverified";

const STORED_TOKEN = "stored-entitlement-token";

function mockSignedClaims(features: EntitlementFeature[]): void {
  jest.mocked(verifyEntitlement).mockResolvedValue({
    user_id: "user-1",
    plan: "believer",
    tier: "plus",
    features,
    iat: 0,
    exp: 9_999_999_999,
  });
}

export async function setPreviewAccess(access: PreviewAccess): Promise<void> {
  setSettings({ userId: "user-1", plusLicenseKey: "license-key", entitlementToken: "" });
  await verifyCachedEntitlement();
  if (access === "free") return;
  mockSignedClaims(
    access === "plus-without-preview" ? ["multi_agent"] : ["multi_agent", "preview"]
  );
  setSettings({ entitlementToken: STORED_TOKEN });
  if (access === "unverified") return;
  await verifyCachedEntitlement();
}

export async function verifyStoredToken(grantsPreview: boolean): Promise<void> {
  mockSignedClaims(grantsPreview ? ["multi_agent", "preview"] : ["multi_agent"]);
  await verifyCachedEntitlement();
}

export async function applyLicenseWithPreview(): Promise<void> {
  mockSignedClaims(["multi_agent", "preview"]);
  await applyEntitlement("license-entitlement-token");
}
