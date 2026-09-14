import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import { parse } from "yaml";
const workflow = parse(fs.readFileSync(".github/workflows/pr-size.yml", "utf8"));
const run = new (Object.getPrototypeOf(async function () {}).constructor)(
  "github",
  "context",
  "core",
  workflow.jobs.label.steps[0].with.script
);
const file = (filename, additions, deletions = 0) => ({ filename, additions, deletions });
async function check(files, expected, options = {}) {
  const labels = new Set(["bug", "size/L"]);
  const created = [];
  const rest = {
    pulls: {
      listFiles: "files",
      get: async () => ({ data: { changed_files: options.total ?? files.length } }),
    },
    issues: {
      listLabelsForRepo: "repoLabels",
      listLabelsOnIssue: "currentLabels",
      createLabel: async ({ name }) => {
        created.push(name);
        if (options.error) throw options.error;
      },
      addLabels: async ({ labels: names }) => names.forEach((name) => labels.add(name)),
      removeLabel: async ({ name }) => labels.delete(name),
    },
  };
  await run(
    {
      rest,
      paginate: async (endpoint, args) => {
        assert.equal(args.per_page, 100);
        return endpoint === "files"
          ? files
          : endpoint === "repoLabels"
            ? []
            : [...labels].map((name) => ({ name }));
      },
    },
    { repo: { owner: "test", repo: "test" }, issue: { number: 1 } },
    { info: () => {} }
  );
  assert.deepEqual([...labels].sort(), ["bug", expected].sort());
  assert.deepEqual(created, [expected]);
}
describe("pr-size workflow", () => {
  describe("label()", () => {
    for (const [n, size] of [
      [0, "XS"],
      [49, "XS"],
      [50, "S"],
      [99, "S"],
      [100, "M"],
      [299, "M"],
      [300, "L"],
      [499, "L"],
      [500, "XL"],
    ]) {
      it(`labels ${n} production lines as size/${size} while preserving unrelated labels`, async () => {
        await check([file("src/main.ts", n)], `size/${size}`);
      });
    }
    it("counts additions and deletions together", async () => {
      await check([file("src/main.ts", 50, 50)], "size/M");
    });
    it("counts fully deleted production files", async () => {
      await check([file("src/deleted.ts", 0, 100)], "size/M");
    });
    it("excludes stories, tests, fixtures, mocks and files outside src", async () => {
      await check(
        [
          "src/a.stories.tsx",
          "src/a.test.ts",
          "src/a.spec.ts",
          "src/__tests__/a.ts",
          "src/__mocks__/a.ts",
          "src/__fixtures__/a.json",
          "src/fixtures/a.json",
          "docs/a.md",
          "package-lock.json",
          "styles.css",
        ].map((path) => file(path, 1000)),
        "size/XS"
      );
    });
    it("counts production files beyond the first 100 changed files", async () => {
      await check(
        [
          ...Array.from({ length: 100 }, (_, i) => file(`src/a${i}.test.ts`, 1000)),
          file("src/real.ts", 350),
        ],
        "size/L"
      );
    });
    it("labels incomplete file lists XL instead of undercounting the PR", async () => {
      await check([file("src/main.ts", 1)], "size/XL", { total: 3001 });
    });
    it("continues when another PR creates the same label concurrently", async () => {
      await check([], "size/XS", {
        error: { status: 422, response: { data: { errors: [{ code: "already_exists" }] } } },
      });
    });
    it("propagates label creation failures", async () => {
      await assert.rejects(
        check([], "size/XS", { error: new Error("API unavailable") }),
        /API unavailable/
      );
    });
  });
});
