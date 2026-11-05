import { Notice } from "obsidian";
import { openImagePicker } from "./openImagePicker";

describe("openImagePicker", () => {
  describe("openImagePicker()", () => {
    let clickSpy: jest.SpyInstance;
    beforeEach(() => {
      (window as unknown as { activeDocument: Document }).activeDocument = window.document;
      clickSpy = jest.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    });
    afterEach(() => {
      clickSpy.mockRestore();
      (Notice as unknown as jest.Mock).mockClear();
      activeDocument.body.innerHTML = "";
    });

    const pickerInput = (): HTMLInputElement => {
      const input = activeDocument.body.querySelector('input[type="file"]');
      if (!input) throw new Error("picker input not found in DOM");
      return input as HTMLInputElement;
    };

    it("appends a configured file input to the DOM and clicks it", () => {
      openImagePicker(activeDocument, { onFiles: jest.fn() });
      const input = pickerInput();
      expect(input.accept).toBe("image/*");
      expect(input.multiple).toBe(true);
      expect(clickSpy).toHaveBeenCalledTimes(1);
    });

    it("on cancel: removes the input and calls onSettle, never onFiles", () => {
      const onFiles = jest.fn();
      const onSettle = jest.fn();
      openImagePicker(activeDocument, { onFiles, onSettle });
      const input = pickerInput();

      input.dispatchEvent(new Event("cancel"));

      expect(onSettle).toHaveBeenCalledTimes(1);
      expect(onFiles).not.toHaveBeenCalled();
      expect(activeDocument.body.contains(input)).toBe(false);
    });

    it("on change: forwards files, removes the input, and calls onSettle", () => {
      const onFiles = jest.fn();
      const onSettle = jest.fn();
      openImagePicker(activeDocument, { onFiles, onSettle });
      const input = pickerInput();

      input.dispatchEvent(new Event("change"));

      expect(onFiles).toHaveBeenCalledTimes(1);
      expect(Array.isArray(onFiles.mock.calls[0][0])).toBe(true);
      expect(onSettle).toHaveBeenCalledTimes(1);
      expect(activeDocument.body.contains(input)).toBe(false);
    });

    it("on change with a PDF beside an image: forwards only the image and names the skipped PDF in a notice (https://github.com/logancyang/obsidian-copilot/issues/4043)", () => {
      const onFiles = jest.fn();
      openImagePicker(activeDocument, { onFiles });
      const input = pickerInput();
      const photo = new File(["png"], "photo.png", { type: "image/png" });
      const report = new File(["pdf"], "report.pdf", { type: "application/pdf" });
      Object.defineProperty(input, "files", { value: [photo, report] });

      input.dispatchEvent(new Event("change"));

      expect(onFiles).toHaveBeenCalledWith([photo]);
      expect(Notice).toHaveBeenCalledTimes(1);
      expect((Notice as unknown as jest.Mock).mock.calls[0][0]).toContain("report.pdf");
    });

    it("on change with only images: forwards them all without a notice", () => {
      const onFiles = jest.fn();
      openImagePicker(activeDocument, { onFiles });
      const input = pickerInput();
      const photo = new File(["png"], "photo.png", { type: "image/png" });
      Object.defineProperty(input, "files", { value: [photo] });

      input.dispatchEvent(new Event("change"));

      expect(onFiles).toHaveBeenCalledWith([photo]);
      expect(Notice).not.toHaveBeenCalled();
    });

    it("works without an onSettle handler", () => {
      openImagePicker(activeDocument, { onFiles: jest.fn() });
      const input = pickerInput();
      expect(() => input.dispatchEvent(new Event("cancel"))).not.toThrow();
      expect(activeDocument.body.contains(input)).toBe(false);
    });
  });
});
