export interface SceneElement {
  readonly id: string;
  readonly type: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly isDeleted?: boolean;
  readonly points?: ReadonlyArray<readonly number[]>;
  readonly boundElements?: ReadonlyArray<{ readonly id: string; readonly type: string }> | null;
  readonly containerId?: string | null;
  readonly frameId?: string | null;
  readonly text?: string;
  readonly rawText?: string;
  readonly originalText?: string;
  readonly name?: string | null;
  readonly fontSize?: number;
  readonly fontFamily?: number;
  readonly roughness?: number;
  readonly fillStyle?: string;
  readonly strokeWidth?: number;
  readonly groupIds?: readonly string[];
  readonly backgroundColor?: string;
  readonly strokeColor?: string;
  readonly strokeStyle?: string;
  readonly link?: string | null;
  readonly startBinding?: { readonly elementId: string } | null;
  readonly endBinding?: { readonly elementId: string } | null;
  readonly startArrowhead?: string | null;
  readonly endArrowhead?: string | null;
}

type Box = readonly [number, number, number, number];

const SHAPE_TYPES = new Set([
  "rectangle",
  "ellipse",
  "diamond",
  "stickynote",
  "image",
  "embeddable",
  "iframe",
]);
const DEFAULT_STROKES = new Set(["#1e1e1e", "#000000"]);
const MAX_OVERLAP_LINES = 40;

