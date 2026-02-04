import { createPersistentHighlight } from "./persistentHighlight";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

describe("createPersistentHighlight", () => {
  describe("factory isolation", () => {
    it("creates independent instances with different class names", () => {
      const highlight1 = createPersistentHighlight("test-highlight-1");
      const highlight2 = createPersistentHighlight("test-highlight-2");

      // Each instance should have its own effect type
      expect(highlight1.effect).not.toBe(highlight2.effect);

      // Each instance should have its own field
      expect(highlight1.field).not.toBe(highlight2.field);
    });

    it("returns all required properties", () => {
      const highlight = createPersistentHighlight("test-highlight");

      expect(highlight.field).toBeDefined();
      expect(highlight.effect).toBeDefined();
      expect(highlight.extension).toBeDefined();
      expect(highlight.show).toBeDefined();
      expect(highlight.hide).toBeDefined();
      expect(highlight.buildEffects).toBeDefined();
      expect(highlight.getRange).toBeDefined();
    });
  });

  describe("with real EditorView", () => {
    let view: EditorView;
    let highlight: ReturnType<typeof createPersistentHighlight>;

    beforeEach(() => {
      highlight = createPersistentHighlight("test-highlight");

      // Create a real EditorView with the extension installed
      const state = EditorState.create({
        doc: "Hello World",
        extensions: [highlight.extension],
      });

      view = new EditorView({
        state,
        parent: document.createElement("div"),
      });
    });

    afterEach(() => {
      view.destroy();
    });

    describe("getRange", () => {
      it("returns null when no highlight is set", () => {
        expect(highlight.getRange(view)).toBeNull();
      });

      it("returns the range after show is called", () => {
        highlight.show(view, 0, 5);
        expect(highlight.getRange(view)).toEqual({ from: 0, to: 5 });
      });

      it("returns null after hide is called", () => {
        highlight.show(view, 0, 5);
        highlight.hide(view);
        expect(highlight.getRange(view)).toBeNull();
      });
    });

    describe("show", () => {
      it("sets the highlight range", () => {
        highlight.show(view, 0, 5);
        expect(highlight.getRange(view)).toEqual({ from: 0, to: 5 });
      });

      it("updates the highlight range when called again", () => {
        highlight.show(view, 0, 5);
        highlight.show(view, 6, 11);
        expect(highlight.getRange(view)).toEqual({ from: 6, to: 11 });
      });

      it("clamps range to document bounds", () => {
        // Document is "Hello World" (11 chars)
        highlight.show(view, -5, 100);
        const range = highlight.getRange(view);
        expect(range?.from).toBeGreaterThanOrEqual(0);
        expect(range?.to).toBeLessThanOrEqual(11);
      });

      it("normalizes inverted ranges (from > to)", () => {
        highlight.show(view, 10, 5);
        const range = highlight.getRange(view);
        expect(range?.from).toBe(5);
        expect(range?.to).toBe(10);
      });
    });

    describe("hide", () => {
      it("clears the highlight", () => {
        highlight.show(view, 0, 5);
        highlight.hide(view);
        expect(highlight.getRange(view)).toBeNull();
      });

      it("is a no-op when no highlight exists", () => {
        // Should not throw
        expect(() => highlight.hide(view)).not.toThrow();
        expect(highlight.getRange(view)).toBeNull();
      });
    });

    describe("buildEffects", () => {
      it("returns effects for showing highlight", () => {
        const effects = highlight.buildEffects(view, { from: 0, to: 5 });
        expect(effects.length).toBeGreaterThan(0);
      });

      it("returns effects for hiding highlight", () => {
        highlight.show(view, 0, 5);
        const effects = highlight.buildEffects(view, null);
        expect(effects.length).toBeGreaterThan(0);
      });

      it("returns empty array when hiding non-existent highlight", () => {
        // Create a view without the extension
        const bareState = EditorState.create({ doc: "Test" });
        const bareView = new EditorView({
          state: bareState,
          parent: document.createElement("div"),
        });

        const effects = highlight.buildEffects(bareView, null);
        expect(effects).toEqual([]);

        bareView.destroy();
      });

      it("treats empty range as hide and returns hide effect", () => {
        // First show a highlight
        highlight.show(view, 0, 5);

        // Empty range (from === to) should trigger hide
        const effects = highlight.buildEffects(view, { from: 5, to: 5 });
        // Should return a hide effect since extension is installed
        expect(effects.length).toBe(1);
      });
    });

    describe("document changes", () => {
      it("maps range through insertions before the range", () => {
        highlight.show(view, 6, 11); // "World"

        // Insert "Hey " at the beginning
        view.dispatch({
          changes: { from: 0, to: 0, insert: "Hey " },
        });

        const range = highlight.getRange(view);
        // Range should shift by 4 (length of "Hey ")
        expect(range).toEqual({ from: 10, to: 15 });
      });

      it("maps range through deletions before the range", () => {
        highlight.show(view, 6, 11); // "World"

        // Delete "Hello " (0-6)
        view.dispatch({
          changes: { from: 0, to: 6, insert: "" },
        });

        const range = highlight.getRange(view);
        // Range should shift back by 6
        expect(range).toEqual({ from: 0, to: 5 });
      });

      it("clears range when completely deleted", () => {
        highlight.show(view, 0, 5); // "Hello"

        // Delete everything
        view.dispatch({
          changes: { from: 0, to: 11, insert: "" },
        });

        // Range should be null (empty after deletion)
        expect(highlight.getRange(view)).toBeNull();
      });
    });
  });

  describe("without extension installed", () => {
    let view: EditorView;
    let highlight: ReturnType<typeof createPersistentHighlight>;

    beforeEach(() => {
      highlight = createPersistentHighlight("test-highlight");

      // Create view WITHOUT the extension
      const state = EditorState.create({
        doc: "Hello World",
      });

      view = new EditorView({
        state,
        parent: document.createElement("div"),
      });
    });

    afterEach(() => {
      view.destroy();
    });

    it("getRange returns null", () => {
      expect(highlight.getRange(view)).toBeNull();
    });

    it("show auto-installs the extension", () => {
      highlight.show(view, 0, 5);
      expect(highlight.getRange(view)).toEqual({ from: 0, to: 5 });
    });

    it("hide is a no-op", () => {
      expect(() => highlight.hide(view)).not.toThrow();
    });

    it("buildEffects includes appendConfig effect", () => {
      const effects = highlight.buildEffects(view, { from: 0, to: 5 });
      // Should include both appendConfig and setEffect
      expect(effects.length).toBe(2);
    });
  });
});
