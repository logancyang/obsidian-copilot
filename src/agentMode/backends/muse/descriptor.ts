import { createCompanionDescriptor } from "@/agentMode/backends/shared/companionDescriptor";

export const MuseBackendDescriptor = createCompanionDescriptor({
  id: "muse",
  displayName: "Muse Code",
  binaryName: "muse",
  installerBaseUrl: "https://dev.meta.ai/install",
  loginArgs: ["login"],
  skillsProjectDir: ".agents/skills",
});
