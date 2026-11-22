import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { MiyoConnectContent } from "./MiyoConnectModal";

jest.mock("@/miyo/miyoUtils", () => ({
  MIYO_DEEPLINK_URL: "miyo://",
  MIYO_ADD_FOLDER_DEEPLINK_URL: "miyo://add-folder",
}));

jest.mock("obsidian", () => ({
  App: class {},
  Modal: class {},
}));

describe("MiyoConnectContent", () => {
  const noop = () => undefined;
  const noopAdd = async () => "added" as const;

  describe("MiyoConnectContent()", () => {
    it("opens the supplied download URL without dropping referral parameters", () => {
      const downloadUrl = "https://www.miyo.md/?utm_source=obsidian_copilot&utm_medium=connection";
      const openSpy = jest.spyOn(window, "open").mockImplementation(() => null);
      try {
        render(
          <MiyoConnectContent
            step="guide"
            downloadUrl={downloadUrl}
            canAutoAdd
            onClose={noop}
            onRetry={noop}
            onAddVault={noopAdd}
          />
        );
        fireEvent.click(screen.getByRole("button", { name: "Download Miyo" }));
        expect(openSpy).toHaveBeenCalledWith(downloadUrl, "_blank");
      } finally {
        openSpy.mockRestore();
      }
    });

    it("shows the guide step and wires Retry connection and Cancel to their callbacks", () => {
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

    it("shows the register heading and one-click button on the addVault step, without a Retry button", () => {
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
      expect(screen.queryByText("Retry")).toBeNull();
    });

    it("registers the vault with one click when canAutoAdd is true", async () => {
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

      fireEvent.click(screen.getByText("Register & connect"));
      await waitFor(() => expect(onAddVault).toHaveBeenCalledTimes(1));
    });

    it("shows a register-failed message when registration returns an error", async () => {
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

    it("offers the add-folder deeplink and Retry instead of one-click registration when canAutoAdd is false", () => {
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

      expect(screen.queryByText("Register & connect")).toBeNull();
      expect(screen.getByText("Retry")).toBeTruthy();
      fireEvent.click(screen.getByText("Open Miyo"));
      expect(openSpy).toHaveBeenCalledWith("miyo://add-folder", "_blank");
      openSpy.mockRestore();
    });

    it("shows no register-failed message when the folder registered but Miyo is unreachable", async () => {
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
});
