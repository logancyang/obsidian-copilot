import type { ModelManagementApi, ProviderCredentialReconciliationResult } from "@/modelManagement";
import { runSettingsMigrations } from "@/settings/migrations";

import { prepareProviderStartup } from "./providerStartup";

jest.mock("@/settings/migrations", () => ({
  runSettingsMigrations: jest.fn(),
}));

const mockRunSettingsMigrations = runSettingsMigrations as jest.MockedFunction<
  typeof runSettingsMigrations
>;

describe("providerStartup", () => {
  describe("prepareProviderStartup()", () => {
    it("awaits versioned name migration before credential reconciliation", async () => {
      const order: string[] = [];
      const result: ProviderCredentialReconciliationResult = {
        migrated: 1,
        repointed: 1,
        deleted: 1,
        conflicts: 0,
        failures: [],
        unavailable: false,
      };
      mockRunSettingsMigrations.mockImplementation(async () => {
        order.push("settings");
      });
      const reconcileCredentials = jest.fn(async () => {
        order.push("credentials");
        return result;
      });
      const api = { providerRegistry: { reconcileCredentials } } as unknown as ModelManagementApi;

      await expect(prepareProviderStartup(api)).resolves.toBe(result);
      expect(order).toEqual(["settings", "credentials"]);
    });

    it("still reconciles credentials when the versioned runner is a no-op", async () => {
      mockRunSettingsMigrations.mockResolvedValue();
      const reconcileCredentials = jest.fn(async () => ({
        migrated: 0,
        repointed: 0,
        deleted: 0,
        conflicts: 0,
        failures: [],
        unavailable: false,
      }));
      const api = { providerRegistry: { reconcileCredentials } } as unknown as ModelManagementApi;

      await prepareProviderStartup(api);

      expect(reconcileCredentials).toHaveBeenCalledTimes(1);
    });
  });
});