export function outlineScene(path: string, sceneElements: readonly SceneElement[]): string[] {
  const all = sceneElements.filter((e) => !e.isDeleted);
  // An icon arrives as a group of a dozen unlabelled strokes; listing each one would bury the diagram's real shapes.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/792
  const drawnGroups = new Map<string, SceneElement[]>();
  for (const e of all) {
    const g = e.groupIds?.[e.groupIds.length - 1];
    if (g) drawnGroups.set(g, [...(drawnGroups.get(g) ?? []), e]);
  }
  for (const [g, members] of drawnGroups) {
    if (members.some((m) => m.type === "text" || m.type === "arrow" || m.boundElements?.length))
      drawnGroups.delete(g);
  }
  const grouped = new Set([...drawnGroups.values()].flat());
  const els = all.filter((e) => !grouped.has(e));
  const byId = new Map(els.map((e) => [e.id, e]));
  const r = Math.round;
  const box = (e: SceneElement): Box => {
    if (e.points?.length) {
      const xs = e.points.map((p) => e.x + p[0]);
      const ys = e.points.map((p) => e.y + p[1]);
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    }
    return [e.x, e.y, e.x + e.width, e.y + e.height];
  };
  const inside = (o: Box, i: Box) =>
    o[0] <= i[0] + 2 && o[1] <= i[1] + 2 && o[2] >= i[2] - 2 && o[3] >= i[3] - 2;
  const area = (b: Box) => Math.max(1, (b[2] - b[0]) * (b[3] - b[1]));
  const contains = (b: Box, pt: readonly number[]) =>
    pt[0] >= b[0] && pt[0] <= b[2] && pt[1] >= b[1] && pt[1] <= b[3];
  const centre = (b: Box) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
  const size = (b: Box) => `@${r(b[0])},${r(b[1])} ${r(b[2] - b[0])}x${r(b[3] - b[1])}`;
  const txt = (t: SceneElement) =>
    (t.rawText || t.originalText || t.text || "").replace(/\s*\n\s*/g, " ").trim();
  const boundText = (e: SceneElement) => {
    const ref = (e.boundElements ?? []).find((b) => b.type === "text");
    const t = ref && byId.get(ref.id);
    return t ?? null;
  };

  const shapes = els.filter((e) => SHAPE_TYPES.has(e.type));
  const regions = new Set(
    shapes.filter((s) => shapes.some((o) => o !== s && inside(box(s), box(o)))).map((s) => s.id)
  );
  const frames = els.filter((e) => e.type === "frame" || e.type === "magicframe");
  const freeTexts = els.filter((e) => e.type === "text" && !e.containerId);
  const floating = new Map<string, SceneElement[]>();
  for (const t of freeTexts) {
    const c = centre(box(t));
    const host = shapes.find((s) => !regions.has(s.id) && !boundText(s) && contains(box(s), c));
    if (host) floating.set(host.id, [...(floating.get(host.id) ?? []), t]);
  }
  const claimed = new Set([...floating.values()].flat().map((t) => t.id));

  const label = (e: SceneElement): string => {
    const t = boundText(e);
    if (t) return txt(t);
    const loose = floating.get(e.id);
    if (loose) return loose.map(txt).join(" ");
    if (e.type === "frame") return e.name ?? "";
    if (e.type === "text") return txt(e);
    return "";
  };
  const name = (e: SceneElement | null | undefined) => {
    if (!e) return "?";
    const l = label(e);
    return l ? JSON.stringify(l) : `${e.type} ${e.id}`;
  };
  const ref = (e: SceneElement) =>
    `${e.type} ${e.id}${label(e) ? ` ${JSON.stringify(label(e))}` : ""}`;
  const container = (e: SceneElement) => {
    const b = box(e);
    const hits = [
      ...frames.filter((f) => e.frameId === f.id || inside(box(f), b)),
      ...shapes.filter((s) => regions.has(s.id) && s !== e && inside(box(s), b)),
    ];
    if (!hits.length) return "";
    const smallest = hits.sort((p, q) => area(box(p)) - area(box(q)))[0];
    return ` in ${name(smallest)}`;
  };
  const style = (e: SceneElement) => {
    const s: string[] = [];
    if (e.backgroundColor && e.backgroundColor !== "transparent")
      s.push(`fill ${e.backgroundColor}`);
    if (e.strokeColor && !DEFAULT_STROKES.has(e.strokeColor)) s.push(`stroke ${e.strokeColor}`);
    if (e.strokeStyle && e.strokeStyle !== "solid") s.push(e.strokeStyle);
    if (e.link) s.push(`link ${e.link}`);
    return s.length ? ` ${s.join(", ")}` : "";
  };
  const nearest = (pt: readonly number[], skip: string) => {
    let best: SceneElement | null = null;
    let gap = Infinity;
    for (const s of [
      ...shapes.filter((x) => !regions.has(x.id)),
      ...freeTexts.filter((t) => !claimed.has(t.id)),
    ]) {
      if (s.id === skip) continue;
      const b = box(s);
      const d = Math.hypot(
        Math.max(b[0] - pt[0], 0, pt[0] - b[2]),
        Math.max(b[1] - pt[1], 0, pt[1] - b[3])
      );
      if (d < gap) {
        best = s;
        gap = d;
      }
    }
    return gap <= 20 ? best : null;
  };

  const counts = new Map<string, number>();
  for (const e of all) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  const lines = [
    `${path}: ${all.length} elements (${[...counts].map(([k, v]) => `${k} ${v}`).join(", ")}). Positions are top-left x,y and width x height.`,
  ];
  const usual = (
    name: string,
    pool: readonly SceneElement[],
    value: (e: SceneElement) => string | number | undefined
  ) => {
    const tally = new Map<string | number, number>();
    for (const v of pool.map(value)) if (v !== undefined) tally.set(v, (tally.get(v) ?? 0) + 1);
    const top = [...tally].sort((p, q) => q[1] - p[1])[0];
    return top ? [`${name} ${top[0]}`] : [];
  };
  const texts = all.filter((e) => e.type === "text");
  const drawn = all.filter((e) => e.type !== "text");
  const filled = all.filter(
    (e) => SHAPE_TYPES.has(e.type) && e.backgroundColor && e.backgroundColor !== "transparent"
  );
  const look = [
    ...usual("font", texts, (e) => e.fontFamily),
    ...usual("font size", texts, (e) => e.fontSize),
    ...usual("roughness", drawn, (e) => e.roughness),
    ...usual("stroke width", drawn, (e) => e.strokeWidth),
    ...usual("fill", filled, (e) => e.fillStyle),
  ];
  if (look.length) lines.push(`Usual style: ${look.join(", ")}.`);

  const groups = [...frames, ...shapes.filter((s) => regions.has(s.id))];
  if (groups.length) {
    lines.push("Containers:");
    for (const g of groups) {
      const members = els.filter(
        (e) =>
          e !== g &&
          (SHAPE_TYPES.has(e.type) || e.type === "text") &&
          !e.containerId &&
          !claimed.has(e.id) &&
          !regions.has(e.id) &&
          (e.frameId === g.id || inside(box(g), box(e))) &&
          label(e) !== label(g)
      );
      lines.push(
        `  ${g.id} ${g.type} ${name(g)} ${size(box(g))}${style(g)}: ${members.map((m) => label(m) || m.type).join(", ")}`
      );
    }
  }

  lines.push("Nodes (id type label @x,y wxh; text id = the label's own id, for renames):");
  for (const s of shapes.filter((x) => !regions.has(x.id) && x.type !== "image")) {
    const t = boundText(s);
    const extra = floating.has(s.id)
      ? " [label is loose text, not bound]"
      : t
        ? ` text ${t.id}`
        : "";
    lines.push(`  ${s.id} ${s.type} ${name(s)} ${size(box(s))}${style(s)}${extra}${container(s)}`);
  }

  const connects = (e: SceneElement) => {
    const p = e.points ?? [[0, 0]];
    const q = p[p.length - 1];
    return nearest([e.x + p[0][0], e.y + p[0][1]], e.id) && nearest([e.x + q[0], e.y + q[1]], e.id);
  };
  // A line between two shapes reads as a connector but can never bind, so it is listed with the arrows and flagged.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/787
  const arrows = els.filter(
    (e) => e.type === "arrow" || (e.type === "line" && (e.points ?? []).length <= 6 && connects(e))
  );
  if (arrows.length) {
    lines.push("Arrows (id: from -> to; <-> both ways, -- no direction):");
    for (const a of arrows) {
      const pts = a.points?.length
        ? a.points
        : [
            [0, 0],
            [0, 0],
          ];
      const p0 = [a.x + pts[0][0], a.y + pts[0][1]];
      const p1 = [a.x + pts[pts.length - 1][0], a.y + pts[pts.length - 1][1]];
      const sb = a.startBinding ? byId.get(a.startBinding.elementId) : undefined;
      const eb = a.endBinding ? byId.get(a.endBinding.elementId) : undefined;
      const s = sb ?? nearest(p0, a.id);
      const t = eb ?? nearest(p1, a.id);
      const back = (x: SceneElement | undefined) =>
        (x?.boundElements ?? []).some((b) => b.id === a.id);
      const loose: string[] = [];
      if (a.type === "line") loose.push("line, cannot bind");
      else if (!sb) loose.push(s ? "start not bound" : "start free");
      if (a.type !== "line" && !eb) loose.push(t ? "end not bound" : "end free");
      if ((sb && !back(sb)) || (eb && !back(eb))) loose.push("binding one-sided");
      const lt = boundText(a);
      const reversed = a.startArrowhead && !a.endArrowhead;
      // A connector drawn without arrowheads has no direction, and reading it as one misstates the diagram.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/787
      const link = [" -- ", " -> ", " <-> "][
        [a.startArrowhead, a.endArrowhead].filter(Boolean).length
      ];
      const [from, to] = reversed ? [t, s] : [s, t];
      lines.push(
        `  ${a.id}: ${name(from)}${link}${name(to)}${lt ? ` ${JSON.stringify(txt(lt))}` : ""}` +
          `${a.strokeStyle && a.strokeStyle !== "solid" ? ` (${a.strokeStyle})` : ""}${loose.length ? ` [${loose.join(", ")}]` : ""}`
      );
    }
  }

  const loose = freeTexts.filter(
    (t) => !claimed.has(t.id) && !groups.some((g) => label(g) === txt(t) && inside(box(g), box(t)))
  );
  if (loose.length) {
    lines.push("Free text:");
    for (const t of loose) {
      lines.push(
        `  ${t.id} ${JSON.stringify(txt(t))} @${r(t.x)},${r(t.y)} size ${t.fontSize}${style(t)}${container(t)}`
      );
    }
  }

  const other = els.filter(
    (e) => ["freedraw", "line", "image"].includes(e.type) && !arrows.includes(e)
  );
  if (other.length) {
    lines.push("Other:");
    for (const o of other) {
      const b = box(o);
      const around = shapes
        .filter(
          (s) =>
            (!regions.has(s.id) && inside(b, box(s))) ||
            (o.type !== "image" && contains(b, centre(box(s))))
        )
        .map(label)
        .filter(Boolean);
      const what = o.type === "image" ? "image" : `${o.type} (${(o.points ?? []).length} points)`;
      lines.push(
        `  ${o.id} ${what} ${size(b)}${style(o)}${around.length ? ` around ${around.join(", ")}` : ""}`
      );
    }
  }

  const icons = [...drawnGroups].map(([id, members]) => {
    const boxes = members.map(box);
    const x = Math.min(...boxes.map((b) => b[0]));
    const y = Math.min(...boxes.map((b) => b[1]));
    const width = Math.max(...boxes.map((b) => b[2])) - x;
    const height = Math.max(...boxes.map((b) => b[3])) - y;
    return { id, type: "group", x, y, width, height, members };
  });
  if (icons.length) {
    lines.push("Icons and drawn groups (group id, parts; pass the group id to read its members):");
    for (const icon of icons) {
      const b = box(icon);
      const host = [...frames, ...shapes]
        .filter((s) => inside(box(s), b))
        .sort((p, q) => area(box(p)) - area(box(q)))[0];
      lines.push(
        `  ${icon.id} ${icon.members.length} parts ${size(b)}${host ? ` in ${name(host)}` : ""}`
      );
    }
  }

  const iconOnTop = new Map(icons.map((i) => [i.members[i.members.length - 1], i]));
  const layered = all.map((e) => iconOnTop.get(e) ?? e);
  lines.push(...overlaps(layered, [...shapes, ...freeTexts, ...icons], box, inside, area, ref));
  return lines;
}

