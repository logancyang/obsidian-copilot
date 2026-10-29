import type { BuiltinSkill } from "./builtinSkills";

const EXCALIDRAW_SKILL_VERSION = 1;

const EXCALIDRAW_SKILL_MD = `---
name: copilot-excalidraw
description: Read, create, and edit Obsidian Excalidraw drawings (.excalidraw.md and .excalidraw files) so arrows stay attached, labels move with their shapes, and text survives reloading. Use whenever a request reads, draws, diagrams, or changes an Excalidraw drawing.
license: MIT
metadata:
  copilot-enabled-agents: claude, codex, opencode
  copilot-builtin-version: "${EXCALIDRAW_SKILL_VERSION}"
---

# Obsidian Excalidraw

An \`.excalidraw.md\` file is frontmatter \`excalidraw-plugin: parsed\`, a \`# Excalidraw Data\` section, and a \`## Drawing\` block holding the scene JSON (\`{"type":"excalidraw","version":2,"elements":[...],"appState":{},"files":{}}\`) between \`%%\` lines. The Excalidraw plugin checks none of the rules below; it silently loads a broken drawing.

## Rules that decide whether a drawing works

- **Text lives twice.** \`## Text Elements\` lists each text as \`text ^id\` and overrides the JSON on load. Every \`^id\` must be exactly 8 characters and equal its text element's \`id\`, with one blank line between entries; any other length glues labels together. When you change text, change both, or write the drawing without the \`# Excalidraw Data\` / \`## Text Elements\` sections and the plugin rebuilds them from the JSON. Give every element an 8-character id from \`[A-Za-z0-9]\`.
- **The drawing block may be compressed.** \` \`\`\`compressed-json \` holds LZ-String base64: remove all whitespace, then \`decompressFromBase64\`. You may write back plain \` \`\`\`json \`; the plugin recompresses on its next save. Skip elements with \`"isDeleted": true\`; they stay in the file.
- **An arrow follows a dragged box only if both sides record the link:** the arrow's \`startBinding\`/\`endBinding\` is \`{"elementId": <shape id>, "mode": "orbit", "fixedPoint": [fx, fy]}\` (the point on the shape as fractions of its width and height, e.g. \`[1, 0.5]\` = right middle), and the shape's \`boundElements\` contains \`{"type": "arrow", "id": <arrow id>}\`. Nothing repairs a missing half. The arrow's \`x,y\` is its first point, \`points\` starts at \`[0,0]\`, and both ends sit on the shapes' edges.
- **A label moves with its box only if bound:** a \`text\` element with \`"containerId": <box id>\`, \`"textAlign": "center"\`, \`"verticalAlign": "middle"\`, and the box's \`boundElements\` containing \`{"type": "text", "id": <text id>}\`. Arrow labels bind to the arrow the same way. Never place loose text on top of a shape.
- **Connections are arrows.** A \`line\` can never bind; use an \`arrow\` with \`"endArrowhead": null\` for a plain connector.
- **Frames clip** every member to the frame's bounds. Group with a light background \`rectangle\` drawn first instead, or keep arrows that leave a frame out of it (\`"frameId": null\`).
- Give shapes and text explicit \`width\`/\`height\` (a missing size draws nothing) and text \`fontSize\`, \`fontFamily\` (5 is the default hand-drawn font) and \`lineHeight\` 1.25. Other fields get defaults on load.
- Layout: one flow direction, 60–100 px gaps, boxes wide enough for their label (about 11 px per character at font size 20).

When you change an existing drawing, keep every element id you didn't mean to change: Obsidian links and block references point at them.

## Reading a drawing

If Obsidian's CLI is available, this prints a compact outline (containers with members, nodes with id, label, position, colour and link, arrows as \`From -> To "label"\`, free text and strokes) for a few KB instead of about 700 bytes of JSON per element:

\`\`\`bash
cli="\${COPILOT_OBSIDIAN_CLI:-obsidian}"
"$cli" vault="<vault name>" obsidian-excalidraw-plugin:script script=<outline path> trusted=true requestId=<new unique id> args='{"path":"Diagrams/Flow.excalidraw.md"}'
\`\`\`

\`<outline path>\` is the vault-relative path of the \`scripts/outline.md\` next to this SKILL.md, in Copilot's skills folder. Obsidian can't open files in hidden folders, so if you reached this skill through a link such as \`.claude/skills/copilot-excalidraw\`, use the folder that link points to.

Copilot runs inside Obsidian, so Obsidian is running during your session. If an obsidian command prints "The CLI is unable to find Obsidian" inside a sandbox, the sandbox is blocking the CLI's connection to the app: rerun that command with escalated permissions.

The reply's \`data.lines\` is the outline. If the command is missing (Excalidraw older than 2.29 or the CLI is off), decode the file as above. Positions carry meaning: lanes, groups and annotations are spatial.

## Check the picture

If the CLI works and you can read images, render the drawing after writing it and look before you answer:

\`\`\`bash
"$cli" vault="<vault name>" obsidian-excalidraw-plugin:export path=Diagrams/Flow.excalidraw.md source=disk out=Diagrams/Flow-check.png requestId=<new unique id>
\`\`\`

Fix overlapping shapes, labels that overflow or miss their shape, crowded areas, and arrows that cut through shapes or labels, then delete the PNG. Obsidian needs a second or two to pick up a file you just wrote. If the export says the image is too large, run \`open path=<drawing>\` first and export with \`source=live\`. If the export still fails, skip the check: a render you draw yourself or a window screenshot doesn't show what Excalidraw draws.
`;

