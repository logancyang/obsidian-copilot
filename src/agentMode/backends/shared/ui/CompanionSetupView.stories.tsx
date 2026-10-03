import type { Meta, StoryObj } from "@/lib/story";
import { CompanionSetupView, type CompanionSetupViewProps } from "./CompanionSetupView";

const meta = {
  title: "Settings/Companion Setup",
  component: CompanionSetupView,
  args: {
    displayName: "Grok",
    binaryPath: "",
    busy: false,
    output: "",
    consent: false,
    onInstall: () => {},
    onCheck: () => {},
    onSignIn: () => {},
    onSavePath: async () => {},
    onConsent: () => {},
  },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<CompanionSetupViewProps>;
export default meta;
export const MissingCli: StoryObj<CompanionSetupViewProps> = {};
export const Installed: StoryObj<CompanionSetupViewProps> = {
  args: { binaryPath: "C:\\Users\\Companion User\\.grok\\bin\\grok.exe" },
};
export const Installing: StoryObj<CompanionSetupViewProps> = {
  args: { busy: true, output: "Downloading the official CLI…" },
};
export const Failed: StoryObj<CompanionSetupViewProps> = {
  args: { output: "Installation failed. Your existing CLI is still configured." },
};
export const AutomaticToolsConsent: StoryObj<CompanionSetupViewProps> = {
  args: { displayName: "Antigravity (Gemini)", automaticTools: true },
};
export const AutomaticToolsEnabled: StoryObj<CompanionSetupViewProps> = {
  args: { displayName: "Antigravity (Gemini)", automaticTools: true, consent: true },
};
