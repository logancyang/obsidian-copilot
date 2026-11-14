import type { Meta, StoryObj } from "@/lib/story";
import { CopilotLicenseSection, type CopilotLicenseSectionProps } from "./CopilotLicenseSection";

const meta = {
  title: "Settings/Copilot License Section",
  component: CopilotLicenseSection,
  args: {
    license: { status: "none" },
    licenseKey: "",
    onLicenseKeyChange: () => {},
    isApplying: false,
    onApply: () => {},
    applyError: null,
    onSeePlans: () => {},
    usageWindows: null,
    onRemoveLicense: () => {},
  },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<CopilotLicenseSectionProps>;
export default meta;

export const NoLicense: StoryObj<CopilotLicenseSectionProps> = {};

export const LicenseKeyAppliedWithUsage: StoryObj<CopilotLicenseSectionProps> = {
  args: {
    license: { status: "active", plan: "plus" },
    usageWindows: [
      { id: "five_hour", label: "5h", percent: 12 },
      { id: "weekly", label: "Weekly", percent: 34 },
    ],
  },
};

export const LicenseKeyAppliedUsageUnavailable: StoryObj<CopilotLicenseSectionProps> = {
  args: { license: { status: "active", plan: "plus" }, usageWindows: null },
};

export const InvalidKey: StoryObj<CopilotLicenseSectionProps> = {
  args: {
    license: { status: "inactive" },
    licenseKey: "lapsed-license-key",
    applyError: "Invalid license key",
  },
};
