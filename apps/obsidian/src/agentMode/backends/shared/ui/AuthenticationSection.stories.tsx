import {
  AuthenticationSection,
  type AuthenticationState,
} from "@/agentMode/backends/shared/ui/AuthenticationSection";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

const AUTH: AuthenticationState = {
  status: { signedIn: false },
  signingIn: false,
  signingOut: false,
  url: null,
  terminalCommand: "claude auth login --claudeai",
  onSignIn: () => undefined,
  onSignOut: () => undefined,
};
const meta = {
  title: "Agent Mode/Authentication",
  component: AuthenticationSection,
  args: {
    ready: true,
    unavailableMessage: "Set up the agent above to enable sign-in.",
    auth: AUTH,
  },
} satisfies Meta<React.ComponentProps<typeof AuthenticationSection>>;
export default meta;
type Story = StoryObj<React.ComponentProps<typeof AuthenticationSection>>;
export const SignedOut: Story = {};
export const Checking: Story = { args: { auth: { ...AUTH, status: null } } };
export const SignedIn: Story = {
  args: { auth: { ...AUTH, status: { signedIn: true, label: "zero@example.com" } } },
};
export const SigningOut: Story = {
  args: {
    auth: { ...AUTH, status: { signedIn: true, label: "zero@example.com" }, signingOut: true },
  },
};
export const SignOutFailed: Story = {
  args: { auth: { ...AUTH, status: { signedIn: true, label: "zero@example.com" }, failed: true } },
};
export const Unavailable: Story = { args: { ready: false } };
