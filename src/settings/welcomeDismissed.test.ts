import { DEFAULT_SETTINGS } from "@/constants";
import { sanitizeSettings, type CopilotSettings } from "@/settings/model";

describe("sanitizeSettings - agentMode.welcomeDismissed", () => {
  it("defaults to false when absent", () => {
    const sanitized = sanitizeSettings({
      ...DEFAULT_SETTINGS,
      agentMode: { byok: {}, mcpServers: [] } as unknown as CopilotSettings["agentMode"],
    });
    expect(sanitized.agentMode.welcomeDismissed).toBe(false);
  });

  it("carries a persisted true through sanitize", () => {
    const sanitized = sanitizeSettings({
      ...DEFAULT_SETTINGS,
      agentMode: {
        byok: {},
        mcpServers: [],
        welcomeDismissed: true,
      } as unknown as CopilotSettings["agentMode"],
    });
    expect(sanitized.agentMode.welcomeDismissed).toBe(true);
  });

  it("ignores non-boolean values, falling back to the default", () => {
    const sanitized = sanitizeSettings({
      ...DEFAULT_SETTINGS,
      agentMode: {
        byok: {},
        mcpServers: [],
        welcomeDismissed: "yes",
      } as unknown as CopilotSettings["agentMode"],
    });
    expect(sanitized.agentMode.welcomeDismissed).toBe(false);
  });

  it("ships a false default in DEFAULT_SETTINGS", () => {
    expect(DEFAULT_SETTINGS.agentMode.welcomeDismissed).toBe(false);
  });
});
