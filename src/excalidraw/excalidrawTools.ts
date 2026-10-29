import { outlineScene, type SceneElement } from "@/excalidraw/excalidrawOutline";

export const EXCALIDRAW_READ_TOOL_NAME = "excalidraw_read";
export const EXCALIDRAW_RENDER_TOOL_NAME = "excalidraw_render";
export const EXCALIDRAW_CREATE_TOOL_NAME = "excalidraw_create";
export const EXCALIDRAW_EDIT_TOOL_NAME = "excalidraw_edit";
export const EXCALIDRAW_TOOL_NAMES: ReadonlySet<string> = new Set([
  EXCALIDRAW_READ_TOOL_NAME,
  EXCALIDRAW_RENDER_TOOL_NAME,
  EXCALIDRAW_CREATE_TOOL_NAME,
  EXCALIDRAW_EDIT_TOOL_NAME,
]);

export const EXCALIDRAW_TURNED_OFF_TEXT =
  "The Excalidraw tools are not available because the Excalidraw plugin (2.29 or later) is not enabled. Tell the user; don't call them again.";

// Codex cuts the middle out of any MCP output over about 40,000 UTF-8 bytes, so element JSON asked for by id stays under it.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/787
const MAX_ELEMENT_JSON_BYTES = 32_000;

const PATH = {
  type: "string",
  description: "Vault-relative path of the drawing, including .excalidraw.md or .excalidraw.",
};

const ELEMENT = {
  type: "object",
  required: ["type"],
  properties: {
    id: { type: "string", description: "Your own id, for arrows' start and end." },
    type: {
      enum: ["rectangle", "ellipse", "diamond", "text", "arrow", "line", "frame", "stickynote"],
    },
    x: { type: "number" },
    y: { type: "number" },
    width: { type: "number" },
    height: { type: "number" },
    label: {
      type: "object",
      properties: { text: { type: "string" } },
      description: "Text inside a shape or on an arrow.",
    },
    text: { type: "string", description: "Only for free-standing text elements." },
    start: { type: "object", properties: { id: { type: "string" } } },
    end: { type: "object", properties: { id: { type: "string" } } },
    points: { type: "array", items: { type: "array", items: { type: "number" } } },
    strokeColor: { type: "string" },
    backgroundColor: { type: "string" },
    strokeStyle: { type: "string" },
    children: { type: "array", items: { type: "string" }, description: "Ids a frame holds." },
  },
};

// Claude Code defers MCP tools behind tool search, hiding the descriptions that say to use these instead of writing files.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/787
const ALWAYS_LOAD = Object.freeze({ "anthropic/alwaysLoad": true });

// Codex asks the user to approve MCP calls unless the tool is read-only, and reading or rendering changes nothing.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/787
const READ_ONLY = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
});
const WRITES = Object.freeze({ readOnlyHint: false, destructiveHint: false, openWorldHint: false });

export const EXCALIDRAW_READ_TOOL = Object.freeze({
  name: EXCALIDRAW_READ_TOOL_NAME,
  description: `Read an Obsidian Excalidraw drawing (.excalidraw.md or .excalidraw) as a compact outline: containers with their members; shapes with id, label, position (top-left x,y and width x height), colour and link; arrows as From -> To "label"; free text; and overlaps with draw order. Positions and draw order carry meaning: a sticker, badge or highlight normally sits on top of the shape it marks, and a large filled shape under smaller ones is a background or lane. A small shape or text tucked under a filled shape is usually a stacking mistake: go by where it sits and which shape it overlaps most, and tell the user it is partly hidden. Pass ids to get those elements' full JSON. Use this instead of opening or decoding the file.`,
  inputSchema: {
    type: "object",
    properties: {
      path: PATH,
      ids: {
        type: "array",
        items: { type: "string" },
        description: "Element ids whose full JSON you need.",
      },
    },
    required: ["path"],
  },
  annotations: READ_ONLY,
  _meta: ALWAYS_LOAD,
});

