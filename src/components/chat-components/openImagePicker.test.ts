import { openImagePicker } from "./openImagePicker";

describe("openImagePicker", () => {
  // jsdom would open nothing, but `.click()` on a file input is also a no-op
  // that can pop a native dialog under Electron; stub it so tests stay inert.
  let clickSpy: jest.SpyInstance;
  beforeEach(() => {
    clickSpy = jest.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
  });
  afterEach(() => {
    clickSpy.mockRestore();
    document.body.innerHTML = "";
  });

  const pickerInput = (): HTMLInputElement => {
    const input = document.body.querySelector('input[type="file"]');
    if (!input) throw new Error("picker input not found in DOM");
    return input as HTMLInputElement;
  };

  it("appends a configured file input to the DOM and clicks it", () => {
    openImagePicker(document, { onFiles: jest.fn() });
    const input = pickerInput();
    expect(input.accept).toBe("image/*");
    expect(input.multiple).toBe(true);
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it("on cancel: removes the input and calls onSettle, never onFiles", () => {
    const onFiles = jest.fn();
    const onSettle = jest.fn();
    openImagePicker(document, { onFiles, onSettle });
    const input = pickerInput();

    input.dispatchEvent(new Event("cancel"));

    expect(onSettle).toHaveBeenCalledTimes(1);
    expect(onFiles).not.toHaveBeenCalled();
    expect(document.body.contains(input)).toBe(false);
  });

  it("on change: forwards files, removes the input, and calls onSettle", () => {
    const onFiles = jest.fn();
    const onSettle = jest.fn();
    openImagePicker(document, { onFiles, onSettle });
    const input = pickerInput();

    input.dispatchEvent(new Event("change"));

    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(Array.isArray(onFiles.mock.calls[0][0])).toBe(true);
    expect(onSettle).toHaveBeenCalledTimes(1);
    expect(document.body.contains(input)).toBe(false);
  });

  it("works without an onSettle handler", () => {
    openImagePicker(document, { onFiles: jest.fn() });
    const input = pickerInput();
    expect(() => input.dispatchEvent(new Event("cancel"))).not.toThrow();
    expect(document.body.contains(input)).toBe(false);
  });
});
