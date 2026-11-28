import { openFilePicker } from "./openFilePicker";

describe("openFilePicker", () => {
  describe("openFilePicker()", () => {
    let clickSpy: jest.SpyInstance;
    beforeEach(() => {
      (window as unknown as { activeDocument: Document }).activeDocument = window.document;
      clickSpy = jest.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    });
    afterEach(() => {
      clickSpy.mockRestore();
      activeDocument.body.innerHTML = "";
    });

    const pickerInput = (): HTMLInputElement => {
      const input = activeDocument.body.querySelector('input[type="file"]');
      if (!input) throw new Error("picker input not found in DOM");
      return input as HTMLInputElement;
    };

    it("appends a multi-select file input limited to the given types to the DOM and clicks it", () => {
      openFilePicker(activeDocument, { accept: "image/*,.pdf", onFiles: jest.fn() });
      const input = pickerInput();
      expect(input.accept).toBe("image/*,.pdf");
      expect(input.multiple).toBe(true);
      expect(clickSpy).toHaveBeenCalledTimes(1);
    });

    it("lets the dialog pick any file type when no types are given", () => {
      openFilePicker(activeDocument, { onFiles: jest.fn() });
      expect(pickerInput().hasAttribute("accept")).toBe(false);
    });

    it("on cancel: removes the input and calls onSettle, never onFiles", () => {
      const onFiles = jest.fn();
      const onSettle = jest.fn();
      openFilePicker(activeDocument, { onFiles, onSettle });
      const input = pickerInput();

      input.dispatchEvent(new Event("cancel"));

      expect(onSettle).toHaveBeenCalledTimes(1);
      expect(onFiles).not.toHaveBeenCalled();
      expect(activeDocument.body.contains(input)).toBe(false);
    });

    it("on change: forwards files, removes the input, and calls onSettle", () => {
      const onFiles = jest.fn();
      const onSettle = jest.fn();
      openFilePicker(activeDocument, { onFiles, onSettle });
      const input = pickerInput();

      input.dispatchEvent(new Event("change"));

      expect(onFiles).toHaveBeenCalledTimes(1);
      expect(Array.isArray(onFiles.mock.calls[0][0])).toBe(true);
      expect(onSettle).toHaveBeenCalledTimes(1);
      expect(activeDocument.body.contains(input)).toBe(false);
    });

    it("works without an onSettle handler", () => {
      openFilePicker(activeDocument, { onFiles: jest.fn() });
      const input = pickerInput();
      expect(() => input.dispatchEvent(new Event("cancel"))).not.toThrow();
      expect(activeDocument.body.contains(input)).toBe(false);
    });
  });
});
