import type { Provider, ProviderOrigin } from "@/modelManagement/types/persisted";
import { providerNeedsSelfHostWarning } from "./selfHostPolicy";

function provider(origin: ProviderOrigin, baseUrl?: string): Provider {
  return {
    providerId: "p1",
    providerType: "openai-compatible",
    displayName: "Test",
    baseUrl,
    origin,
    addedAt: 0,
  };
}

const CLOUD_BYOK = provider({ kind: "byok" }, "https://api.openai.com/v1");
const LOCAL_BYOK = provider({ kind: "byok" }, "http://localhost:11434/v1");
const PLUS = provider({ kind: "copilot-plus" });
const AGENT = provider({ kind: "agent", agentType: "claude" });

describe("providerNeedsSelfHostWarning", () => {
  it("never warns when Self-Host Mode is off", () => {
    const off = { enableSelfHostMode: false };
    for (const p of [CLOUD_BYOK, LOCAL_BYOK, PLUS, AGENT]) {
      expect(providerNeedsSelfHostWarning(p, off)).toBe(false);
    }
  });

  describe("when Self-Host Mode is on", () => {
    const on = { enableSelfHostMode: true };

    it("warns on copilot-plus providers", () => {
      expect(providerNeedsSelfHostWarning(PLUS, on)).toBe(true);
    });

    it("warns on cloud BYOK but not self-hosted BYOK", () => {
      expect(providerNeedsSelfHostWarning(CLOUD_BYOK, on)).toBe(true);
      expect(providerNeedsSelfHostWarning(LOCAL_BYOK, on)).toBe(false);
    });

    it("does not warn on agent-origin providers (flagged at the descriptor level instead)", () => {
      expect(providerNeedsSelfHostWarning(AGENT, on)).toBe(false);
    });
  });
});
