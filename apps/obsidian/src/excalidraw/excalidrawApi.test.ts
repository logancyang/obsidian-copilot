import { FileSystemAdapter, TFile, type App } from "obsidian";
import { __resetVaultBaseCache } from "@/utils/vaultPath";
import { activeDrawingSelection, getExcalidrawApi } from "./excalidrawApi";

const ISSUE_787 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/787";
const ISSUE_792 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/792";
const ISSUE_794 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/794";
const FLOW = "Drawings/Flow.excalidraw.md";
const ELEMENTS = [{ id: "box1", type: "rectangle", x: 0, y: 0, width: 10, height: 10 }];

function fakeEa() {
  const elements: Record<
    string,
    {
      containerId?: string | null;
      boundElements?: Array<{ id: string; type: string }>;
      x?: number;
      y?: number;
      width?: number;
      height?: number;
      points?: number[][];
    }
  > = {
    Arr00001: {
      boundElements: [],
      x: 180,
      y: 40,
      width: 120,
      height: 0,
      points: [
        [0, 0],
        [120, 0],
      ],
    },
    Lbl00001: {},
  };
  const fresh = {
    createPNGBase64: jest.fn().mockResolvedValue("data:image/png;base64,iVBORw0KGgo="),
    getViewElements: jest.fn().mockReturnValue([
      { id: "box1", type: "rectangle" },
      { id: "box2", type: "rectangle" },
      { id: "gone", type: "rectangle", isDeleted: true },
    ]),
    copyViewElementsToEAforEditing: jest.fn(),
    connectObjects: jest.fn().mockReturnValue("Arr00001"),
    addText: jest.fn().mockReturnValue("Lbl00001"),
    getElement: jest.fn((id: string) => elements[id]),
    addElementsToView: jest.fn().mockResolvedValue(true),
    style: { strokeStyle: "solid", strokeColor: "#1e1e1e" },
    destroy: jest.fn(),
  };
  const ea = {
    getAPI: jest.fn().mockReturnValue(fresh),
    isExcalidrawFile: jest.fn((file: { path: string }) => file.path.endsWith(".excalidraw.md")),
    getSceneFromFile: jest.fn().mockResolvedValue({ elements: ELEMENTS }),
    executeCLI: jest.fn().mockResolvedValue({ ok: true }),
  };
  return { ea, fresh, elements };
}

function appWith(
  ea: unknown,
  openPaths: string[] = [],
  saveWithOutcome = jest
    .fn()
    .mockResolvedValue({ status: "saved", requestedRevision: 2, acknowledgedRevision: 2 })
): App {
  return {
    plugins: {
      getPlugin: (id: string) => (id === "obsidian-excalidraw-plugin" && ea ? { ea } : null),
    },
    vault: {
      adapter: new (FileSystemAdapter as unknown as new (basePath: string) => unknown)(
        "/Users/me/Vault"
      ),
      getAbstractFileByPath: (path: string) =>
        path === FLOW || path === "Notes/Plan.md" ? Object.assign(new TFile(), { path }) : null,
    },
    workspace: {
      getLeavesOfType: (type: string) =>
        type === "excalidraw"
          ? openPaths.map((path) => ({ view: { file: { path }, saveWithOutcome } }))
          : [],
    },
  } as unknown as App;
}

