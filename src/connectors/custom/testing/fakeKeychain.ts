export function fakeKeychain() {
  const secrets = new Map<string, string>();
  const keychain = {
    getVaultId: () => "testvault",
    getSecretById: (id: string) => secrets.get(id) ?? null,
    setSecretById: (id: string, value: string) => void secrets.set(id, value),
    deleteSecretById: (id: string) => void secrets.delete(id),
  };
  return { keychain, secrets };
}
