interface ImagePickerHandlers {
  onFiles: (files: File[]) => void;
  onSettle?: () => void;
}

// A detached input left focused after a cancelled dialog swallows clicks on Electron/Windows.
// https://github.com/logancyang/obsidian-copilot-preview/issues/119
export function openImagePicker(doc: Document, handlers: ImagePickerHandlers): void {
  const input = doc.body.createEl("input", {
    cls: "tw-hidden",
    attr: { type: "file", accept: "image/*", multiple: true },
  });

  const settle = (): void => {
    input.remove();
    handlers.onSettle?.();
  };

  input.addEventListener(
    "change",
    () => {
      handlers.onFiles(Array.from(input.files ?? []));
      settle();
    },
    { once: true }
  );
  input.addEventListener("cancel", settle, { once: true });

  input.click();
}
