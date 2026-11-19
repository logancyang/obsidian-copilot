import { AgentFacePicker, readAsDataUrl } from "@/agents/ui/AgentFacePicker";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Notice } from "obsidian";
import React from "react";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/939";

function decodeImages(decodes: boolean) {
  Object.assign(window, {
    createImageBitmap: jest.fn(() =>
      decodes
        ? Promise.resolve({ close: jest.fn() })
        : Promise.reject(new DOMException("The source image could not be decoded."))
    ),
  });
}

describe("AgentFacePicker", () => {
  beforeEach(() => {
    decodeImages(true);
    jest.mocked(Notice).mockClear();
  });

  describe("AgentFacePicker()", () => {
    it("offers Upload image for png, jpg and webp files and hands back the chosen file with a preview", async () => {
      const onPick = jest.fn();
      const photo = new File(["webp bytes"], "kai.webp", { type: "image/webp" });
      render(<AgentFacePicker onPick={onPick} />);

      const input = screen.getByLabelText<HTMLInputElement>("Upload image");
      expect(input.accept).toBe("image/png,image/jpeg,image/webp");
      fireEvent.change(input, { target: { files: [photo] } });

      await waitFor(() =>
        expect(onPick).toHaveBeenCalledWith({
          image: { kind: "upload", image: photo },
          src: `data:image/webp;base64,${btoa("webp bytes")}`,
        })
      );
    });

    it(`keeps the current face and says why when the chosen file is not a readable image (${ISSUE})`, async () => {
      decodeImages(false);
      const onPick = jest.fn();
      render(<AgentFacePicker onPick={onPick} />);

      fireEvent.change(screen.getByLabelText("Upload image"), {
        target: { files: [new File(["%PDF-1.7"], "notes.png", { type: "image/png" })] },
      });

      await waitFor(() =>
        expect(Notice).toHaveBeenCalledWith(
          "Couldn't read that image. Choose a PNG, JPEG or WebP file."
        )
      );
      expect(onPick).not.toHaveBeenCalled();
    });

    it("opens the file chooser from the Upload image button", () => {
      render(<AgentFacePicker onPick={jest.fn()} />);
      const click = jest.spyOn(screen.getByLabelText("Upload image"), "click");

      fireEvent.click(screen.getByRole("button", { name: "Upload image" }));

      expect(click).toHaveBeenCalledTimes(1);
    });
  });

  describe("readAsDataUrl()", () => {
    it("turns an image into a data URL that keeps its type", async () => {
      const image = new Blob(["png"], { type: "image/png" });

      await expect(readAsDataUrl(image)).resolves.toBe(`data:image/png;base64,${btoa("png")}`);
    });
  });
});