describe("excalidrawApi", () => {
  describe("activeDrawingSelection()", () => {
    const drawingView = {
      file: Object.assign(new TFile(), { path: FLOW, basename: "Flow.excalidraw" }),
      getViewType: () => "excalidraw",
    };
    const appShowing = (ea: unknown, view: unknown) =>
      ({
        plugins: { getPlugin: () => (ea ? { ea } : null) },
        workspace: { getActiveViewOfType: () => view },
      }) as unknown as App;

    it(`${ISSUE_794} outlines the active drawing's selected shapes and labels by id when read, then releases the API`, () => {
      const { ea, fresh } = fakeEa();
      const read = activeDrawingSelection(appShowing(ea, drawingView))!;
      Object.assign(fresh, {
        getViewSelectedElements: jest.fn().mockReturnValue([
          {
            id: "step1",
            type: "rectangle",
            x: 0,
            y: 0,
            width: 120,
            height: 60,
            boundElements: [{ id: "label1", type: "text" }],
          },
          {
            id: "label1",
            type: "text",
            x: 10,
            y: 20,
            width: 100,
            height: 20,
            containerId: "step1",
            text: "Sign up",
          },
        ]),
      });

      const report = read();
      const { context } = report;

      expect(report).toMatchObject({
        location: FLOW,
        key: `excalidraw:${FLOW}:${context!.content}`,
      });
      expect(context).toMatchObject({
        sourceType: "note",
        noteTitle: "Flow.excalidraw",
        notePath: FLOW,
      });
      expect(context!.content).toContain(`${FLOW}: 2 elements (rectangle 1, text 1).`);
      expect(context!.content).toContain('  step1 rectangle "Sign up" @0,0 120x60 text label1');
      expect(ea.getAPI).toHaveBeenCalledWith(drawingView);
      expect(fresh.destroy).toHaveBeenCalled();
    });

    it(`${ISSUE_794} reports nothing selected in the drawing when no shape is selected`, () => {
      const { ea, fresh } = fakeEa();
      Object.assign(fresh, { getViewSelectedElements: jest.fn().mockReturnValue([]) });

      expect(activeDrawingSelection(appShowing(ea, drawingView))!()).toEqual({
        location: FLOW,
        context: null,
      });
    });

    it(`${ISSUE_794} has no source when the active view is not a drawing or the Excalidraw plugin is not loaded`, () => {
      const { ea } = fakeEa();
      const noteView = { file: new TFile(), getViewType: () => "markdown" };

      expect(activeDrawingSelection(appShowing(ea, noteView))).toBeNull();
      expect(activeDrawingSelection(appShowing(ea, null))).toBeNull();
      expect(activeDrawingSelection(appShowing(null, drawingView))).toBeNull();
    });
  });

  describe("getExcalidrawApi()", () => {
    beforeEach(() => __resetVaultBaseCache());

    it(`${ISSUE_787} is unavailable when the Excalidraw plugin is not loaded or predates executeCLI in 2.29`, () => {
      expect(getExcalidrawApi(appWith(null))).toBeNull();
      expect(getExcalidrawApi(appWith({ getSceneFromFile: jest.fn() }))).toBeNull();
      expect(getExcalidrawApi(appWith(fakeEa().ea))).not.toBeNull();
    });

    it("reads a drawing's elements through the plugin, accepting an absolute path inside the vault", async () => {
      const { ea } = fakeEa();
      const api = getExcalidrawApi(appWith(ea))!;

      expect(await api.sceneElements(`/Users/me/Vault/${FLOW}`)).toEqual(ELEMENTS);
      expect(ea.getSceneFromFile).toHaveBeenCalledWith(expect.objectContaining({ path: FLOW }));
    });

    it("has no elements for a missing file or a file the plugin does not treat as a drawing", async () => {
      const { ea } = fakeEa();
      const api = getExcalidrawApi(appWith(ea))!;

      expect(await api.sceneElements("Drawings/Missing.excalidraw.md")).toBeNull();
      expect(await api.sceneElements("Notes/Plan.md")).toBeNull();
      expect(ea.getSceneFromFile).not.toHaveBeenCalled();
    });

    it("renders with a fresh plugin API at scale 1, returns bare base64 and releases the API", async () => {
      const { ea, fresh } = fakeEa();

      expect(await getExcalidrawApi(appWith(ea))!.renderPng(FLOW)).toBe("iVBORw0KGgo=");
      expect(fresh.createPNGBase64).toHaveBeenCalledWith(FLOW, 1);
      expect(fresh.destroy).toHaveBeenCalled();
    });

    it("sends requests to the plugin's executeCLI with a vault-relative path", async () => {
      const { ea } = fakeEa();

      await getExcalidrawApi(appWith(ea))!.execute({
        apiVersion: 1,
        command: "open",
        path: `/Users/me/Vault/${FLOW}`,
      });

      expect(ea.executeCLI).toHaveBeenCalledWith({ apiVersion: 1, command: "open", path: FLOW });
    });

    it(`${ISSUE_787} connects two shapes on the open drawing with a dashed, coloured arrow whose label is bound both ways, and saves`, async () => {
      const { ea, fresh, elements } = fakeEa();
      const api = getExcalidrawApi(appWith(ea, [FLOW]))!;

      const result = await api.connectLabelled(FLOW, {
        from: "box1",
        to: "box2",
        fromSide: "bottom",
        label: "No",
        dashed: true,
        color: "#e03131",
      });

      expect(result).toEqual({ arrowId: "Arr00001", labelId: "Lbl00001" });
      expect(fresh.connectObjects).toHaveBeenCalledWith("box1", "bottom", "box2", null, {
        startArrowHead: null,
        endArrowHead: "arrow",
      });
      expect(fresh.style).toEqual({ strokeStyle: "dashed", strokeColor: "#e03131" });
      expect(elements.Lbl00001.containerId).toBe("Arr00001");
      expect(elements.Arr00001.boundElements).toEqual([{ type: "text", id: "Lbl00001" }]);
      expect(fresh.addElementsToView).toHaveBeenCalledWith(false, false, true);
      expect(fresh.destroy).toHaveBeenCalled();
    });

    it(`${ISSUE_792} draws the connecting arrow with the roughness and stroke width asked for`, async () => {
      const { ea, fresh } = fakeEa();

      await getExcalidrawApi(appWith(ea, [FLOW]))!.connectLabelled(FLOW, {
        from: "box1",
        to: "box2",
        roughness: 2,
        strokeWidth: 1,
      });

      expect(fresh.style).toEqual({
        strokeStyle: "solid",
        strokeColor: "#1e1e1e",
        roughness: 2,
        strokeWidth: 1,
      });
    });

    it(`${ISSUE_787} routes a connection through its bend points, keeping the ends where they attach to the shapes`, async () => {
      const { ea, elements } = fakeEa();
      const api = getExcalidrawApi(appWith(ea, [FLOW]))!;

      await api.connectLabelled(FLOW, {
        from: "box1",
        to: "box2",
        via: [
          [240, 140],
          [300, 140],
        ],
      });

      expect(elements.Arr00001).toMatchObject({
        x: 180,
        y: 40,
        width: 120,
        height: 100,
        points: [
          [0, 0],
          [60, 100],
          [120, 100],
          [120, 0],
        ],
      });
    });

    it(`${ISSUE_787} fails a connection whose save the drawing did not acknowledge, so the agent does not read a stale file`, async () => {
      const { ea } = fakeEa();
      const unsaved = jest
        .fn()
        .mockResolvedValue({ status: "skipped", requestedRevision: 3, acknowledgedRevision: 2 });
      const api = getExcalidrawApi(appWith(ea, [FLOW], unsaved))!;

      await expect(
        api.connectLabelled(FLOW, { from: "box1", to: "box2", label: "No" })
      ).rejects.toThrow("the new arrow is in the open drawing but did not save (skipped).");
    });

    it("refuses to connect on a drawing that is not open, or to an id that is missing or deleted", async () => {
      const { ea, fresh } = fakeEa();

      await expect(
        getExcalidrawApi(appWith(ea))!.connectLabelled(FLOW, { from: "box1", to: "box2" })
      ).rejects.toThrow(`${FLOW} is not open.`);
      await expect(
        getExcalidrawApi(appWith(ea, [FLOW]))!.connectLabelled(FLOW, {
          from: "box1",
          to: "gone",
          label: "x",
        })
      ).rejects.toThrow("No element with id gone.");
      expect(fresh.addElementsToView).not.toHaveBeenCalled();
    });
  });
});
