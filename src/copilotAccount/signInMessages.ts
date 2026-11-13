import type { LoginFailureReason } from "@/connectors/oauth/connectorAuth";

export type SignInFailure = LoginFailureReason | "cancelled";

export function signInFailureMessage(failure: SignInFailure): string {
  switch (failure) {
    case "cancelled":
      return "Sign-in cancelled.";
    case "cancelled-on-service":
      return "Sign-in was cancelled on the Copilot website.";
    case "timed-out":
      return "Sign-in timed out. Try again when you're ready.";
    case "rejected":
      return "The Copilot website didn't accept the sign-in. Try again.";
    case "unreachable":
      return "Couldn't reach the Copilot website. Check your connection.";
  }
}
