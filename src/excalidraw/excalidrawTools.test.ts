import { deferred } from "@/agentMode/session/testing/fakeTurnTrackerDeps";
import type { SceneElement } from "./excalidrawOutline";
import {
  createExcalidrawTools,
  EXCALIDRAW_READ_TOOL,
  EXCALIDRAW_RENDER_TOOL,
  EXCALIDRAW_TURNED_OFF_TEXT,
  EXCALIDRAW_WRITE_TOOL,
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
  const [read, render, write] = createExcalidrawTools(() => api);
  return { read, render, write };
}

describe("excalidrawTools", () => {
  describe("tool definitions", () => {
    it(`${ISSUE_787} offers read and render as read-only and one write tool, all behind the agent's tool search`, () => {
      expect(EXCALIDRAW_READ_TOOL.annotations.readOnlyHint).toBe(true);
      expect(EXCALIDRAW_RENDER_TOOL.annotations.readOnlyHint).toBe(true);
      expect(EXCALIDRAW_WRITE_TOOL.annotations.readOnlyHint).toBe(false);
      for (const tool of [EXCALIDRAW_READ_TOOL, EXCALIDRAW_RENDER_TOOL, EXCALIDRAW_WRITE_TOOL]) {
        expect(tool).not.toHaveProperty("_meta");
        expect(tool.inputSchema.required).toEqual(["path"]);
      }
      expect(Object.keys(EXCALIDRAW_WRITE_TOOL.inputSchema.properties)).toEqual([
        "path",
        "elements",
        "operations",
      ]);
    });

    it(`${ISSUE_787} tells agents to draw through the tools instead of writing the file, and how draw order reads`, () => {
      expect(EXCALIDRAW_WRITE_TOOL.description).toContain(
        "Never write or patch Excalidraw files yourself"
      );
      expect(EXCALIDRAW_WRITE_TOOL.description).toContain("Later elements are drawn on top");
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

      const result = await toolsFor(api).write.call({ path: FLOW, elements });

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
      const { write } = toolsFor(api);

      expect(await write.call({ path: FLOW, elements: [{ type: "rectangle" }] })).toEqual({
        text: `Could not create ${FLOW}: ALREADY_EXISTS: Drawings/Flow.excalidraw.md exists`,
        isError: true,
      });
      expect(await write.call({ path: FLOW, elements: [] })).toEqual({
        text: "elements must be a non-empty array.",
        isError: true,
      });
    });

    it("asks for elements or operations when a write call has neither, without touching the plugin", async () => {
      const api = fakeApi();

      expect(await toolsFor(api).write.call({ path: FLOW })).toEqual({
        text: "Pass elements for a new drawing or operations for an existing one.",
        isError: true,
      });
      expect(api.execute).not.toHaveBeenCalled();
    });

    it("opens the drawing, reads its live revision and applies the operations against that revision", async () => {
      const api = fakeApi();
      const operations = [{ op: "update", id: "box1", set: { x: 40 } }];

      const result = await toolsFor(api).write.call({ path: FLOW, operations });

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

    it(`${ISSUE_787} builds labelled, dashed, coloured or routed connections on the open drawing instead of sending them to apply`, async () => {
      const api = fakeApi();
      const labelled = { op: "connect", from: "box1", to: "box2", label: "No", dashed: true };
      const routed = { op: "connect", from: "box2", to: "box1", via: [[540, 40]] };

      const result = await toolsFor(api).write.call({ path: FLOW, operations: [labelled, routed] });

      expect(api.execute.mock.calls.map(([request]) => request.command)).toEqual(["open"]);
      expect(api.connectLabelled.mock.calls).toEqual([
        [FLOW, labelled],
        [FLOW, routed],
      ]);
      expect(result.text).toBe(
        `Edited ${FLOW}. Connected box1 -> box2 with arrow Arr00001 (label Lbl00001). Connected box2 -> box1 with arrow Arr00001 (label Lbl00001).`
      );
    });

    it(`${ISSUE_787} holds a second write to the same drawing until the first has saved, so its scene snapshot cannot drop the first write's arrow`, async () => {
      const firstConnecting = deferred();
      const firstSaved = deferred<{ arrowId: string; labelId: string }>();
      const api = fakeApi({
        connectLabelled: jest
          .fn()
          .mockImplementationOnce(() => {
            firstConnecting.resolve();
            return firstSaved.promise;
          })
          .mockResolvedValue({ arrowId: "Arr00002", labelId: "Lbl00002" }),
      });
      const { write } = toolsFor(api);
      const yes = { op: "connect", from: "box1", to: "box2", label: "Yes" };
      const no = { op: "connect", from: "box2", to: "box1", label: "No" };

      const first = write.call({ path: FLOW, operations: [yes] });
      await firstConnecting.promise;
      const second = write.call({ path: FLOW, operations: [no] });
      expect(api.execute).toHaveBeenCalledTimes(1);

      firstSaved.resolve({ arrowId: "Arr00001", labelId: "Lbl00001" });
      expect((await first).isError).toBe(false);
      expect((await second).text).toBe(
        `Edited ${FLOW}. Connected box2 -> box1 with arrow Arr00002 (label Lbl00002).`
      );
      expect(api.connectLabelled.mock.calls).toEqual([
        [FLOW, yes],
        [FLOW, no],
      ]);
    });

    it(`${ISSUE_787} finishes a write to another drawing while a write to the first drawing is still saving`, async () => {
      const firstSaved = deferred<{ arrowId: string; labelId: string }>();
      const api = fakeApi({
        connectLabelled: jest.fn(async (path: string) =>
          path === FLOW ? firstSaved.promise : { arrowId: "Arr00001", labelId: "Lbl00001" }
        ),
      });
      const { write } = toolsFor(api);
      const labelled = { op: "connect", from: "box1", to: "box2", label: "Yes" };

      const first = write.call({ path: FLOW, operations: [labelled] });
      const other = await write.call({
        path: "Drawings/Other.excalidraw.md",
        operations: [labelled],
      });

      expect(other.text).toBe(
        "Edited Drawings/Other.excalidraw.md. Connected box1 -> box2 with arrow Arr00001 (label Lbl00001)."
      );
      firstSaved.resolve({ arrowId: "Arr00001", labelId: "Lbl00001" });
      expect((await first).isError).toBe(false);
    });

    it(`${ISSUE_787} still runs the next write to a drawing after the previous write failed`, async () => {
      const api = fakeApi();
      api.execute.mockRejectedValueOnce(new Error("view closed"));
      const { write } = toolsFor(api);
      const labelled = { op: "connect", from: "box1", to: "box2", label: "Yes" };

      const failed = write.call({ path: FLOW, operations: [labelled] });
      const next = write.call({ path: FLOW, operations: [labelled] });

      expect((await failed).isError).toBe(true);
      expect((await next).isError).toBe(false);
    });

    it(`${ISSUE_787} rejects bend points that are not [x, y] pairs before changing the drawing`, async () => {
      const api = fakeApi();

      const result = await toolsFor(api).write.call({
        path: FLOW,
        operations: [
          { op: "delete", ids: ["box2"] },
          { op: "connect", from: "box1", to: "box2", via: [{ x: 540, y: 40 }] },
        ],
      });

      expect(result).toEqual({
        text: "No change made: via must be a list of [x, y] points, such as [[540, 40]].",
        isError: true,
      });
      expect(api.execute).not.toHaveBeenCalled();
      expect(api.connectLabelled).not.toHaveBeenCalled();
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
        await toolsFor(api).write.call({
          path: FLOW,
          operations: [{ op: "delete", ids: ["box9"] }],
        })
      ).toEqual({
        text: `No change made to ${FLOW}: INVALID_ARGUMENT: Unknown element id: box9`,
        isError: true,
      });
    });

    it(`${ISSUE_787} reports the operations already saved when a later labelled connection fails, so the agent doesn't redo them`, async () => {
      const api = fakeApi({
        connectLabelled: jest.fn().mockRejectedValue(new Error("No element with id gone.")),
      });

      const result = await toolsFor(api).write.call({
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

    it(`${ISSUE_787} turns an exception from the plugin into an error naming the drawing and the fallback of decoding the file directly`, async () => {
      const api = fakeApi({
        sceneElements: jest.fn().mockRejectedValue(new Error("file is locked")),
      });

      expect(await toolsFor(api).read.call({ path: FLOW })).toEqual({
        text: `Excalidraw failed on ${FLOW}: file is locked. If this keeps failing, work on the file directly and write your own decoder for its compressed-json block.`,
        isError: true,
      });
    });
  });
});
