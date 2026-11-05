import { FileSystemAdapter, Notice, TFile, type App } from "obsidian";
import { __resetVaultBaseCache } from "@/utils/vaultPath";
import { addFilesToChat } from "./addFilesToChat";

const mockOsPaths = new Map<File, string>();
jest.mock(
  "electron",
  () => ({ webUtils: { getPathForFile: (file: File) => mockOsPaths.get(file) ?? "" } }),
  { virtual: true }
);

function vaultFile(path: string): TFile {
  return new (TFile as unknown as new (path: string) => TFile)(path);
}

function makeFile(name: string, type: string, osPath?: string): File {
  const file = new File([name], name, { type });
  file.arrayBuffer = () => Promise.resolve(new TextEncoder().encode(name).buffer as ArrayBuffer);
  if (osPath) mockOsPaths.set(file, osPath);
  return file;
}

function makeApp(vaultFiles: string[] = []) {
  const created: { path: string; data: ArrayBuffer }[] = [];
  const app = {
    vault: {
      adapter: new (FileSystemAdapter as unknown as new (basePath: string) => FileSystemAdapter)(
        "/Users/me/Vault"
      ),
      getAbstractFileByPath: (path: string) => (vaultFiles.includes(path) ? vaultFile(path) : null),
      createBinary: jest.fn(async (path: string, data: ArrayBuffer) => {
        created.push({ path, data });
        return vaultFile(path);
      }),
    },
    fileManager: {
      getAvailablePathForAttachment: jest.fn(async (name: string) => `attachments/${name}`),
    },
    workspace: { getActiveFile: () => vaultFile("Daily/today.md") },
  };
  return { app: app as unknown as App, created, fileManager: app.fileManager };
}

function makeTargets(initialNotes: TFile[] = []) {
  let notes = initialNotes;
  const onAddImage = jest.fn();
  const setContextNotes = (update: (prev: TFile[]) => TFile[]) => {
    notes = update(notes);
  };
  return { onAddImage, setContextNotes, notes: () => notes.map((note) => note.path) };
}

describe("addFilesToChat", () => {
  beforeEach(() => {
    __resetVaultBaseCache();
    mockOsPaths.clear();
    (Notice as unknown as jest.Mock).mockClear();
  });

  describe("addFilesToChat()", () => {
    it("sends images to the image tray without copying them into the vault", async () => {
      const { app, created } = makeApp();
      const targets = makeTargets();
      const photo = makeFile("photo.png", "image/png", "/Users/me/Downloads/photo.png");

      await addFilesToChat(app, [photo], targets);

      expect(targets.onAddImage).toHaveBeenCalledWith([photo]);
      expect(targets.notes()).toEqual([]);
      expect(created).toEqual([]);
    });

    it("copies a PDF from outside the vault into Obsidian's attachment location and attaches the copy as context (https://github.com/logancyang/obsidian-copilot/issues/4043)", async () => {
      const { app, created, fileManager } = makeApp();
      const targets = makeTargets();
      const report = makeFile("report.pdf", "application/pdf", "/Users/me/Downloads/report.pdf");

      await addFilesToChat(app, [report], targets);

      expect(fileManager.getAvailablePathForAttachment).toHaveBeenCalledWith(
        "report.pdf",
        "Daily/today.md"
      );
      expect(created.map((entry) => entry.path)).toEqual(["attachments/report.pdf"]);
      expect(new TextDecoder().decode(created[0].data)).toBe("report.pdf");
      expect(targets.notes()).toEqual(["attachments/report.pdf"]);
      expect(targets.onAddImage).not.toHaveBeenCalled();
    });

    it("copies a picked file that has no OS path, as on mobile, into the attachment location", async () => {
      const { app, created } = makeApp();
      const targets = makeTargets();

      await addFilesToChat(app, [makeFile("report.pdf", "application/pdf")], targets);

      expect(created.map((entry) => entry.path)).toEqual(["attachments/report.pdf"]);
      expect(targets.notes()).toEqual(["attachments/report.pdf"]);
    });

    it("attaches a file that is already inside the vault by its vault path without copying it", async () => {
      const { app, created } = makeApp(["Papers/report.pdf"]);
      const targets = makeTargets();
      const report = makeFile("report.pdf", "application/pdf", "/Users/me/Vault/Papers/report.pdf");

      await addFilesToChat(app, [report], targets);

      expect(created).toEqual([]);
      expect(targets.notes()).toEqual(["Papers/report.pdf"]);
    });

    it("keeps a vault file attached once when it is added again", async () => {
      const { app } = makeApp(["Papers/report.pdf"]);
      const targets = makeTargets([vaultFile("Papers/report.pdf")]);
      const report = makeFile("report.pdf", "application/pdf", "/Users/me/Vault/Papers/report.pdf");

      await addFilesToChat(app, [report], targets);

      expect(targets.notes()).toEqual(["Papers/report.pdf"]);
    });

    it("splits a mixed selection: the image goes to the tray and the PDF becomes context", async () => {
      const { app } = makeApp();
      const targets = makeTargets();
      const photo = makeFile("photo.png", "image/png");
      const report = makeFile("report.pdf", "application/pdf");

      await addFilesToChat(app, [photo, report], targets);

      expect(targets.onAddImage).toHaveBeenCalledWith([photo]);
      expect(targets.notes()).toEqual(["attachments/report.pdf"]);
    });

    it("names a file type chat cannot take as context in a notice and copies nothing", async () => {
      const { app, created } = makeApp();
      const targets = makeTargets();

      await addFilesToChat(app, [makeFile("brief.docx", "application/msword")], targets);

      expect(created).toEqual([]);
      expect(targets.notes()).toEqual([]);
      expect((Notice as unknown as jest.Mock).mock.calls[0][0]).toContain("brief.docx");
    });

    it("shows a notice naming the file when copying it into the vault fails, and still attaches the rest", async () => {
      const { app } = makeApp();
      (app.vault.createBinary as jest.Mock).mockRejectedValueOnce(new Error("disk full"));
      const targets = makeTargets();

      await addFilesToChat(
        app,
        [makeFile("first.pdf", "application/pdf"), makeFile("second.pdf", "application/pdf")],
        targets
      );

      expect((Notice as unknown as jest.Mock).mock.calls[0][0]).toContain("first.pdf");
      expect(targets.notes()).toEqual(["attachments/second.pdf"]);
    });
  });
});
