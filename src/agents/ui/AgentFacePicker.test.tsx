import { AgentFacePicker, readAsDataUrl } from "@/agents/ui/AgentFacePicker";
import type { PresetFacesState } from "@/agents/ui/usePresetFaces";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Notice } from "obsidian";
import React from "react";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/939";

const COCO_BYTES = new Uint8Array([1]).buffer;
const KAI_BYTES = new Uint8Array([2]).buffer;
const PRESETS: PresetFacesState = {
  status: "ready",
  faces: [
    { id: "coco", alt: "Face with a ponytail", bytes: COCO_BYTES, src: "data:coco" },
    { id: "kai", alt: "Face with round glasses", bytes: KAI_BYTES, src: "data:kai" },
  ],
  usedIds: new Set(["coco"]),
};

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
      render(<AgentFacePicker presets={{ status: "loading" }} onPick={onPick} />);

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

    it(`shows the preset faces, fading the ones already on the team and marking the selected one (${ISSUE})`, () => {
      render(<AgentFacePicker presets={PRESETS} selectedPresetId="kai" onPick={jest.fn()} />);

      const coco = screen.getByRole("button", { name: "Face with a ponytail" });
      const kai = screen.getByRole("button", { name: "Face with round glasses" });
      expect(coco.className).toContain("tw-opacity-30");
      expect(coco.getAttribute("aria-pressed")).toBe("false");
      expect(kai.className).not.toContain("tw-opacity-30");
      expect(kai.getAttribute("aria-pressed")).toBe("true");
      expect(kai.querySelector("img")?.className).toContain(
        "tw-outline-[color:var(--interactive-accent)]"
      );
      expect(coco.querySelector("img")?.className).not.toContain("tw-outline");
      expect(screen.getByText("Faded faces are already on your team.")).not.toBeNull();
    });

    it(`shows a selected face that an agent wears as chosen, not faded, without the faded note (${ISSUE})`, () => {
      render(<AgentFacePicker presets={PRESETS} selectedPresetId="coco" onPick={jest.fn()} />);

      const coco = screen.getByRole("button", { name: "Face with a ponytail" });
      expect(coco.getAttribute("aria-pressed")).toBe("true");
      expect(coco.className).not.toContain("tw-opacity-30");
      expect(screen.queryByText("Faded faces are already on your team.")).toBeNull();
    });

    it("hands back a picked preset's bytes, preview and id, even when another agent wears it", () => {
      const onPick = jest.fn();
      render(<AgentFacePicker presets={PRESETS} onPick={onPick} />);

      fireEvent.click(screen.getByRole("button", { name: "Face with a ponytail" }));

      expect(onPick).toHaveBeenCalledWith({
        image: { kind: "preset", bytes: COCO_BYTES },
        src: "data:coco",
        presetId: "coco",
      });
    });

    it(`holds the grid's place with twelve shimmering round placeholders, hidden from screen readers, and says the faces are loading, while they load (${ISSUE})`, () => {
      render(<AgentFacePicker presets={{ status: "loading" }} onPick={jest.fn()} />);

      const grid = screen.getByRole("group", { name: "Preset faces" });
      expect(grid.className).toContain("tw-grid-cols-6");
      expect(within(grid).getByText("Loading faces").className).toContain("tw-sr-only");
      expect(within(grid).queryAllByRole("button")).toEqual([]);
      const placeholders = Array.from(grid.querySelectorAll('[aria-hidden="true"]'));
      expect(placeholders).toHaveLength(12);
      for (const placeholder of placeholders) {
        expect(placeholder.className).toContain("tw-size-9");
        expect(placeholder.className).toContain("tw-rounded-full");
        expect(placeholder.className).toContain(
          "tw-animate-[copilot-text-shimmer_2.5s_ease-in-out_infinite]"
        );
        expect(placeholder.className).toContain("motion-reduce:tw-animate-none");
      }
    });

    it(`replaces the placeholders with the loaded faces in the same grid (${ISSUE})`, () => {
      render(<AgentFacePicker presets={PRESETS} onPick={jest.fn()} />);

      const grid = screen.getByRole("group", { name: "Preset faces" });
      expect(grid.className).toContain("tw-grid-cols-6");
      expect(within(grid).getAllByRole("button")).toHaveLength(2);
      expect(within(grid).queryByText("Loading faces")).toBeNull();
      expect(grid.querySelectorAll('[aria-hidden="true"]:not(svg):not(img)')).toHaveLength(0);
    });

    it(`says the preset faces could not load and still offers Upload image (${ISSUE})`, () => {
      render(<AgentFacePicker presets={{ status: "failed" }} onPick={jest.fn()} />);

      expect(
        screen.getByText("Couldn't load the preset faces. You can upload an image.")
      ).not.toBeNull();
      expect(screen.getByRole("button", { name: "Upload image" })).not.toBeNull();
      expect(screen.queryByRole("group", { name: "Preset faces" })).toBeNull();
      expect(screen.queryByText("Loading faces")).toBeNull();
    });

    it(`keeps the current face and says why when the chosen file is not a readable image (${ISSUE})`, async () => {
      decodeImages(false);
      const onPick = jest.fn();
      render(<AgentFacePicker presets={{ status: "loading" }} onPick={onPick} />);

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
      render(<AgentFacePicker presets={{ status: "loading" }} onPick={jest.fn()} />);
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
