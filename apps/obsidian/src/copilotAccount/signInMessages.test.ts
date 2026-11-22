import { signInFailureMessage, type SignInFailure } from "@/copilotAccount/signInMessages";

describe("signInMessages", () => {
  describe("signInFailureMessage()", () => {
    it.each<[SignInFailure, string]>([
      ["cancelled", "Sign-in cancelled."],
      ["cancelled-on-service", "Sign-in was cancelled on the Copilot website."],
      ["timed-out", "Sign-in timed out. Try again when you're ready."],
      ["rejected", "The Copilot website didn't accept the sign-in. Try again."],
      ["unreachable", "Couldn't reach the Copilot website. Check your connection."],
    ])("says what happened when the sign-in ends as %s", (failure, message) => {
      expect(signInFailureMessage(failure)).toBe(message);
    });
  });
});