const OUTLINE_SCRIPT = String.raw`const path = utils.input && utils.input.path;
const file = path ? app.vault.getFileByPath(path) : null;
if (!file) return { error: "No drawing at " + path };
const scene = await ea.getSceneFromFile(file);
const els = scene.elements.filter((e) => !e.isDeleted);
const byId = new Map(els.map((e) => [e.id, e]));
const r = (n) => Math.round(n);
const box = (e) => {
  if (e.points) {
    const xs = e.points.map((p) => e.x + p[0]), ys = e.points.map((p) => e.y + p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }
  return [e.x, e.y, e.x + e.width, e.y + e.height];
};
const inside = (o, i) => o[0] <= i[0] + 2 && o[1] <= i[1] + 2 && o[2] >= i[2] - 2 && o[3] >= i[3] - 2;
const centre = (b) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
const txt = (t) => (t.rawText || t.originalText || t.text || "").replace(/\s*\n\s*/g, " ").trim();
const boundText = (e) => {
  const ref = (e.boundElements || []).find((b) => b.type === "text");
  const t = ref && byId.get(ref.id);
  return t && !t.isDeleted ? t : null;
};
const SHAPES = ["rectangle", "ellipse", "diamond", "stickynote", "image", "embeddable", "iframe"];
const shapes = els.filter((e) => SHAPES.includes(e.type));
const regions = new Set(shapes.filter((s) => shapes.some((o) => o !== s && inside(box(s), box(o)))).map((s) => s.id));
const frames = els.filter((e) => e.type === "frame" || e.type === "magicframe");
const freeTexts = els.filter((e) => e.type === "text" && !e.containerId);
// Free text sitting on an unlabelled shape reads as its label but will not move with it.
const floating = new Map();
for (const t of freeTexts) {
  const c = centre(box(t));
  const host = shapes.filter((s) => !regions.has(s.id) && !boundText(s)).find((s) => {
    const b = box(s);
    return c[0] >= b[0] && c[0] <= b[2] && c[1] >= b[1] && c[1] <= b[3];
  });
  if (host) floating.set(host.id, [...(floating.get(host.id) || []), t]);
}
const claimed = new Set([...floating.values()].flat().map((t) => t.id));
const label = (e) => {
  const t = boundText(e);
  if (t) return txt(t);
  if (floating.has(e.id)) return floating.get(e.id).map(txt).join(" ");
  if (e.type === "frame") return e.name || "";
  if (e.type === "text") return txt(e);
  return "";
};
const name = (e) => {
  if (!e) return "?";
  const l = label(e);
  return l ? JSON.stringify(l) : e.type + " " + e.id;
};
const container = (e) => {
  const b = box(e);
  const hits = [...frames.filter((f) => e.frameId === f.id || inside(box(f), b)),
    ...shapes.filter((s) => regions.has(s.id) && s !== e && inside(box(s), b))];
  if (!hits.length) return "";
  const smallest = hits.sort((a, b2) => (box(a)[2] - box(a)[0]) * (box(a)[3] - box(a)[1]) - (box(b2)[2] - box(b2)[0]) * (box(b2)[3] - box(b2)[1]))[0];
  return " in " + (label(smallest) ? JSON.stringify(label(smallest)) : smallest.type + " " + smallest.id);
};
const style = (e) => {
  const s = [];
  if (e.backgroundColor && e.backgroundColor !== "transparent") s.push("fill " + e.backgroundColor);
  if (e.strokeColor && !["#1e1e1e", "#000000"].includes(e.strokeColor)) s.push("stroke " + e.strokeColor);
  if (e.strokeStyle && e.strokeStyle !== "solid") s.push(e.strokeStyle);
  if (e.link) s.push("link " + e.link);
  return s.length ? " " + s.join(", ") : "";
};
const nearest = (pt, skip) => {
  let best = null, gap = Infinity;
  for (const s of [...shapes.filter((x) => !regions.has(x.id)), ...freeTexts.filter((t) => !claimed.has(t.id))]) {
    if (s.id === skip) continue;
    const b = box(s);
    const d = Math.hypot(Math.max(b[0] - pt[0], 0, pt[0] - b[2]), Math.max(b[1] - pt[1], 0, pt[1] - b[3]));
    if (d < gap) { best = s; gap = d; }
  }
  return gap <= 20 ? best : null;
};
const counts = {};
for (const e of els) counts[e.type] = (counts[e.type] || 0) + 1;
const lines = [path + ": " + els.length + " elements (" + Object.entries(counts).map(([k, v]) => k + " " + v).join(", ") + "). Positions are top-left x,y and width x height."];
const groups = [...frames, ...shapes.filter((s) => regions.has(s.id))];
if (groups.length) {
  lines.push("Containers:");
  for (const g of groups) {
    const members = els.filter((e) => e !== g && SHAPES.concat("text").includes(e.type) && !e.containerId && !claimed.has(e.id)
      && !regions.has(e.id) && (e.frameId === g.id || inside(box(g), box(e))) && label(e) !== label(g));
    const b = box(g);
    lines.push("  " + g.id + " " + g.type + " " + name(g) + " @" + r(b[0]) + "," + r(b[1]) + " " + r(b[2] - b[0]) + "x" + r(b[3] - b[1]) + style(g) + ": " + members.map((m) => label(m) || m.type).join(", "));
  }
}
lines.push("Nodes (id type label @x,y wxh; text id = the label's own id, for renames):");
for (const s of shapes.filter((x) => !regions.has(x.id) && x.type !== "image")) {
  const b = box(s), t = boundText(s);
  const extra = floating.has(s.id) ? " [label is loose text, not bound]" : t ? " text " + t.id : "";
  lines.push("  " + s.id + " " + s.type + " " + name(s) + " @" + r(b[0]) + "," + r(b[1]) + " " + r(b[2] - b[0]) + "x" + r(b[3] - b[1]) + style(s) + extra + container(s));
}
// Plain lines between two shapes read as connectors, but lines can never bind, so they will not follow a drag.
const arrows = els.filter((e) => e.type === "arrow" || (e.type === "line" && (e.points || []).length <= 6 && (() => {
  const p = e.points || [[0, 0]], q = p[p.length - 1];
  return nearest([e.x + p[0][0], e.y + p[0][1]], e.id) && nearest([e.x + q[0], e.y + q[1]], e.id);
})()));
if (arrows.length) {
  lines.push("Arrows (id: from -> to):");
  for (const a of arrows) {
    const pts = a.points || [[0, 0], [0, 0]];
    const p0 = [a.x + pts[0][0], a.y + pts[0][1]], p1 = [a.x + pts[pts.length - 1][0], a.y + pts[pts.length - 1][1]];
    const sb = a.startBinding && byId.get(a.startBinding.elementId), eb = a.endBinding && byId.get(a.endBinding.elementId);
    const s = sb || nearest(p0, a.id), t = eb || nearest(p1, a.id);
    const back = (x) => x && (x.boundElements || []).some((b) => b.id === a.id);
    const loose = [];
    if (a.type === "line") loose.push("line, cannot bind");
    else if (!sb) loose.push(s ? "start not bound" : "start free");
    if (a.type !== "line" && !eb) loose.push(t ? "end not bound" : "end free");
    if ((sb && !back(sb)) || (eb && !back(eb))) loose.push("binding one-sided");
    const lt = boundText(a);
    const rev = a.startArrowhead && !a.endArrowhead;
    const both = a.startArrowhead && a.endArrowhead;
    const [from, to] = rev ? [t, s] : [s, t];
    lines.push("  " + a.id + ": " + name(from) + (both ? " <-> " : " -> ") + name(to) + (lt ? " " + JSON.stringify(txt(lt)) : "")
      + (a.strokeStyle !== "solid" ? " (" + a.strokeStyle + ")" : "") + (loose.length ? " [" + loose.join(", ") + "]" : ""));
  }
}
const loose = freeTexts.filter((t) => !claimed.has(t.id) && !groups.some((g) => label(g) === txt(t) && inside(box(g), box(t))));
if (loose.length) {
  lines.push("Free text:");
  for (const t of loose) lines.push("  " + t.id + " " + JSON.stringify(txt(t)) + " @" + r(t.x) + "," + r(t.y) + " size " + t.fontSize + style(t) + container(t));
}
const other = els.filter((e) => ["freedraw", "line", "image"].includes(e.type) && !arrows.includes(e));
if (other.length) {
  lines.push("Other:");
  for (const o of other) {
    const b = box(o);
    const covers = shapes.filter((s) => !regions.has(s.id) && inside(b, box(s)) || (o.type !== "image" && (() => { const c = centre(box(s)); return c[0] >= b[0] && c[0] <= b[2] && c[1] >= b[1] && c[1] <= b[3]; })())).map(label).filter(Boolean);
    const what = o.type === "image" ? "image" : o.type + " (" + (o.points || []).length + " points)";
    lines.push("  " + o.id + " " + what + " @" + r(b[0]) + "," + r(b[1]) + " " + r(b[2] - b[0]) + "x" + r(b[3] - b[1]) + style(o) + (covers.length ? " around " + covers.join(", ") : ""));
  }
}
return { lines };
`;

export const EXCALIDRAW_SKILL: BuiltinSkill = {
  name: "copilot-excalidraw",
  version: EXCALIDRAW_SKILL_VERSION,
  skillMd: EXCALIDRAW_SKILL_MD,
  files: [{ path: "scripts/outline.md", content: OUTLINE_SCRIPT }],
};
