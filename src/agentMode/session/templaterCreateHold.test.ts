import type { App } from "obsidian";
import { TemplaterCreateHold } from "@/agentMode/session/templaterCreateHold";

function appWithTemplater(pending: Set<string>): App {
  const templater = { templater: { files_with_pending_templates: pending } };
  return {
    plugins: { getPlugin: (id: string) => (id === "templater-obsidian" ? templater : null) },
  } as unknown as App;
}

describe("templaterCreateHold", () => {
  describe("TemplaterCreateHold", () => {
    describe("hold()", () => {
      it("https://github.com/logancyang/obsidian-copilot/issues/3704 marks the path as one Templater's on-create trigger skips", () => {
        const pending = new Set<string>();
        new TemplaterCreateHold().hold(appWithTemplater(pending), "notes/sync.md");

        expect([...pending]).toEqual(["notes/sync.md"]);
      });

      it("does nothing when Templater is not installed", () => {
        const app = { plugins: { getPlugin: () => null } } as unknown as App;
        const hold = new TemplaterCreateHold();

        expect(() => hold.hold(app, "notes/sync.md")).not.toThrow();
      });
    });

    describe("releaseAll()", () => {
      it("returns every held path to Templater", () => {
        const pending = new Set<string>();
        const app = appWithTemplater(pending);
        const hold = new TemplaterCreateHold();
        hold.hold(app, "notes/a.md");
        hold.hold(app, "notes/b.md");

        hold.releaseAll();

        expect(pending.size).toBe(0);
      });

      it("leaves a path Templater was already writing for Templater to clear", () => {
        const pending = new Set(["notes/from-template.md"]);
        const hold = new TemplaterCreateHold();
        hold.hold(appWithTemplater(pending), "notes/from-template.md");

        hold.releaseAll();

        expect([...pending]).toEqual(["notes/from-template.md"]);
      });
    });
  });
});
