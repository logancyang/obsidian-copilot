import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { RemoteClientPanel, type PairedDesktopView } from "@/remote/ui/RemoteClientPanel";

const DESKTOPS: PairedDesktopView[] = [
  { id: "a", desktopName: "Studio Mac", vaultName: "Work notes", address: "100.64.0.7:52341" },
  { id: "b", desktopName: "Laptop", vaultName: "", address: "100.64.0.9:50001" },
];

function renderPanel(overrides: Partial<React.ComponentProps<typeof RemoteClientPanel>> = {}) {
  const props = {
    desktops: [] as readonly PairedDesktopView[],
    onPairFromLink: jest.fn().mockResolvedValue("Paired with Studio Mac."),
    onTestConnection: jest.fn().mockResolvedValue("Connected to Studio Mac."),
    onRemove: jest.fn(),
    ...overrides,
  };
  render(<RemoteClientPanel {...props} />);
  return props;
}

describe("RemoteClientPanel", () => {
  describe("RemoteClientPanel()", () => {
    describe("pasting a pairing link", () => {
      it("keeps Pair disabled until a link is entered", () => {
        renderPanel();

        expect(screen.getByRole<HTMLButtonElement>("button", { name: "Pair" }).disabled).toBe(true);
      });

      it("hands the pasted link to the pairing action and shows the result", async () => {
        const props = renderPanel();

        fireEvent.change(screen.getByLabelText("Pairing link"), {
          target: { value: "obsidian://copilot-pair?host=100.64.0.7" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Pair" }));

        expect(props.onPairFromLink).toHaveBeenCalledWith(
          "obsidian://copilot-pair?host=100.64.0.7"
        );
        expect((await screen.findByRole("status")).textContent).toBe("Paired with Studio Mac.");
      });

      it("clears the field after a pairing attempt", async () => {
        renderPanel();
        const field = screen.getByLabelText<HTMLInputElement>("Pairing link");

        fireEvent.change(field, { target: { value: "obsidian://copilot-pair?x" } });
        fireEvent.click(screen.getByRole("button", { name: "Pair" }));

        await waitFor(() => expect(field.value).toBe(""));
      });

      it("shows a failure message the same way as a success", async () => {
        renderPanel({ onPairFromLink: jest.fn().mockResolvedValue("Can't reach your desktop.") });

        fireEvent.change(screen.getByLabelText("Pairing link"), { target: { value: "x" } });
        fireEvent.click(screen.getByRole("button", { name: "Pair" }));

        expect((await screen.findByRole("status")).textContent).toBe("Can't reach your desktop.");
      });
    });

    describe("paired desktops", () => {
      it("says no desktops are paired when the list is empty", () => {
        renderPanel();

        expect(screen.getByText("No desktops are paired for this vault.")).toBeTruthy();
      });

      it("lists each desktop with its vault and address", () => {
        renderPanel({ desktops: DESKTOPS });

        expect(screen.getByText("Studio Mac")).toBeTruthy();
        expect(screen.getByText(/Work notes at/)).toBeTruthy();
        expect(screen.getByText(/100\.64\.0\.9:50001/)).toBeTruthy();
      });

      it("removes the desktop whose button was clicked", () => {
        const props = renderPanel({ desktops: DESKTOPS });

        fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[1]);

        expect(props.onRemove).toHaveBeenCalledWith("b");
      });

      it("notes that removing only forgets the desktop on this phone", () => {
        renderPanel({ desktops: DESKTOPS });

        expect(screen.getByText(/only forgets it on this phone/)).toBeTruthy();
      });

      it("tests the connection of the desktop whose button was clicked and shows the result beneath it", async () => {
        const props = renderPanel({ desktops: DESKTOPS });

        fireEvent.click(screen.getAllByRole("button", { name: "Test connection" })[0]);

        expect(props.onTestConnection).toHaveBeenCalledWith("a");
        expect((await screen.findByText("Connected to Studio Mac.")).getAttribute("role")).toBe(
          "status"
        );
      });
    });
  });
});
