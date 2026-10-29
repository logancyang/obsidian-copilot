import type { SceneElement } from "./excalidrawOutline";
import {
  createExcalidrawTools,
  EXCALIDRAW_CREATE_TOOL,
  EXCALIDRAW_EDIT_TOOL,
  EXCALIDRAW_READ_TOOL,
  EXCALIDRAW_RENDER_TOOL,
  EXCALIDRAW_TURNED_OFF_TEXT,
  type ExcalidrawApi,
} from "./excalidrawTools";

const ISSUE_787 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/787";
const FLOW = "Drawings/Flow.excalidraw.md";

const START: SceneElement[] = [
  {
    id: "box1",
    type: "rectangle",
    x: 0,
    y: 0,
    width: 180,
    height: 80,
    boundElements: [{ id: "txt1", type: "text" }],
  },
  {
    id: "txt1",
    type: "text",
    x: 10,
    y: 30,
    width: 160,
    height: 20,
    text: "Start",
    containerId: "box1",
  },
  { id: "box2", type: "rectangle", x: 300, y: 0, width: 180, height: 80 },
];

function fakeApi(overrides: Partial<ExcalidrawApi> = {}): jest.Mocked<ExcalidrawApi> {
  return {
    sceneElements: jest.fn().mockResolvedValue(START),
    renderPng: jest.fn().mockResolvedValue("iVBORw0KGgo="),
    execute: jest.fn().mockImplementation(async (request: Record<string, unknown>) => {
      if (request.command === "read") return { ok: true, data: { revision: "s1:v1:3:7" } };
      if (request.command === "open") return { ok: true };
      return { ok: true, data: { idMap: { a: "Xy12Ab34" } } };
    }),
    connectLabelled: jest.fn().mockResolvedValue({ arrowId: "Arr00001", labelId: "Lbl00001" }),
    ...overrides,
  } as jest.Mocked<ExcalidrawApi>;
}

function toolsFor(api: ExcalidrawApi | null) {
  const [read, render, create, edit] = createExcalidrawTools(() => api);
  return { read, render, create, edit };
}

