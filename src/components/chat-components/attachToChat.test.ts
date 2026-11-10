import { Notice, TFile, TFolder, type App } from "obsidian";
import type { VaultSplit } from "@/utils/splitByVault";
import { attachToChat, type AttachToChatOptions } from "./attachToChat";

function vaultFile(path: string): TFile {
  return new (TFile as unknown as new (path: string) => TFile)(path);
}

function vaultFolder(path: string): TFolder {
  return new (TFolder as unknown as new (path: string) => TFolder)(path);
}

function outsideFile(name: string, type = ""): File {
  const file = new File([name], name, { type });
  file.arrayBuffer = () => Promise.resolve(new TextEncoder().encode(name).buffer as ArrayBuffer);
  return file;
}

function split(parts: Partial<VaultSplit>): VaultSplit {
  return { vaultItems: [], outsideFiles: [], outsideFolderNames: [], ...parts };
}

function makeApp() {
  const created: { path: string; data: ArrayBuffer }[] = [];
  const app = {
    vault: {
      readBinary: jest.fn(async (file: TFile) => new TextEncoder().encode(file.path).buffer),
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

function makeTargets({
  notes: initialNotes = [] as TFile[],
  images = [] as File[],
  acceptAnyFileType = false,
} = {}) {
  let notes = initialNotes;
  const added: File[] = [];
  const options: AttachToChatOptions = {
    contextNotes: initialNotes,
    selectedImages: images,
    onAddImage: (files) => added.push(...files),
    setContextNotes: (update) => {
      notes = update(notes);
    },
    acceptAnyFileType,
  };
  return { options, notes: () => notes.map((note) => note.path), images: () => added };
}

function notices(): string[] {
  return (Notice as unknown as jest.Mock<unknown, [string]>).mock.calls.map(([message]) => message);
}

describe("attachToChat", () => {
  beforeEach(() => {
    (Notice as unknown as jest.Mock).mockClear();
  });

  describe("attachToChat()", () => {
    it("attaches a vault note as context without copying it", async () => {
      const { app, created } = makeApp();
      const targets = makeTargets();

      await attachToChat(app, split({ vaultItems: [vaultFile("Notes/plan.md")] }), targets.options);

      expect(targets.notes()).toEqual(["Notes/plan.md"]);
      expect(created).toEqual([]);
    });

    it("copies a PDF from outside the vault into Obsidian's attachment location and attaches the copy as context (https://github.com/logancyang/obsidian-copilot/issues/4043)", async () => {
      const { app, created, fileManager } = makeApp();
      const targets = makeTargets();

      await attachToChat(
        app,
        split({ outsideFiles: [outsideFile("report.pdf", "application/pdf")] }),
        targets.options
      );

      expect(fileManager.getAvailablePathForAttachment).toHaveBeenCalledWith(
        "report.pdf",
        "Daily/today.md"
      );
      expect(created.map((entry) => entry.path)).toEqual(["attachments/report.pdf"]);
      expect(new TextDecoder().decode(created[0].data)).toBe("report.pdf");
      expect(targets.notes()).toEqual(["attachments/report.pdf"]);
    });

    it("sends an outside image to the image tray as is and a vault image as its file contents, copying neither", async () => {
      const { app, created } = makeApp();
      const targets = makeTargets();
      const photo = outsideFile("photo.png", "image/png");

      await attachToChat(
        app,
        split({ vaultItems: [vaultFile("Media/chart.jpg")], outsideFiles: [photo] }),
        targets.options
      );

      expect(targets.images().map((image) => [image.name, image.type])).toEqual([
        ["chart.jpg", "image/jpeg"],
        ["photo.png", "image/png"],
      ]);
      expect(targets.notes()).toEqual([]);
      expect(created).toEqual([]);
    });

    it("attaches vault items and outside files from the same drop together — https://github.com/Brevilabs/obsidian-copilot-private/issues/898", async () => {
      const { app } = makeApp();
      const targets = makeTargets();

      await attachToChat(
        app,
        split({
          vaultItems: [vaultFile("Notes/plan.md")],
          outsideFiles: [outsideFile("report.pdf", "application/pdf")],
        }),
        targets.options
      );

      expect(targets.notes()).toEqual(["Notes/plan.md", "attachments/report.pdf"]);
    });

    it("says a note or image is already in the context instead of attaching it twice", async () => {
      const { app } = makeApp();
      const plan = vaultFile("Notes/plan.md");
      const targets = makeTargets({ notes: [plan], images: [outsideFile("photo.png")] });

      await attachToChat(
        app,
        split({ vaultItems: [plan], outsideFiles: [outsideFile("photo.png", "image/png")] }),
        targets.options
      );

      expect(targets.notes()).toEqual(["Notes/plan.md"]);
      expect(targets.images()).toEqual([]);
      expect(notices()).toEqual([
        "This note is already in the context",
        "This image is already in the context",
      ]);
    });

    it("names a file type chat cannot read in the same notice whether it comes from the vault or the computer, and copies nothing", async () => {
      const { app, created } = makeApp();
      const targets = makeTargets();

      await attachToChat(
        app,
        split({
          vaultItems: [vaultFile("Data/sales.csv")],
          outsideFiles: [outsideFile("brief.docx", "application/msword")],
        }),
        targets.options
      );

      expect(created).toEqual([]);
      expect(targets.notes()).toEqual([]);
      expect(notices()).toEqual([
        "Can't attach sales.csv: chat accepts images and md, canvas, base, pdf files.",
        "Can't attach brief.docx: chat accepts images and md, canvas, base, pdf files.",
      ]);
    });

    it("attaches a file of any type when any type is accepted, as in Agent Chat (https://github.com/logancyang/obsidian-copilot/issues/4043)", async () => {
      const { app, created } = makeApp();
      const targets = makeTargets({ acceptAnyFileType: true });

      await attachToChat(
        app,
        split({
          vaultItems: [vaultFile("Data/sales.csv")],
          outsideFiles: [outsideFile("brief.docx", "application/msword")],
        }),
        targets.options
      );

      expect(created.map((entry) => entry.path)).toEqual(["attachments/brief.docx"]);
      expect(targets.notes()).toEqual(["Data/sales.csv", "attachments/brief.docx"]);
      expect(notices()).toEqual([]);
    });

    it("names folders from the vault or the computer in one notice and attaches the files dropped with them (https://github.com/logancyang/obsidian-copilot/issues/3858)", async () => {
      const { app } = makeApp();
      const targets = makeTargets();

      await attachToChat(
        app,
        split({
          vaultItems: [vaultFolder("Research/Pricing"), vaultFile("Notes/plan.md")],
          outsideFolderNames: ["my-codebase"],
        }),
        targets.options
      );

      expect(notices()).toEqual(["Folders can't be attached to a message: Pricing, my-codebase"]);
      expect(targets.notes()).toEqual(["Notes/plan.md"]);
    });

    it("shows a notice naming the file when copying it into the vault fails, and still attaches the rest", async () => {
      const { app } = makeApp();
      (app.vault.createBinary as jest.Mock).mockRejectedValueOnce(new Error("disk full"));
      const targets = makeTargets();

      await attachToChat(
        app,
        split({
          outsideFiles: [
            outsideFile("first.pdf", "application/pdf"),
            outsideFile("second.pdf", "application/pdf"),
          ],
        }),
        targets.options
      );

      expect(notices()).toEqual(["Could not add first.pdf to the vault."]);
      expect(targets.notes()).toEqual(["attachments/second.pdf"]);
    });
  });
});