export const EXCALIDRAW_RENDER_TOOL = Object.freeze({
  name: EXCALIDRAW_RENDER_TOOL_NAME,
  description: `Render a saved Excalidraw drawing as a PNG image. After creating or editing a drawing, look at it before you answer, and fix overlapping shapes, labels that overflow or miss their shape, crowded areas, and arrows that cut through shapes or labels.`,
  inputSchema: { type: "object", properties: { path: PATH }, required: ["path"] },
  annotations: READ_ONLY,
  _meta: ALWAYS_LOAD,
});

export const EXCALIDRAW_CREATE_TOOL = Object.freeze({
  name: EXCALIDRAW_CREATE_TOOL_NAME,
  description: `Create a new Obsidian Excalidraw drawing. The Excalidraw plugin writes the file, binds each label to its shape and each arrow to both ends. Never write or patch Excalidraw files yourself: a hand-written file garbles labels and detaches arrows. It never overwrites an existing path.
Give each shape a local id, type, x, y, width, height and label {text}; text inside a shape goes in label, never in a separate text element on top. Connect shapes with arrows whose start {id} and end {id} name shapes in this call; put the arrow's x,y on the source's edge and its last point on the target's edge, with bend points to route around other shapes. Use an arrow with endArrowhead null for a plain connector, never a line. Later elements are drawn on top: put a group's background rectangle before its members and a sticker after the shape it marks. Don't put connected shapes in a frame: frames clip arrows that leave them.
Layout: one flow direction, 60-100 px gaps, and boxes wide enough for their label (about 11 px per character at font size 20). Follow the look of the vault's existing drawings. The reply maps your ids to the real ones.`,
  inputSchema: {
    type: "object",
    properties: { path: PATH, elements: { type: "array", minItems: 1, items: ELEMENT } },
    required: ["path", "elements"],
  },
  annotations: WRITES,
  _meta: ALWAYS_LOAD,
});

export const EXCALIDRAW_EDIT_TOOL = Object.freeze({
  name: EXCALIDRAW_EDIT_TOOL_NAME,
  description: `Change an existing Obsidian Excalidraw drawing; Obsidian opens it if it isn't open. Get ids from excalidraw_read. The operations apply together:
- {"op":"update","id":..,"set":{..}} moves (x, y), resizes, recolours (strokeColor, backgroundColor, strokeStyle), links (link) or renames. To rename, update the label's own text id with {"text": ..}. An arrow's points can't be updated: to reroute it, delete it and connect again.
- {"op":"delete","ids":[..]} removes elements and their labels. Delete the arrows into and out of a removed shape too.
- {"op":"add","elements":[..]} adds elements as in excalidraw_create, drawn on top. Its arrows can only attach to shapes added in the same operation.
- {"op":"connect","from":..,"to":..} adds an arrow attached to two existing shapes; optional fromSide and toSide (top, bottom, left, right), label, dashed (true) and color.
Make room before inserting by moving the shapes that follow. Keep every id you didn't mean to change: links and block references point at them.`,
  inputSchema: {
    type: "object",
    properties: {
      path: PATH,
      operations: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          required: ["op"],
          properties: {
            op: { enum: ["update", "delete", "add", "connect"] },
            id: { type: "string" },
            set: { type: "object" },
            ids: { type: "array", items: { type: "string" } },
            elements: { type: "array", items: ELEMENT },
            from: { type: "string" },
            to: { type: "string" },
            fromSide: { enum: ["top", "bottom", "left", "right"] },
            toSide: { enum: ["top", "bottom", "left", "right"] },
            label: { type: "string" },
            dashed: { type: "boolean" },
            color: { type: "string" },
          },
        },
      },
    },
    required: ["path", "operations"],
  },
  annotations: WRITES,
  _meta: ALWAYS_LOAD,
});

