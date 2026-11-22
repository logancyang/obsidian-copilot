import { SignInAction, type SignInActionProps } from "./SignInAction";
import type { Meta, StoryObj } from "@/lib/story";
const meta = {
  title: "Agent Mode/Sign In Action",
  component: SignInAction,
  args: {
    status: { signedIn: false },
    onSignIn: () => undefined,
    signingIn: false,
    url: null,
    onCancel: () => undefined,
  },
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<SignInActionProps>;
export default meta;
export const SignedOut: StoryObj<SignInActionProps> = {};
export const Checking: StoryObj<SignInActionProps> = { args: { status: null } };
export const Waiting: StoryObj<SignInActionProps> = { args: { signingIn: true } };
export const BrowserFallback: StoryObj<SignInActionProps> = {
  args: { signingIn: true, url: "https://auth.openai.com/authorize" },
};
export const Retry: StoryObj<SignInActionProps> = { args: { failed: true } };
export const SignedIn: StoryObj<SignInActionProps> = { args: { status: { signedIn: true } } };
