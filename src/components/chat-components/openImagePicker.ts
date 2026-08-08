interface ImagePickerHandlers {
  /** Called with the chosen files when the user picks one or more. */
  onFiles: (files: File[]) => void;
  /**
   * Called once the dialog closes for ANY reason (picked or cancelled), after
   * the input is torn down. Use it to restore focus to the composer.
   */
  onSettle?: () => void;
}

/**
 * Open a native image file picker that cleans up after itself on BOTH
 * outcomes — a file chosen (`change`) and the dialog dismissed (`cancel`).
 *
 * Why append to the DOM instead of clicking a detached input: a detached
 * `<input>` that receives focus from `.click()` leaves focus on a node outside
 * the document tree. When the dialog is cancelled, no `change` fires and that
 * stale focus stays put — on Electron/Windows it swallows subsequent clicks
 * and keystrokes in the pane and dings (logancyang/obsidian-copilot-preview#119).
 * Appending the input, removing it on settle, and restoring composer focus via
 * `onSettle` keeps the pane interactive in every path.
 *
 * `doc` is the chat view's own `Document` (`element.doc`) so the picker opens
 * in the window hosting the view, not whichever window is focused (popout-safe).
 */
export function openImagePicker(doc: Document, handlers: ImagePickerHandlers): void {
  const input = doc.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.multiple = true;
  input.classList.add("tw-hidden");
  doc.body.appendChild(input);

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
  // Chromium/Electron fire `cancel` when the dialog is dismissed with no
  // selection — the path that previously left the pane unresponsive.
  input.addEventListener("cancel", settle, { once: true });

  input.click();
}
