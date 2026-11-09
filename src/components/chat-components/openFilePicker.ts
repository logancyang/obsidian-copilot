interface FilePickerOptions {
  accept?: string;
  onFiles: (files: File[]) => void;
  onSettle?: () => void;
}

// A detached input left focused after a cancelled dialog swallows clicks on Electron/Windows.
// https://github.com/logancyang/obsidian-copilot-preview/issues/119
export function openFilePicker(doc: Document, options: FilePickerOptions): void {
  const input = doc.body.createEl("input", {
    cls: "tw-hidden",
    attr: { type: "file", multiple: true, ...(options.accept ? { accept: options.accept } : {}) },
  });

  const settle = (): void => {
    input.remove();
    options.onSettle?.();
  };

  input.addEventListener(
    "change",
    () => {
      options.onFiles(Array.from(input.files ?? []));
      settle();
    },
    { once: true }
  );
  input.addEventListener("cancel", settle, { once: true });

  input.click();
}
