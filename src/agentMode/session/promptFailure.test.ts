import { err2String } from "@/utils";
import { buildEmptyTurnMessage, formatPromptFailure } from "./promptFailure";

describe("promptFailure", () => {
  describe("buildEmptyTurnMessage()", () => {
    it("names the agent and stop reason of a turn that returned nothing, and suggests a retry", () => {
      expect(buildEmptyTurnMessage("opencode", "end_turn")).toBe(
        "opencode finished the turn without returning any assistant text or tool activity (stop reason: end_turn). Try again, or switch models if this repeats."
      );
    });
  });

  describe("formatPromptFailure()", () => {
    it("returns the error's own message when it carries no provider error", () => {
      expect(formatPromptFailure(new Error("socket closed"))).toBe("socket closed");
    });

    it("appends the provider error type and message found under the error's cause", () => {
      const error = Object.assign(new Error("stream error"), {
        cause: { data: { error: { type: "RateLimitError", message: "Try again later." } } },
      });

      const failure = formatPromptFailure(error);

      expect(failure.startsWith("stream error")).toBe(true);
      expect(failure.endsWith("\nRateLimitError: Try again later.")).toBe(true);
    });

    it("reads a provider error serialized as JSON inside a message field", () => {
      const error = Object.assign(new Error("Internal error"), {
        data: {
          message: JSON.stringify({
            error: { type: "invalid_request_error", message: "Upgrade Codex." },
          }),
        },
      });

      expect(formatPromptFailure(error)).toBe(
        "Internal error\ninvalid_request_error: Upgrade Codex."
      );
    });

    it("finds a provider error in an errors list", () => {
      const error = Object.assign(new Error("failed"), {
        errors: [{ note: "unrelated" }, { error: { message: "quota exhausted" } }],
      });

      expect(formatPromptFailure(error)).toBe("failed\nProviderError: quota exhausted");
    });

    it("reports only the provider error type when the provider sent no message", () => {
      const error = Object.assign(new Error("failed"), { error: { type: "Overloaded" } });

      expect(formatPromptFailure(error)).toBe("failed\nOverloaded");
    });

    it("does not repeat a provider error the error's message already contains", () => {
      const error = Object.assign(new Error("Overloaded: busy"), {
        error: { type: "Overloaded", message: "busy" },
      });

      expect(formatPromptFailure(error)).toBe("Overloaded: busy");
    });

    it("stops searching an error whose cause points back at itself", () => {
      const error = new Error("loop") as Error & { cause?: unknown };
      error.cause = error;

      expect(formatPromptFailure(error)).toBe(err2String(error));
    });
  });
});
