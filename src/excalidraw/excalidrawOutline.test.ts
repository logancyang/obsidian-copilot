import { outlineScene, type SceneElement } from "./excalidrawOutline";

const ISSUE_787 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/787";

function shape(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  extra: Partial<SceneElement> = {}
): SceneElement {
  return { id, type: "rectangle", x, y, width, height, backgroundColor: "transparent", ...extra };
}

function labelled(
  id: string,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  extra: Partial<SceneElement> = {}
) {
  return [
    shape(id, x, y, width, height, { boundElements: [{ id: `${id}-t`, type: "text" }], ...extra }),
    shape(`${id}-t`, x + 10, y + 10, width - 20, 20, { type: "text", text, containerId: id }),
  ];
}

function boundArrow(
  id: string,
  from: string,
  to: string,
  x: number,
  y: number,
  dx: number,
  dy: number
) {
  return shape(id, x, y, dx, dy, {
    type: "arrow",
    points: [
      [0, 0],
      [dx, dy],
    ],
    startBinding: { elementId: from },
    endBinding: { elementId: to },
    endArrowhead: "arrow",
  });
}

function withArrow(
  elements: SceneElement[],
  arrowId: string,
  ...shapeIds: string[]
): SceneElement[] {
  return elements.map((e) =>
    shapeIds.includes(e.id)
      ? { ...e, boundElements: [...(e.boundElements ?? []), { id: arrowId, type: "arrow" }] }
      : e
  );
}

function stickerStraddlingTwoCards(order: "sticker-under-lower-card" | "sticker-on-top") {
  const upper = labelled("upper", "Apple Pay support", 0, 0, 260, 84, {
    backgroundColor: "#e7f5ff",
  });
  const lower = labelled("lower", "Address autocomplete", 0, 104, 260, 84, {
    backgroundColor: "#e7f5ff",
  });
  const sticker = labelled("sticker", "Blocked", 196, 78, 92, 40, {
    type: "ellipse",
    backgroundColor: "#ffc9c9",
  });
  return order === "sticker-on-top"
    ? [...upper, ...lower, ...sticker]
    : [...upper, ...sticker, ...lower];
}

