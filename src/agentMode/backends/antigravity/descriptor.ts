import { createCompanionDescriptor } from "@/agentMode/backends/shared/companionDescriptor";

export const AntigravityBackendDescriptor = createCompanionDescriptor({
  id: "antigravity",
  displayName: "Antigravity (Gemini)",
  binaryName: "agy",
  installerBaseUrl: "https://antigravity.google/cli/install",
  loginArgs: [],
  skillsProjectDir: ".agents/skills",
  automaticTools: true,
});
