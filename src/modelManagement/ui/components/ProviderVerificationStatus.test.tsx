import { render, screen } from "@testing-library/react";
import React from "react";
import {
  ProviderVerificationProgress,
  ProviderVerificationStatus,
} from "./ProviderVerificationStatus";
import type { VerificationResult } from "@/modelManagement/types/runtime";

const issue = "https://github.com/logancyang/obsidian-copilot/issues/3147";

describe("ProviderVerificationStatus", () => {
  describe("ProviderVerificationStatus()", () => {
    it.each<[VerificationResult | undefined, string]>([
      [undefined, "Checking…"],
      [{ ok: true, checkedAt: 0 }, "Verified"],
      [{ ok: false, code: "missing_api_key", checkedAt: 0 }, "No key"],
      [{ ok: false, code: "invalid_api_key", checkedAt: 0 }, "Invalid key"],
      [{ ok: false, code: "network", checkedAt: 0 }, "Check failed"],
      [{ ok: false, code: "rate_limited", checkedAt: 0 }, "Check failed"],
    ])(`renders the current result %p as %s (${issue})`, (result, label) => {
      render(<ProviderVerificationStatus result={result} />);
      expect(screen.getByText(label)).toBeTruthy();
    });

    it(`exposes the verification failure detail on the badge (${issue})`, () => {
      render(
        <ProviderVerificationStatus
          result={{ ok: false, message: "Could not reach provider", checkedAt: 0 }}
        />
      );
      expect(screen.getByTitle("Could not reach provider")).toBeTruthy();
    });
  });

  describe("ProviderVerificationProgress()", () => {
    it(`announces pending checks and disappears once they finish (${issue})`, () => {
      const { rerender } = render(<ProviderVerificationProgress pending={2} />);
      expect(screen.getByRole("status").textContent).toBe("Verifying providers…");
      rerender(<ProviderVerificationProgress pending={0} />);
      expect(screen.queryByRole("status")).toBeNull();
    });
  });
});