describe("excalidrawOutline", () => {
  describe("outlineScene()", () => {
    it("opens with the path, the element count by type and how positions are written", () => {
      const lines = outlineScene(
        "Boards/Flow.excalidraw.md",
        labelled("a", "Start", 0, 0, 180, 80)
      );

      expect(lines[0]).toBe(
        "Boards/Flow.excalidraw.md: 2 elements (rectangle 1, text 1). Positions are top-left x,y and width x height."
      );
    });

    it("lists each shape with its id, label, position, size, fill, link and the id of its label text", () => {
      const lines = outlineScene(
        "Flow.excalidraw.md",
        labelled("a", "Start", 10.4, 20, 180, 80, {
          backgroundColor: "#a5d8ff",
          link: "[[Runbook]]",
        })
      );

      expect(lines).toContain(
        '  a rectangle "Start" @10,20 180x80 fill #a5d8ff, link [[Runbook]] text a-t'
      );
    });

    it("names an arrow by the labels of the shapes it joins and its own label", () => {
      const elements = withArrow(
        [
          ...labelled("a", "Write notes", 0, 0, 180, 80),
          ...labelled("b", "Review", 300, 0, 180, 80),
          {
            ...boundArrow("e", "a", "b", 180, 40, 120, 0),
            boundElements: [{ id: "e-t", type: "text" }],
          },
          shape("e-t", 220, 30, 40, 20, { type: "text", text: "ready", containerId: "e" }),
        ],
        "e",
        "a",
        "b"
      );

      expect(outlineScene("Flow.excalidraw.md", elements)).toContain(
        '  e: "Write notes" -> "Review" "ready"'
      );
    });

    it("lists the shapes sitting inside a larger shape as that container's members", () => {
      const elements = [
        ...labelled("lane", "Service owner", 0, 0, 600, 200, { backgroundColor: "#f8f9fa" }),
        ...labelled("step", "Approve mitigation", 40, 60, 200, 80),
      ];

      const lines = outlineScene("Roles.excalidraw.md", elements);

      expect(lines).toContain("Containers:");
      expect(lines).toContain(
        '  lane rectangle "Service owner" @0,0 600x200 fill #f8f9fa: Approve mitigation'
      );
      expect(lines).toContain(
        '  step rectangle "Approve mitigation" @40,60 200x80 text step-t in "Service owner"'
      );
    });

    it(`${ISSUE_787} flags loose text sitting on an unlabelled shape, because it will not move with the shape`, () => {
      const elements = [
        shape("box", 0, 0, 200, 80),
        shape("note", 20, 30, 120, 20, { type: "text", text: "Send email" }),
      ];

      expect(outlineScene("Flow.excalidraw.md", elements)).toContain(
        '  box rectangle "Send email" @0,0 200x80 [label is loose text, not bound]'
      );
    });

    it(`${ISSUE_787} flags an arrow whose link is recorded on the arrow but not on the shape, because it detaches on drag`, () => {
      const elements = withArrow(
        [
          ...labelled("a", "Start", 0, 0, 180, 80),
          ...labelled("b", "Finish", 300, 0, 180, 80),
          boundArrow("e", "a", "b", 180, 40, 120, 0),
        ],
        "e",
        "a"
      );

      expect(outlineScene("Flow.excalidraw.md", elements)).toContain(
        '  e: "Start" -> "Finish" [binding one-sided]'
      );
    });

    it(`${ISSUE_787} lists a line drawn between two shapes as a connector that cannot bind`, () => {
      const elements = [
        ...labelled("a", "Start", 0, 0, 180, 80),
        ...labelled("b", "Finish", 300, 0, 180, 80),
        shape("l", 180, 40, 120, 0, {
          type: "line",
          points: [
            [0, 0],
            [120, 0],
          ],
        }),
      ];

      expect(outlineScene("Flow.excalidraw.md", elements)).toContain(
        '  l: "Start" -> "Finish" [line, cannot bind]'
      );
    });

    it("leaves out deleted elements", () => {
      const elements = [
        ...labelled("a", "Start", 0, 0, 180, 80),
        shape("gone", 300, 0, 100, 50, { isDeleted: true }),
      ];

      const lines = outlineScene("Flow.excalidraw.md", elements);

      expect(lines[0]).toContain("2 elements");
      expect(lines.join("\n")).not.toContain("gone");
    });

    it("reports a sticker drawn over a card with the overlap's size and its share of the smaller shape", () => {
      const lines = outlineScene(
        "Board.excalidraw.md",
        stickerStraddlingTwoCards("sticker-on-top")
      );

      expect(lines).toContain("Overlaps (drawn order: the first is on top of the second):");
      expect(lines).toContain(
        '  ellipse sticker "Blocked" over rectangle lower "Address autocomplete" (64x14, 24% of the smaller)'
      );
      expect(lines).toContain(
        '  ellipse sticker "Blocked" over rectangle upper "Apple Pay support" (64x6, 10% of the smaller)'
      );
    });

    it(`${ISSUE_787} flags a sticker partly hidden under a filled card drawn after it, listing it first`, () => {
      const lines = outlineScene(
        "Board.excalidraw.md",
        stickerStraddlingTwoCards("sticker-under-lower-card")
      );
      const start = lines.indexOf("Overlaps (drawn order: the first is on top of the second):");

      expect(lines.slice(start + 1)).toEqual([
        '  rectangle lower "Address autocomplete" over ellipse sticker "Blocked" (64x14, 24% of the smaller) [smaller shape partly hidden under a filled one]',
        '  ellipse sticker "Blocked" over rectangle upper "Apple Pay support" (64x6, 10% of the smaller)',
      ]);
    });

    it("marks an overlap by a transparent shape as see-through without flagging it", () => {
      const elements = [
        shape("small", 0, 0, 60, 40, { backgroundColor: "#ffc9c9" }),
        shape("big", 40, 20, 200, 100),
      ];

      expect(outlineScene("Board.excalidraw.md", elements)).toContain(
        "  rectangle big over rectangle small (20x20, 17% of the smaller, see-through)"
      );
    });

    it(`${ISSUE_787} flags a shape drawn under a filled shape that covers it completely`, () => {
      const elements = [
        shape("card", 40, 40, 100, 50),
        shape("panel", 0, 0, 300, 200, { backgroundColor: "#f1f3f5" }),
      ];

      expect(outlineScene("Board.excalidraw.md", elements)).toContain(
        "  rectangle panel over rectangle card, which sits inside it [hidden under a filled shape]"
      );
    });

    it("does not report a background drawn under the shapes it contains", () => {
      const elements = [
        shape("panel", 0, 0, 300, 200, { backgroundColor: "#f1f3f5" }),
        shape("card", 40, 40, 100, 50),
      ];

      expect(outlineScene("Board.excalidraw.md", elements).join("\n")).not.toContain("Overlaps");
    });

    it(`${ISSUE_787} lists at most 40 overlaps, flagged ones first, and counts the rest`, () => {
      const cards = Array.from({ length: 46 }, (_, i) =>
        shape(`c${i}`, i * 50, 0, 60, 40, { backgroundColor: i === 45 ? "#ffffff" : "transparent" })
      );
      const hiddenUnder = shape("tiny", 45 * 50 - 5, 10, 20, 20, { backgroundColor: "#ffc9c9" });

      const lines = outlineScene("Strip.excalidraw.md", [hiddenUnder, ...cards]);
      const start = lines.indexOf("Overlaps (drawn order: the first is on top of the second):");

      expect(lines[start + 1]).toContain("[smaller shape partly hidden under a filled one]");
      expect(lines.slice(start + 1)).toHaveLength(41);
      expect(lines[lines.length - 1]).toMatch(/^ {2}\.\.\. \d+ more$/);
    });
  });
});
