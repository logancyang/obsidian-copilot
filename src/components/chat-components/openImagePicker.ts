import { Notice } from "obsidian";

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
      const files = Array.from(input.files ?? []);
      const images = files.filter((file) => file.type.startsWith("image/"));
      // The dialog's "All files" filter lets a PDF through, which then reached the agent as a broken image.
      // https://github.com/logancyang/obsidian-copilot/issues/4043
      const skipped = files.filter((file) => !images.includes(file)).map((file) => file.name);
      if (skipped.length > 0) {
        new Notice(
          `Skipped ${skipped.join(", ")}: only images can be attached here. To share a PDF or other file, add it to your vault and attach it with @.`
        );
      }
      handlers.onFiles(images);
      settle();
    },
    { once: true }
  );
  input.addEventListener("cancel", settle, { once: true });

  input.click();
}