export interface ExcalidrawCliReply {
  ok: boolean;
  persistence?: string;
  warnings?: ReadonlyArray<unknown>;
  data?: Record<string, unknown>;
  error?: { code?: string; message?: string };
}

export interface LabelledConnection {
  from: string;
  to: string;
  fromSide?: string;
  toSide?: string;
  label?: string;
  dashed?: boolean;
  color?: string;
}

export interface ExcalidrawApi {
  sceneElements(path: string): Promise<readonly SceneElement[] | null>;
  renderPng(path: string): Promise<string>;
  execute(request: Record<string, unknown>): Promise<ExcalidrawCliReply>;
  connectLabelled(
    path: string,
    connection: LabelledConnection
  ): Promise<{ arrowId: string; labelId: string | null }>;
}

export interface ExcalidrawToolResult {
  text: string;
  isError: boolean;
  image?: { data: string; mimeType: string };
}

export interface ExcalidrawTool {
  definition: { readonly name: string };
  turnedOffText: string;
  call: (args: unknown) => Promise<ExcalidrawToolResult>;
}

export function createExcalidrawTools(
  getApi: () => ExcalidrawApi | null
): readonly ExcalidrawTool[] {
  const run =
    (
      handler: (
        api: ExcalidrawApi,
        input: Record<string, unknown>,
        path: string
      ) => Promise<ExcalidrawToolResult>
    ) =>
    async (args: unknown): Promise<ExcalidrawToolResult> => {
      const api = getApi();
      if (!api) return failure(EXCALIDRAW_TURNED_OFF_TEXT);
      const input = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
      const path = typeof input.path === "string" ? input.path.trim() : "";
      if (!path) return failure("path must be the vault-relative path of a drawing.");
      try {
        return await handler(api, input, path);
      } catch (error) {
        return failure(
          `Excalidraw failed on ${path}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    };
  const tool = (
    definition: { readonly name: string },
    handler: Parameters<typeof run>[0]
  ): ExcalidrawTool =>
    Object.freeze({ definition, turnedOffText: EXCALIDRAW_TURNED_OFF_TEXT, call: run(handler) });
  return Object.freeze([
    tool(EXCALIDRAW_READ_TOOL, read),
    tool(EXCALIDRAW_RENDER_TOOL, render),
    tool(EXCALIDRAW_CREATE_TOOL, create),
    tool(EXCALIDRAW_EDIT_TOOL, edit),
  ]);
}

async function read(
  api: ExcalidrawApi,
  input: Record<string, unknown>,
  path: string
): Promise<ExcalidrawToolResult> {
  const elements = await api.sceneElements(path);
  if (!elements) return failure(`${path} is not an Excalidraw drawing in this vault.`);
  const ids = Array.isArray(input.ids)
    ? input.ids.filter((id): id is string => typeof id === "string")
    : [];
  if (!ids.length) return { text: outlineScene(path, elements).join("\n"), isError: false };
  const wanted = new Set(ids);
  const picked = elements.filter(
    (e) => !e.isDeleted && (wanted.has(e.id) || (e.containerId && wanted.has(e.containerId)))
  );
  const missing = ids.filter((id) => !picked.some((e) => e.id === id));
  const json = JSON.stringify(picked);
  if (new TextEncoder().encode(json).length > MAX_ELEMENT_JSON_BYTES) {
    return failure(
      `Those ${ids.length} elements are too large to return at once; ask for fewer ids.`
    );
  }
  return {
    text: missing.length ? `${json}\nNo element with id: ${missing.join(", ")}` : json,
    isError: false,
  };
}

async function render(
  api: ExcalidrawApi,
  _input: Record<string, unknown>,
  path: string
): Promise<ExcalidrawToolResult> {
  if (!(await api.sceneElements(path)))
    return failure(`${path} is not an Excalidraw drawing in this vault.`);
  return {
    text: `Rendered ${path}.`,
    isError: false,
    image: { data: await api.renderPng(path), mimeType: "image/png" },
  };
}

async function create(
  api: ExcalidrawApi,
  input: Record<string, unknown>,
  path: string
): Promise<ExcalidrawToolResult> {
  if (!Array.isArray(input.elements) || !input.elements.length)
    return failure("elements must be a non-empty array.");
  const reply = await api.execute({
    apiVersion: 1,
    command: "create",
    requestId: requestId(),
    path,
    elements: input.elements,
  });
  if (!reply.ok) return failure(`Could not create ${path}: ${describeFailure(reply)}`);
  return {
    text: `Created ${path}.${describeIds(reply)}${describeWarnings(reply)}`,
    isError: false,
  };
}

async function edit(
  api: ExcalidrawApi,
  input: Record<string, unknown>,
  path: string
): Promise<ExcalidrawToolResult> {
  if (!Array.isArray(input.operations) || !input.operations.length)
    return failure("operations must be a non-empty array.");
  const operations = input.operations.filter(
    (op): op is Record<string, unknown> => Boolean(op) && typeof op === "object"
  );
  const opened = await api.execute({ apiVersion: 1, command: "open", path });
  if (!opened.ok) return failure(`Could not open ${path}: ${describeFailure(opened)}`);

  // The plugin's connect operation can't label, dash or colour an arrow, so those connections are built on the open drawing.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/787
  const styled = operations.filter(
    (op) => op.op === "connect" && (op.label || op.dashed || op.color)
  );
  const plain = operations.filter((op) => !styled.includes(op));
  const done: string[] = [];
  if (plain.length) {
    const live = await api.execute({ apiVersion: 1, command: "read", path, source: "live" });
    if (!live.ok) return failure(`Could not read ${path}: ${describeFailure(live)}`);
    const applied = await api.execute({
      apiVersion: 1,
      command: "apply",
      requestId: requestId(),
      path,
      expectedRevision: live.data?.revision,
      operations: plain,
    });
    if (!applied.ok) return failure(`No change made to ${path}: ${describeFailure(applied)}`);
    if (applied.persistence && applied.persistence !== "saved") {
      return failure(
        `${path} changed but did not save (${applied.persistence}). Check the drawing before going on.`
      );
    }
    done.push(
      `Applied ${plain.length} operation${plain.length === 1 ? "" : "s"}.${describeIds(applied)}${describeWarnings(applied)}`
    );
  }
  for (const op of styled) {
    const connection = op as unknown as LabelledConnection;
    const { arrowId, labelId } = await api.connectLabelled(path, connection);
    done.push(
      `Connected ${connection.from} -> ${connection.to} with arrow ${arrowId}${labelId ? ` (label ${labelId})` : ""}.`
    );
  }
  return { text: `Edited ${path}. ${done.join(" ")}`, isError: false };
}

function requestId(): string {
  return `copilot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function describeFailure(reply: ExcalidrawCliReply): string {
  const { code, message } = reply.error ?? {};
  return [code, message].filter(Boolean).join(": ") || "the Excalidraw plugin gave no reason.";
}

function describeIds(reply: ExcalidrawCliReply): string {
  const idMap = reply.data?.idMap;
  if (!idMap || typeof idMap !== "object") return "";
  const pairs = Object.entries(idMap as Record<string, unknown>).map(
    ([local, real]) => `${local}=${String(real)}`
  );
  return pairs.length ? ` Ids (yours=real): ${pairs.join(", ")}.` : "";
}

function describeWarnings(reply: ExcalidrawCliReply): string {
  const warnings = (reply.warnings ?? []).map((w) =>
    typeof w === "string" ? w : JSON.stringify(w)
  );
  return warnings.length ? ` Warnings: ${warnings.join("; ")}` : "";
}

function failure(text: string): ExcalidrawToolResult {
  return { text, isError: true };
}
