import { render, screen } from "@testing-library/react";
import React from "react";
import { PairingConfirmContent } from "@/remote/ui/PairingConfirmContent";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/610";

const details = {
  desktopName: "Studio Mac",
  address: "100.64.0.7:52341",
  linkVaultName: "Work notes",
  openVaultName: "Work notes",
};

describe("PairingConfirmContent", () => {
  it(`shows the desktop's name, its address and the vault open on this phone (${ISSUE})`, () => {
    render(<PairingConfirmContent details={details} />);

    expect(screen.getByText("Studio Mac")).toBeTruthy();
    expect(screen.getByText("100.64.0.7:52341")).toBeTruthy();
    expect(screen.getByText("Vault open here").nextElementSibling?.textContent).toBe("Work notes");
  });

  it(`shows the vault the link names only when it differs from the open vault (${ISSUE})`, () => {
    const { rerender } = render(<PairingConfirmContent details={details} />);
    expect(screen.queryByText("Vault in the link")).toBeNull();

    rerender(<PairingConfirmContent details={{ ...details, linkVaultName: "Personal journal" }} />);

    expect(screen.getByText("Vault in the link").nextElementSibling?.textContent).toBe(
      "Personal journal"
    );
  });

  it(`says the desktop is unnamed when the link carries no name (${ISSUE})`, () => {
    render(<PairingConfirmContent details={{ ...details, desktopName: "" }} />);

    expect(screen.getByText("Unnamed desktop")).toBeTruthy();
  });

  it(`tells the person to continue only after scanning their own computer's code (${ISSUE})`, () => {
    render(<PairingConfirmContent details={details} />);

    expect(screen.getByText(/only if you just scanned this code/i)).toBeTruthy();
  });
});
