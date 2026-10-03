import { createCompanionDescriptor } from "@/agentMode/backends/shared/companionDescriptor";

export const GrokBackendDescriptor = createCompanionDescriptor({
  id: "grok",
  displayName: "Grok",
  binaryName: "grok",
  installerBaseUrl: "https://x.ai/cli/install",
  loginArgs: ["login"],
  skillsProjectDir: ".grok/skills",
});
