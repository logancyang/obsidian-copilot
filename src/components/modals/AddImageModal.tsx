import { App } from "obsidian";

export class AddImageModal {
  private app: App;
  private onImagesSelected: (files: File[]) => void;

  constructor(app: App, onImagesSelected: (files: File[]) => void) {
    this.app = app;
    this.onImagesSelected = onImagesSelected;
  }

  open() {
    const input = activeDocument.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.classList.add("tw-hidden");

    input.addEventListener("change", () => {
      const files = Array.from(input.files || []);
      this.onImagesSelected(files);
      // Clean up
      activeDocument.body.removeChild(input);
    });

    activeDocument.body.appendChild(input);
    input.click();
  }
}