// Each element is drawn over the ones before it, so a sticker tucked under a filled card looks attached to its neighbour.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/787
function overlaps(
  els: readonly SceneElement[],
  stackable: readonly SceneElement[],
  box: (e: SceneElement) => Box,
  inside: (o: Box, i: Box) => boolean,
  area: (b: Box) => number,
  ref: (e: SceneElement) => string
): string[] {
  const z = new Map(els.map((e, i) => [e.id, i]));
  const opaque = (e: SceneElement) =>
    e.type === "image" || Boolean(e.backgroundColor && e.backgroundColor !== "transparent");
  const found: Array<{ hidden: boolean; line: string }> = [];
  for (let i = 0; i < stackable.length; i++) {
    for (let j = i + 1; j < stackable.length; j++) {
      const [lo, hi] =
        (z.get(stackable[i].id) ?? 0) < (z.get(stackable[j].id) ?? 0)
          ? [stackable[i], stackable[j]]
          : [stackable[j], stackable[i]];
      const a = box(lo);
      const b = box(hi);
      const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
      const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
      if (w <= 2 || h <= 2 || inside(a, b)) continue;
      if (inside(b, a)) {
        if (opaque(hi)) {
          found.push({
            hidden: true,
            line: `  ${ref(hi)} over ${ref(lo)}, which sits inside it [hidden under a filled shape]`,
          });
        }
        continue;
      }
      const share = Math.round((100 * w * h) / Math.min(area(a), area(b)));
      const hidden = opaque(hi) && area(a) < area(b);
      found.push({
        hidden,
        line:
          `  ${ref(hi)} over ${ref(lo)} (${Math.round(w)}x${Math.round(h)}, ${share}% of the smaller${opaque(hi) ? "" : ", see-through"})` +
          (hidden ? " [smaller shape partly hidden under a filled one]" : ""),
      });
    }
  }
  if (!found.length) return [];
  found.sort((p, q) => Number(q.hidden) - Number(p.hidden));
  const out = ["Overlaps (drawn order: the first is on top of the second):"];
  out.push(...found.slice(0, MAX_OVERLAP_LINES).map((f) => f.line));
  if (found.length > MAX_OVERLAP_LINES) out.push(`  ... ${found.length - MAX_OVERLAP_LINES} more`);
  return out;
}
