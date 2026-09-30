import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { SignInAction } from "./SignInAction";
const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/379";
describe("SignInAction", () => {
  describe("SignInAction()", () => {
    it(`offers browser fallback and cancellation while waiting: ${ISSUE}`, () => {
      const onCancel = jest.fn();
      render(
        <SignInAction
          status={{ signedIn: false }}
          signingIn
          url="https://auth.openai.com/authorize"
          onSignIn={jest.fn()}
          onCancel={onCancel}
        />
      );
      expect(screen.getByRole("link", { name: "Open sign-in page" }).getAttribute("href")).toBe(
        "https://auth.openai.com/authorize"
      );
      fireEvent.click(screen.getByRole("button", { name: "Cancel sign-in" }));
      expect(onCancel).toHaveBeenCalled();
    });
    it("disables the button while a sign-in is running without a fallback link", () => {
      render(
        <SignInAction status={{ signedIn: false }} signingIn url={null} onSignIn={jest.fn()} />
      );
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "Signing in…" }).disabled).toBe(
        true
      );
    });
    it("disables the button until the initial sign-in status is known", () => {
      render(<SignInAction status={null} signingIn={false} url={null} onSignIn={jest.fn()} />);
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "Checking sign-in…" }).disabled
      ).toBe(true);
    });
    it(`offers Retry after failure and confirms authoritative success: ${ISSUE}`, () => {
      const onSignIn = jest.fn();
      const { rerender } = render(
        <SignInAction
          status={{ signedIn: false }}
          signingIn={false}
          url={null}
          onSignIn={onSignIn}
          failed
        />
      );
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(onSignIn).toHaveBeenCalled();
      rerender(
        <SignInAction
          status={{ signedIn: true }}
          signingIn={false}
          url={null}
          onSignIn={onSignIn}
        />
      );
      expect(screen.getByText("Signed in.")).toBeTruthy();
      expect(screen.queryByRole("button")).toBeNull();
    });
  });
});
