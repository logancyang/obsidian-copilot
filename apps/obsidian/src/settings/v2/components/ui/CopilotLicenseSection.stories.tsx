import type { AccountProfile, CopilotAccountState } from "@/copilotAccount/copilotAccount";
import type { AccountControlProps } from "@/copilotAccount/ui/AccountControl";
import type { Meta, StoryObj } from "@/lib/story";
import { CopilotLicenseSection, type CopilotLicenseSectionProps } from "./CopilotLicenseSection";

const PROFILE: AccountProfile = {
  email: "you@example.com",
  name: "Your Name",
  plan: "free",
};

const USAGE_WINDOWS = [
  { id: "five_hour", label: "5h", percent: 12 },
  { id: "weekly", label: "Weekly", percent: 34 },
];

function account(state: CopilotAccountState, defaultMenuOpen?: boolean): AccountControlProps {
  return {
    state,
    onSignIn: () => {},
    onOpenSignInPage: () => {},
    onCancelSignIn: () => {},
    onRefreshPlan: () => {},
    onSignOut: () => {},
    defaultMenuOpen,
  };
}

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
    account: account({ status: "signed-out", failure: null }),
    onDismissDiscordInvite: () => {},
  },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<CopilotLicenseSectionProps>;
export default meta;

export const NoLicense: StoryObj<CopilotLicenseSectionProps> = {};

export const SigningIn: StoryObj<CopilotLicenseSectionProps> = {
  args: { account: account({ status: "signing-in" }) },
};

export const SignInFailed: StoryObj<CopilotLicenseSectionProps> = {
  args: { account: account({ status: "signed-out", failure: "timed-out" }) },
};

export const SignedInFree: StoryObj<CopilotLicenseSectionProps> = {
  args: { account: account({ status: "signed-in", profile: PROFILE, notice: null }) },
};

export const DiscordInviteDismissed: StoryObj<CopilotLicenseSectionProps> = {
  args: {
    account: account({ status: "signed-in", profile: PROFILE, notice: null }),
    onDismissDiscordInvite: null,
  },
};

export const SignedInPaid: StoryObj<CopilotLicenseSectionProps> = {
  args: {
    license: { status: "active", plan: "plus" },
    usageWindows: USAGE_WINDOWS,
    onRemoveLicense: null,
    account: account({ status: "signed-in", profile: { ...PROFILE, plan: "plus" }, notice: null }),
  },
};

export const JustUpgraded: StoryObj<CopilotLicenseSectionProps> = {
  args: {
    license: { status: "active", plan: "plus" },
    usageWindows: USAGE_WINDOWS,
    onRemoveLicense: null,
    account: account({
      status: "signed-in",
      profile: { ...PROFILE, plan: "plus" },
      notice: { kind: "applied", plan: "plus" },
    }),
  },
};

export const PlanEnded: StoryObj<CopilotLicenseSectionProps> = {
  args: {
    account: account({
      status: "signed-in",
      profile: PROFILE,
      notice: { kind: "ended", plan: "plus" },
    }),
  },
};

export const ProfileMenuOpen: StoryObj<CopilotLicenseSectionProps> = {
  args: {
    license: { status: "active", plan: "plus" },
    usageWindows: USAGE_WINDOWS,
    onRemoveLicense: null,
    account: account(
      { status: "signed-in", profile: { ...PROFILE, plan: "plus" }, notice: null },
      true
    ),
  },
};

export const LicenseKeyAppliedWithUsage: StoryObj<CopilotLicenseSectionProps> = {
  args: { license: { status: "active", plan: "plus" }, usageWindows: USAGE_WINDOWS },
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
