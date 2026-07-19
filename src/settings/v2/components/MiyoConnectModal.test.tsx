import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { MiyoConnectContent } from "./MiyoConnectModal";

// Mock miyoUtils to avoid pulling the miyoStatusStore/settings dependency chain
// into this presentational test; only the deeplink constants are needed here.
jest.mock("@/miyo/miyoUtils", () => ({
  MIYO_DEEPLINK_URL: "miyo://",
  MIYO_ADD_FOLDER_DEEPLINK_URL: "miyo://add-folder",
}));

// The module imports `App`/`Modal` from obsidian at load; stub them so the file
// evaluates. We only exercise the presentational MiyoConnectContent.
jest.mock("obsidian", () => ({
  App: class {},
  Modal: class {},
}));

describe("MiyoConnectContent", () => {
  const noop = () => undefined;
  const noopAdd = async () => "added" as const;

  it("renders the guide step with a working Retry/Cancel", () => {
    const onRetry = jest.fn();
    const onClose = jest.fn();
    render(
      <MiyoConnectContent
        step="guide"
        downloadUrl="https://example.com"
        canAutoAdd
        onClose={onClose}
        onRetry={onRetry}
        onAddVault={noopAdd}
      />
    );

    expect(screen.getByText("Miyo isn't running")).toBeTruthy();
    fireEvent.click(screen.getByText("Retry connection"));
    expect(onRetry).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders the addVault step with the register heading + one-click button", () => {
    const onRetry = jest.fn();
    render(
      <MiyoConnectContent
        step="addVault"
        downloadUrl="https://example.com"
        canAutoAdd
        onClose={noop}
        onRetry={onRetry}
        onAddVault={noopAdd}
      />
    );

    expect(screen.getByText("Register this vault with Miyo")).toBeTruthy();
    expect(screen.getByText("Register & connect")).toBeTruthy();
    // One-click local flow has no Retry (nothing to re-probe on a direct POST).
    expect(screen.queryByText("Retry")).toBeNull();
  });

  it("one-click registers when canAutoAdd (local Miyo)", async () => {
    const onAddVault = jest.fn(async () => "added" as const);
    render(
      <MiyoConnectContent
        step="addVault"
        downloadUrl="https://example.com"
        canAutoAdd
        onClose={noop}
        onRetry={jest.fn()}
        onAddVault={onAddVault}
      />
    );

    // The primary button registers directly rather than opening Miyo.
    fireEvent.click(screen.getByText("Register & connect"));
    await waitFor(() => expect(onAddVault).toHaveBeenCalledTimes(1));
  });

  it("surfaces an error and stays put when registration fails", async () => {
    const onAddVault = jest.fn(async () => "error" as const);
    render(
      <MiyoConnectContent
        step="addVault"
        downloadUrl="https://example.com"
        canAutoAdd
        onClose={noop}
        onRetry={jest.fn()}
        onAddVault={onAddVault}
      />
    );

    fireEvent.click(screen.getByText("Register & connect"));
    await waitFor(() => expect(screen.getByText(/Couldn't register this vault/i)).toBeTruthy());
  });

  it("falls back to the add-folder deeplink + Retry when it can't one-click (remote/mobile)", () => {
    const openSpy = jest.spyOn(window, "open").mockImplementation(() => null);
    render(
      <MiyoConnectContent
        step="addVault"
        downloadUrl="https://example.com"
        canAutoAdd={false}
        onClose={noop}
        onRetry={jest.fn()}
        onAddVault={noopAdd}
      />
    );

    // No one-click button; the deeplink "Open Miyo" + Retry are shown instead.
    expect(screen.queryByText("Register & connect")).toBeNull();
    expect(screen.getByText("Retry")).toBeTruthy();
    // The fallback must drop the user onto Miyo's add-folder flow, not the generic
    // launch, so a remote/mobile user lands where they can register the vault.
    fireEvent.click(screen.getByText("Open Miyo"));
    expect(openSpy).toHaveBeenCalledWith("miyo://add-folder", "_blank");
    openSpy.mockRestore();
  });

  it("does not show the register-failed message when the folder registered but Miyo is unreachable", async () => {
    // A POST that succeeds but can't be confirmed resolves "unreachable", not
    // "error": the folder IS registered, so claiming "couldn't register" would
    // contradict the server. The hosting modal routes this to the guide step.
    const onAddVault = jest.fn(async () => "unreachable" as const);
    render(
      <MiyoConnectContent
        step="addVault"
        downloadUrl="https://example.com"
        canAutoAdd
        onClose={noop}
        onRetry={jest.fn()}
        onAddVault={onAddVault}
      />
    );

    fireEvent.click(screen.getByText("Register & connect"));
    await waitFor(() => expect(onAddVault).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/Couldn't register this vault/i)).toBeNull();
  });
});
