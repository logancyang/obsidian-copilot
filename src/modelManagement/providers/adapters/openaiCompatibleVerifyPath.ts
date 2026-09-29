export type VerifyPath = "models" | "key";

const DEFAULT_VERIFY_PATH: VerifyPath = "models";

const VERIFY_PATH_BY_CATALOG_ID: Record<string, VerifyPath> = {
  openrouter: "key",
};

export function verifyPathForCatalogProviderId(catalogProviderId: string | undefined): VerifyPath {
  if (!catalogProviderId) return DEFAULT_VERIFY_PATH;
  return VERIFY_PATH_BY_CATALOG_ID[catalogProviderId] ?? DEFAULT_VERIFY_PATH;
}
