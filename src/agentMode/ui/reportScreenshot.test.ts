import { captureWindowBehindDialogs } from "@/agentMode/ui/reportScreenshot";

const capturePage = jest.fn<Promise<{ toPNG: () => Uint8Array }>, []>();
let mockRemote: object | undefined;

jest.mock(
  "electron",
  () => ({
    get remote() {
      return mockRemote;
    },
  }),
  { virtual: true }
);

describe("reportScreenshot", () => {
  describe("captureWindowBehindDialogs()", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

    beforeAll(() => {
      Object.assign(HTMLElement.prototype, {
        isShown(this: HTMLElement) {
          return !this.hidden;
        },
        hide(this: HTMLElement) {
          this.hidden = true;
        },
        show(this: HTMLElement) {
          this.hidden = false;
        },
      });
    });

    beforeEach(() => {
      window.document.body.innerHTML = "";
      capturePage.mockReset();
      capturePage.mockResolvedValue({ toPNG: () => png });
      mockRemote = {
        getCurrentWindow: () => ({ getBounds: jest.fn(), webContents: { capturePage } }),
      };
    });

    function dialog(hidden = false) {
      const el = window.document.body.appendChild(window.document.createElement("div"));
      el.className = "modal-container";
      el.hidden = hidden;
      return el;
    }

    it("photographs the whole window with every open dialog hidden, then shows them again", async () => {
      const report = dialog();
      const settings = dialog();
      capturePage.mockImplementation(async () => {
        expect([report.hidden, settings.hidden]).toEqual([true, true]);
        return { toPNG: () => png };
      });

      await expect(captureWindowBehindDialogs(window)).resolves.toBe(png);

      expect(capturePage).toHaveBeenCalledWith();
      expect([report.hidden, settings.hidden]).toEqual([false, false]);
    });

    it("leaves a dialog that was already hidden hidden", async () => {
      const closed = dialog(true);

      await captureWindowBehindDialogs(window);

      expect(closed.hidden).toBe(true);
    });

    it("shows the dialogs again when the capture fails", async () => {
      const report = dialog();
      capturePage.mockRejectedValue(new Error("capturePage failed"));

      await expect(captureWindowBehindDialogs(window)).rejects.toThrow("capturePage failed");

      expect(report.hidden).toBe(false);
    });

    it("returns null without hiding anything where Electron's remote module is unavailable", async () => {
      mockRemote = undefined;
      const report = dialog();

      await expect(captureWindowBehindDialogs(window)).resolves.toBeNull();

      expect(report.hidden).toBe(false);
    });

    it("returns null for an empty image", async () => {
      capturePage.mockResolvedValue({ toPNG: () => new Uint8Array() });

      await expect(captureWindowBehindDialogs(window)).resolves.toBeNull();
    });
  });
});