describe("excalidrawTools", () => {
  describe("tool definitions", () => {
    it("marks read and render read-only and create and edit as writes, all loaded up front", () => {
      expect(EXCALIDRAW_READ_TOOL.annotations.readOnlyHint).toBe(true);
      expect(EXCALIDRAW_RENDER_TOOL.annotations.readOnlyHint).toBe(true);
      expect(EXCALIDRAW_CREATE_TOOL.annotations.readOnlyHint).toBe(false);
      expect(EXCALIDRAW_EDIT_TOOL.annotations.readOnlyHint).toBe(false);
      for (const tool of [
        EXCALIDRAW_READ_TOOL,
        EXCALIDRAW_RENDER_TOOL,
        EXCALIDRAW_CREATE_TOOL,
        EXCALIDRAW_EDIT_TOOL,
      ]) {
        expect(tool._meta).toEqual({ "anthropic/alwaysLoad": true });
        expect(tool.inputSchema.required).toContain("path");
      }
    });

    it(`${ISSUE_787} tells agents to draw through the tools instead of writing the file, and how draw order reads`, () => {
      expect(EXCALIDRAW_CREATE_TOOL.description).toContain(
        "Never write or patch Excalidraw files yourself"
      );
      expect(EXCALIDRAW_CREATE_TOOL.description).toContain("Later elements are drawn on top");
      expect(EXCALIDRAW_READ_TOOL.description).toContain(
        "tucked under a filled shape is usually a stacking mistake"
      );
      expect(EXCALIDRAW_RENDER_TOOL.description).toContain("look at it before you answer");
    });
  });

  describe("createExcalidrawTools()", () => {
    it("answers every tool with the turned-off text while the Excalidraw plugin is unavailable", async () => {
      for (const tool of Object.values(toolsFor(null))) {
        expect(await tool.call({ path: FLOW })).toEqual({
          text: EXCALIDRAW_TURNED_OFF_TEXT,
          isError: true,
        });
      }
    });

    it("rejects a call without a path", async () => {
      expect(await toolsFor(fakeApi()).read.call({})).toEqual({
        text: "path must be the vault-relative path of a drawing.",
        isError: true,
      });
    });

    it("reads a drawing as its outline", async () => {
      const result = await toolsFor(fakeApi()).read.call({ path: FLOW });

      expect(result.isError).toBe(false);
      expect(result.text.split("\n")).toContain('  box1 rectangle "Start" @0,0 180x80 text txt1');
    });

    it("returns the full JSON of the requested ids with their labels, naming ids it could not find", async () => {
      const result = await toolsFor(fakeApi()).read.call({ path: FLOW, ids: ["box1", "nope"] });

      const [json, missing] = result.text.split("\n");
      expect(JSON.parse(json).map((e: SceneElement) => e.id)).toEqual(["box1", "txt1"]);
      expect(missing).toBe("No element with id: nope");
    });

    it(`${ISSUE_787} refuses element JSON over 32,000 bytes, which Codex would cut in the middle`, async () => {
      const big = Array.from({ length: 200 }, (_, i) => ({
        id: `e${i}`,
        type: "text",
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        text: "x".repeat(200),
      }));
      const api = fakeApi({ sceneElements: jest.fn().mockResolvedValue(big) });

      const result = await toolsFor(api).read.call({ path: FLOW, ids: big.map((e) => e.id) });

      expect(result).toEqual({
        text: "Those 200 elements are too large to return at once; ask for fewer ids.",
        isError: true,
      });
    });

    it("reports a path that is not an Excalidraw drawing for read and render", async () => {
      const api = fakeApi({ sceneElements: jest.fn().mockResolvedValue(null) });
      const { read, render } = toolsFor(api);

      for (const tool of [read, render]) {
        expect(await tool.call({ path: "Notes/Plan.md" })).toEqual({
          text: "Notes/Plan.md is not an Excalidraw drawing in this vault.",
          isError: true,
        });
      }
      expect(api.renderPng).not.toHaveBeenCalled();
    });

    it("renders a drawing as a PNG image after a line naming it", async () => {
      expect(await toolsFor(fakeApi()).render.call({ path: FLOW })).toEqual({
        text: `Rendered ${FLOW}.`,
        isError: false,
        image: { data: "iVBORw0KGgo=", mimeType: "image/png" },
      });
    });

    it("creates a drawing with one create request and reports the plugin's id map", async () => {
      const api = fakeApi();
      const elements = [
        {
          id: "a",
          type: "rectangle",
          x: 0,
          y: 0,
          width: 200,
          height: 80,
          label: { text: "Start" },
        },
      ];

      const result = await toolsFor(api).create.call({ path: FLOW, elements });

      const [request] = api.execute.mock.calls[0];
      expect(request).toEqual({
        apiVersion: 1,
        command: "create",
        requestId: request.requestId,
        path: FLOW,
        elements,
      });
      expect(request.requestId).toMatch(/^copilot-[\w.-]+$/);
      expect(result).toEqual({
        text: `Created ${FLOW}. Ids (yours=real): a=Xy12Ab34.`,
        isError: false,
      });
    });

    it("reports the plugin's error code and message when create fails, and rejects an empty element list", async () => {
      const api = fakeApi({
        execute: jest.fn().mockResolvedValue({
          ok: false,
          error: { code: "ALREADY_EXISTS", message: "Drawings/Flow.excalidraw.md exists" },
        }),
      });
      const { create } = toolsFor(api);

      expect(await create.call({ path: FLOW, elements: [{ type: "rectangle" }] })).toEqual({
        text: `Could not create ${FLOW}: ALREADY_EXISTS: Drawings/Flow.excalidraw.md exists`,
        isError: true,
      });
      expect(await create.call({ path: FLOW, elements: [] })).toEqual({
        text: "elements must be a non-empty array.",
        isError: true,
      });
    });

    it("opens the drawing, reads its live revision and applies the operations against that revision", async () => {
      const api = fakeApi();
      const operations = [{ op: "update", id: "box1", set: { x: 40 } }];

      const result = await toolsFor(api).edit.call({ path: FLOW, operations });

      expect(api.execute.mock.calls.map(([request]) => request.command)).toEqual([
        "open",
        "read",
        "apply",
      ]);
      expect(api.execute).toHaveBeenLastCalledWith(
        expect.objectContaining({
          command: "apply",
          path: FLOW,
          expectedRevision: "s1:v1:3:7",
          operations,
        })
      );
      expect(result).toEqual({
        text: `Edited ${FLOW}. Applied 1 operation. Ids (yours=real): a=Xy12Ab34.`,
        isError: false,
      });
    });

    it(`${ISSUE_787} builds labelled, dashed or coloured connections on the open drawing instead of sending them to apply`, async () => {
      const api = fakeApi();
      const labelled = { op: "connect", from: "box1", to: "box2", label: "No", dashed: true };

      const result = await toolsFor(api).edit.call({ path: FLOW, operations: [labelled] });

      expect(api.execute.mock.calls.map(([request]) => request.command)).toEqual(["open"]);
      expect(api.connectLabelled).toHaveBeenCalledWith(FLOW, labelled);
      expect(result.text).toBe(
        `Edited ${FLOW}. Connected box1 -> box2 with arrow Arr00001 (label Lbl00001).`
      );
    });

    it("reports a rejected apply as no change, with the plugin's reason", async () => {
      const api = fakeApi({
        execute: jest.fn().mockImplementation(async (request: Record<string, unknown>) =>
          request.command === "apply"
            ? {
                ok: false,
                error: { code: "INVALID_ARGUMENT", message: "Unknown element id: box9" },
              }
            : { ok: true, data: { revision: "r" } }
        ),
      });

      expect(
        await toolsFor(api).edit.call({ path: FLOW, operations: [{ op: "delete", ids: ["box9"] }] })
      ).toEqual({
        text: `No change made to ${FLOW}: INVALID_ARGUMENT: Unknown element id: box9`,
        isError: true,
      });
    });

    it(`${ISSUE_787} reports the operations already saved when a later labelled connection fails, so the agent doesn't redo them`, async () => {
      const api = fakeApi({
        connectLabelled: jest.fn().mockRejectedValue(new Error("No element with id gone.")),
      });

      const result = await toolsFor(api).edit.call({
        path: FLOW,
        operations: [
          { op: "add", elements: [{ id: "a", type: "rectangle" }] },
          { op: "connect", from: "box1", to: "gone", label: "No" },
        ],
      });

      expect(result).toEqual({
        text: "Saved: Applied 1 operation. Ids (yours=real): a=Xy12Ab34. Then failed to connect box1 -> gone: No element with id gone. Don't redo the saved changes.",
        isError: true,
      });
    });

    it("turns an exception from the plugin into an error result naming the drawing", async () => {
      const api = fakeApi({
        sceneElements: jest.fn().mockRejectedValue(new Error("file is locked")),
      });

      expect(await toolsFor(api).read.call({ path: FLOW })).toEqual({
        text: `Excalidraw failed on ${FLOW}: file is locked`,
        isError: true,
      });
    });
  });
});
