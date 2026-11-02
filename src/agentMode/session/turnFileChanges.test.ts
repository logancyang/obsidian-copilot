import {
  buildTurnFileChange,
  FileCaptures,
  filePatchesByVaultPath,
  revertFilePatch,
} from "@/agentMode/session/turnFileChanges";

const ISSUE_763 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/763";

function makeDisk(initial: Record<string, string>) {
  const files = new Map(Object.entries(initial));
  const read = jest.fn(async (path: string) => files.get(path) ?? null);
  return { files, read };
}

async function changesOf(captures: FileCaptures, disk: ReturnType<typeof makeDisk>) {
  return (await captures.changes(disk.read)).map(({ path, status, before, after }) => ({
    path,
    status,
    before,
    after,
  }));
}

function editThroughTool(
  captures: FileCaptures,
  disk: ReturnType<typeof makeDisk>,
  path: string,
  content: string
): void {
  captures.observe(path, disk.read).edited = true;
  disk.files.set(path, content);
}

function move(disk: ReturnType<typeof makeDisk>, oldPath: string, newPath: string): void {
  disk.files.set(newPath, disk.files.get(oldPath) ?? "");
  disk.files.delete(oldPath);
}

const PLAN_BEFORE =
  "# Project Plan\n\n## Goals\n\n- Ship the beta\n- Collect feedback\n\n## Timeline\n\nWeek 1: design\nWeek 2: build\nWeek 3: test\n\n## Risks\n\nNone known yet.\n\n## Notes\n\nLast line without newline";
const PLAN_AFTER =
  "# Project Plan\n\n## Goals\n\n- Ship the beta on Friday\n- Collect feedback\n\n## Timeline\n\nWeek 1: design\nWeek 2: build\nWeek 3: test\nWeek 4: release\n\n## Risks\n\nVendor delay is possible.\n\n## Notes\n\nLast line without newline\n";

const CODEX_TURN_DIFF = {
  root: "/repo",
  unifiedDiff: [
    "diff --git a/vault/notes/obsolete.md b/vault/notes/obsolete.md",
    "deleted file mode 100644",
    "index aab8398..0000000",
    "--- a/vault/notes/obsolete.md",
    "+++ /dev/null",
    "@@ -1 +0,0 @@",
    "-This note is obsolete.",
    "diff --git a/vault/notes/plan.md b/vault/notes/plan.md",
    "index b369ee9..aec1ef1",
    "--- a/vault/notes/plan.md",
    "+++ b/vault/notes/plan.md",
    "@@ -2,7 +2,7 @@",
    " ",
    " ## Goals",
    " ",
    "-- Ship the beta",
    "+- Ship the beta on Friday",
    " - Collect feedback",
    " ",
    " ## Timeline",
    "@@ -10,11 +10,12 @@",
    " Week 1: design",
    " Week 2: build",
    " Week 3: test",
    "+Week 4: release",
    " ",
    " ## Risks",
    " ",
    "-None known yet.",
    "+Vendor delay is possible.",
    " ",
    " ## Notes",
    " ",
    "-Last line without newline",
    "\\ No newline at end of file",
    "+Last line without newline",
    "diff --git a/vault/notes/retro.md b/vault/notes/retro.md",
    "new file mode 100644",
    "index 0000000..36a9e59",
    "--- /dev/null",
    "+++ b/vault/notes/retro.md",
    "@@ -0,0 +1,3 @@",
    "+# Retro",
    "+",
    "+Went well.",
    "",
  ].join("\n"),
};

const CRLF_TURN_DIFF = {
  root: "/vault",
  unifiedDiff: [
    "diff --git a/crlf-gone.md b/crlf-gone.md",
    "deleted file mode 100644",
    "index 2467add7a44c04dfed438103da76d7fffeb9c1a4..0000000000000000000000000000000000000000",
    "--- a/crlf-gone.md",
    "+++ /dev/null",
    "@@ -1,2 +0,0 @@",
    "-Old list\r",
    "-remove me\r",
    "diff --git a/crlf-new.md b/crlf-new.md",
    "new file mode 100644",
    "index 0000000000000000000000000000000000000000..fbbee861521bd5355538b096fa3998541cd33909",
    "--- /dev/null",
    "+++ b/crlf-new.md",
    "@@ -0,0 +1,2 @@",
    "+alpha",
    "+beta",
    "diff --git a/crlf.md b/crlf.md",
    "index 924346369968f5c67c7c20bb88342262f3c26d31..222906096397faeefca791618698b6ff13a8e076",
    "--- a/crlf.md",
    "+++ b/crlf.md",
    "@@ -1,5 +1,6 @@",
    " # Shopping\r",
    " \r",
    " - milk\r",
    "-- eggs\r",
    "-- bread\r",
    "+- a dozen eggs",
    "+- bread",
    "+- butter",
    "",
  ].join("\n"),
};

const UNICODE_TURN_DIFF = {
  root: "/vault",
  unifiedDiff: [
    "diff --git a/Notes/café plan.md b/Notes/café plan.md",
    "index 9f5be7ff8903191ca973ce613307699bcbd1fd30..8e0c095a6e2b10c0052da1ba4560a8a385a1dd72",
    "--- a/Notes/café plan.md",
    "+++ b/Notes/café plan.md",
    "@@ -1,4 +1,4 @@",
    " # Café plan",
    " ",
    "-Open on Monday.",
    "+Open on Tuesday.",
    " Serve crêpes.",
    "diff --git a/Notes/naïve idea 2.md b/Notes/naïve idea 2.md",
    "new file mode 100644",
    "index 0000000000000000000000000000000000000000..05f0201bd90188d92fb8d8aaf3b74acfa2fe7922",
    "--- /dev/null",
    "+++ b/Notes/naïve idea 2.md",
    "@@ -0,0 +1 @@",
    "+Try a 日本語 menu.",
    "",
  ].join("\n"),
};

const TRAILING_NEWLINE_REMOVED_TURN_DIFF = {
  root: "/vault",
  unifiedDiff: [
    "diff --git a/tail.md b/tail.md",
    "index ac04283b6b69b9265da7e5bedbccadda09493aec..65ba5b1408f13c963426f66358adad0042bbdfb9",
    "--- a/tail.md",
    "+++ b/tail.md",
    "@@ -1,3 +1,3 @@",
    " first",
    " second",
    "-last line",
    "+LAST LINE",
    "\\ No newline at end of file",
    "",
  ].join("\n"),
};

const PATCH_THEN_SHELL_TURN_DIFF = {
  root: "/vault",
  unifiedDiff: [
    "diff --git a/mix.md b/mix.md",
    "index 1e395f2a2cc7a4eb70a20ce75a277933f71a968b..4d8fac743011ad10cef2e996554e6d337f699c2e",
    "--- a/mix.md",
    "+++ b/mix.md",
    "@@ -1,5 +1,5 @@",
    " alpha",
    "-beta",
    "+BETA",
    " gamma",
    " delta",
    " epsilon",
    "",
  ].join("\n"),
};

function patchFor(path: string, turnDiff = CODEX_TURN_DIFF, vaultBase = "/repo/vault") {
  const patch = filePatchesByVaultPath(turnDiff, vaultBase).get(path);
  if (!patch) throw new Error(`no patch for ${path}`);
  return patch;
}

describe("turnFileChanges", () => {
  describe("filePatchesByVaultPath()", () => {
    it("keys each file's patch by its vault path when the diff root is a repository above the vault https://github.com/Brevilabs/obsidian-copilot-private/issues/347", () => {
      const patches = filePatchesByVaultPath(CODEX_TURN_DIFF, "/repo/vault");

      expect([...patches.keys()].sort()).toEqual([
        "notes/obsolete.md",
        "notes/plan.md",
        "notes/retro.md",
      ]);
    });

    it("keys paths relative to the vault itself when the diff root is the vault, as it is for a vault that is not a git repository", () => {
      const patches = filePatchesByVaultPath(
        {
          root: "/repo/vault/",
          unifiedDiff: CODEX_TURN_DIFF.unifiedDiff.replace(/([ab])\/vault\//g, "$1/"),
        },
        "/repo/vault"
      );

      expect(patches.has("notes/plan.md")).toBe(true);
    });

    it("keys file names with spaces and non-ASCII characters exactly as Codex writes them", () => {
      expect([...filePatchesByVaultPath(UNICODE_TURN_DIFF, "/vault").keys()]).toEqual([
        "Notes/café plan.md",
        "Notes/naïve idea 2.md",
      ]);
    });

    it("keys paths relative to the vault when the diff root is a Windows path", () => {
      const patches = filePatchesByVaultPath(
        {
          root: "C:\\Users\\me\\repo\\",
          unifiedDiff: CODEX_TURN_DIFF.unifiedDiff,
        },
        "C:\\Users\\me\\repo\\vault"
      );

      expect([...patches.keys()].sort()).toEqual([
        "notes/obsolete.md",
        "notes/plan.md",
        "notes/retro.md",
      ]);
    });

    it("leaves a renamed file out so both of its paths fall back to their own snapshots https://github.com/Brevilabs/obsidian-copilot-private/issues/347", () => {
      const patches = filePatchesByVaultPath(
        {
          root: "/repo",
          unifiedDiff: [
            "diff --git a/vault/old.md b/vault/new.md",
            "similarity index 80%",
            "rename from vault/old.md",
            "rename to vault/new.md",
            "--- a/vault/old.md",
            "+++ b/vault/new.md",
            "@@ -1 +1 @@",
            "-old",
            "+new",
            "",
          ].join("\n"),
        },
        "/repo/vault"
      );

      expect(patches.size).toBe(0);
    });
  });

  describe("revertFilePatch()", () => {
    it("recovers a multi-hunk edit's original bytes, including an insertion-only hunk and a missing final newline", () => {
      expect(revertFilePatch(patchFor("notes/plan.md"), PLAN_AFTER)).toBe(PLAN_BEFORE);
    });

    it("recovers CRLF originals byte for byte, including lines apply_patch rewrote with LF endings", () => {
      expect(
        revertFilePatch(
          patchFor("crlf.md", CRLF_TURN_DIFF, "/vault"),
          "# Shopping\r\n\r\n- milk\r\n- a dozen eggs\n- bread\n- butter\n"
        )
      ).toBe("# Shopping\r\n\r\n- milk\r\n- eggs\r\n- bread\r\n");
      expect(revertFilePatch(patchFor("crlf-gone.md", CRLF_TURN_DIFF, "/vault"), null)).toBe(
        "Old list\r\nremove me\r\n"
      );
      expect(
        revertFilePatch(patchFor("crlf-new.md", CRLF_TURN_DIFF, "/vault"), "alpha\nbeta\n")
      ).toBeNull();
    });

    it("recovers a file whose edit removed its final newline", () => {
      expect(
        revertFilePatch(
          patchFor("tail.md", TRAILING_NEWLINE_REMOVED_TURN_DIFF, "/vault"),
          "first\nsecond\nLAST LINE"
        )
      ).toBe("first\nsecond\nlast line\n");
    });

    it("keeps a later shell change outside the patched lines in the recovered text, so the entry shows only apply_patch's change https://github.com/Brevilabs/obsidian-copilot-private/issues/689", () => {
      expect(
        revertFilePatch(
          patchFor("mix.md", PATCH_THEN_SHELL_TURN_DIFF, "/vault"),
          "alpha\nBETA\ngamma\ndelta\nepsilon\nzeta\neta\nTHETA\n"
        )
      ).toBe("alpha\nbeta\ngamma\ndelta\nepsilon\nzeta\neta\nTHETA\n");
    });

    it("returns null for a file the patch created", () => {
      expect(revertFilePatch(patchFor("notes/retro.md"), "# Retro\n\nWent well.\n")).toBeNull();
    });

    it("recovers the content of a file the patch deleted", () => {
      expect(revertFilePatch(patchFor("notes/obsolete.md"), null)).toBe("This note is obsolete.\n");
    });

    it("returns undefined when the file changed after the patch so it no longer applies https://github.com/Brevilabs/obsidian-copilot-private/issues/347", () => {
      expect(
        revertFilePatch(patchFor("notes/plan.md"), "# Project Plan\n\nRewritten by the user.\n")
      ).toBeUndefined();
    });

    it("returns undefined for an edited file that is now missing or a deleted file that is back https://github.com/Brevilabs/obsidian-copilot-private/issues/347", () => {
      expect(revertFilePatch(patchFor("notes/plan.md"), null)).toBeUndefined();
      expect(revertFilePatch(patchFor("notes/obsolete.md"), "recreated\n")).toBeUndefined();
    });
  });

  describe("buildTurnFileChange()", () => {
    it("counts the added and removed lines of an edited file", () => {
      expect(
        buildTurnFileChange("notes/a.md", "one\ntwo\nthree\n", "one\nTWO\nthree\nfour\n")
      ).toEqual({
        path: "notes/a.md",
        status: "modified",
        before: "one\ntwo\nthree\n",
        after: "one\nTWO\nthree\nfour\n",
        additions: 2,
        deletions: 1,
      });
    });

    it("reports a file that did not exist before the turn as created (https://github.com/Brevilabs/obsidian-copilot-private/issues/347)", () => {
      const change = buildTurnFileChange("notes/new.md", null, "fresh\nnote\n");
      expect(change).toMatchObject({
        status: "created",
        before: null,
        additions: 2,
        deletions: 0,
      });
    });

    it("reports a file the turn removed as deleted (https://github.com/Brevilabs/obsidian-copilot-private/issues/347)", () => {
      const change = buildTurnFileChange("notes/gone.md", "one\ntwo\n", null);
      expect(change).toMatchObject({
        status: "deleted",
        after: null,
        additions: 0,
        deletions: 2,
      });
    });

    it("returns null when the turn left the file byte-identical", () => {
      expect(buildTurnFileChange("notes/a.md", "same\n", "same\n")).toBeNull();
    });

    it("returns null for a file that never existed on either side (https://github.com/Brevilabs/obsidian-copilot-private/issues/347)", () => {
      expect(buildTurnFileChange("notes/ghost.md", null, null)).toBeNull();
    });

    it("counts an emptied file's every line as removed (https://github.com/Brevilabs/obsidian-copilot-private/issues/347)", () => {
      expect(buildTurnFileChange("notes/a.md", "one\ntwo\n", "")).toMatchObject({
        status: "modified",
        additions: 0,
        deletions: 2,
      });
    });
  });
  describe("FileCaptures", () => {
    describe("hasEdits()", () => {
      it("reports no edits for a capture that only read files", () => {
        const disk = makeDisk({ "notes/a.md": "a\n" });
        const captures = new FileCaptures();
        captures.observe("notes/a.md", disk.read);
        expect(captures.hasEdits()).toBe(false);
      });

      it(`reports edits once the vault deletes a captured file (${ISSUE_763})`, () => {
        const disk = makeDisk({ "notes/a.md": "a\n" });
        const captures = new FileCaptures();
        captures.observe("notes/a.md", disk.read);
        captures.vaultDeleted("notes/a.md");
        expect(captures.hasEdits()).toBe(true);
      });
    });

    describe("observe()", () => {
      it("returns one capture for repeated observations of a path, so its change is reported once", async () => {
        const disk = makeDisk({ "notes/a.md": "one\n" });
        const captures = new FileCaptures();
        editThroughTool(captures, disk, "notes/a.md", "two\n");
        const first = captures.observe("notes/a.md", disk.read);
        expect(captures.observe("notes/a.md", disk.read)).toBe(first);
        disk.files.set("notes/a.md", "three\n");

        expect(await changesOf(captures, disk)).toEqual([
          { path: "notes/a.md", status: "modified", before: "one\n", after: "three\n" },
        ]);
        expect(disk.read).toHaveBeenCalledTimes(2);
      });

      it(`treats a path observed after its original file moved away as a file made during the turn (${ISSUE_763})`, async () => {
        const disk = makeDisk({ "notes/a.md": "original\n" });
        const captures = new FileCaptures();
        captures.observe("notes/a.md", disk.read);
        move(disk, "notes/a.md", "notes/b.md");
        captures.vaultRenamed("notes/a.md", "notes/b.md", true, disk.read);

        expect(captures.observe("notes/a.md", disk.read).origin).toBeNull();
      });
    });

    describe("vaultCreated()", () => {
      it(`adopts a file the turn never mentioned and reports it created with its final content (${ISSUE_763})`, async () => {
        const disk = makeDisk({});
        const captures = new FileCaptures();
        disk.files.set("notes/new.md", "draft\n");
        captures.vaultCreated("notes/new.md", true);
        disk.files.set("notes/new.md", "final\n");

        expect(await changesOf(captures, disk)).toEqual([
          { path: "notes/new.md", status: "created", before: null, after: "final\n" },
        ]);
      });

      it(`leaves out a file the turn never mentioned when this capture does not adopt it (${ISSUE_763})`, async () => {
        const disk = makeDisk({ "notes/new.md": "draft\n" });
        const captures = new FileCaptures();
        captures.vaultCreated("notes/new.md", false);

        expect(captures.hasEdits()).toBe(false);
        expect(await changesOf(captures, disk)).toEqual([]);
      });

      it(`reports a tool-written file once when the vault also reports its creation, in either order (${ISSUE_763})`, async () => {
        for (const vaultFirst of [true, false]) {
          const disk = makeDisk({});
          const captures = new FileCaptures();
          if (vaultFirst) {
            disk.files.set("notes/new.md", "fresh\n");
            captures.vaultCreated("notes/new.md", true);
            captures.observe("notes/new.md", disk.read).edited = true;
          } else {
            captures.observe("notes/new.md", disk.read).edited = true;
            disk.files.set("notes/new.md", "fresh\n");
            captures.vaultCreated("notes/new.md", true);
          }

          expect(await changesOf(captures, disk)).toEqual([
            { path: "notes/new.md", status: "created", before: null, after: "fresh\n" },
          ]);
        }
      });

      it(`omits a file created and deleted within the turn (${ISSUE_763})`, async () => {
        const disk = makeDisk({});
        const captures = new FileCaptures();
        disk.files.set("notes/tmp.md", "scratch\n");
        captures.vaultCreated("notes/tmp.md", true);
        disk.files.delete("notes/tmp.md");
        captures.vaultDeleted("notes/tmp.md");

        expect(await changesOf(captures, disk)).toEqual([]);
      });

      it(`ignores a creation inside a hidden folder (${ISSUE_763})`, () => {
        const captures = new FileCaptures();
        captures.vaultCreated(".trash/old.md", true);

        expect(captures.hasEdits()).toBe(false);
      });
    });

    describe("vaultRenamed()", () => {
      it(`follows an edited note through a rename and reports one change at its destination against its original text (${ISSUE_763})`, async () => {
        const disk = makeDisk({ "notes/a.md": "original\n" });
        const captures = new FileCaptures();
        editThroughTool(captures, disk, "notes/a.md", "edited\n");
        move(disk, "notes/a.md", "notes/b.md");
        captures.vaultRenamed("notes/a.md", "notes/b.md", true, disk.read);

        expect(await changesOf(captures, disk)).toEqual([
          { path: "notes/b.md", status: "modified", before: "original\n", after: "edited\n" },
        ]);
      });

      it(`follows a note through repeated renames to its last path (${ISSUE_763})`, async () => {
        const disk = makeDisk({ "notes/a.md": "original\n" });
        const captures = new FileCaptures();
        editThroughTool(captures, disk, "notes/a.md", "edited\n");
        for (const [from, to] of [
          ["notes/a.md", "notes/b.md"],
          ["notes/b.md", "archive/c.md"],
        ]) {
          move(disk, from, to);
          captures.vaultRenamed(from, to, true, disk.read);
        }

        expect(await changesOf(captures, disk)).toEqual([
          { path: "archive/c.md", status: "modified", before: "original\n", after: "edited\n" },
        ]);
      });

      it(`follows a note through its folder's rename once, whether the folder or the child event arrives first (${ISSUE_763})`, async () => {
        for (const folderFirst of [true, false]) {
          const disk = makeDisk({ "F/a.md": "original\n" });
          const captures = new FileCaptures();
          editThroughTool(captures, disk, "F/a.md", "edited\n");
          move(disk, "F/a.md", "G/a.md");
          const folderEvent = () => captures.vaultRenamed("F", "G", false, disk.read);
          const childEvent = () => captures.vaultRenamed("F/a.md", "G/a.md", true, disk.read);
          if (folderFirst) {
            folderEvent();
            childEvent();
          } else {
            childEvent();
            folderEvent();
          }

          expect(await changesOf(captures, disk)).toEqual([
            { path: "G/a.md", status: "modified", before: "original\n", after: "edited\n" },
          ]);
        }
      });

      it(`reports a move the tool also announced as a delete and a write once, whichever arrives first (${ISSUE_763})`, async () => {
        for (const vaultFirst of [true, false]) {
          const disk = makeDisk({ "notes/a.md": "original\n" });
          const captures = new FileCaptures();
          const announce = () => {
            captures.observe("notes/a.md", disk.read).edited = true;
            captures.observe("notes/b.md", disk.read).edited = true;
          };
          const rename = () => {
            move(disk, "notes/a.md", "notes/b.md");
            captures.vaultRenamed("notes/a.md", "notes/b.md", true, disk.read);
          };
          if (vaultFirst) {
            rename();
            announce();
          } else {
            announce();
            rename();
          }
          disk.files.set("notes/b.md", "edited\n");

          expect(await changesOf(captures, disk)).toEqual([
            { path: "notes/b.md", status: "modified", before: "original\n", after: "edited\n" },
          ]);
        }
      });

      it(`compares a file the turn never mentioned with the text it carried into the rename (${ISSUE_763})`, async () => {
        const disk = makeDisk({ "notes/a.md": "original\n" });
        const captures = new FileCaptures();
        move(disk, "notes/a.md", "notes/b.md");
        captures.vaultRenamed("notes/a.md", "notes/b.md", true, disk.read);
        disk.files.set("notes/b.md", "edited\n");

        expect(await changesOf(captures, disk)).toEqual([
          { path: "notes/b.md", status: "modified", before: "original\n", after: "edited\n" },
        ]);
      });

      it(`keeps a new file at a renamed note's old path as its own creation (${ISSUE_763})`, async () => {
        const disk = makeDisk({ "notes/a.md": "original\n" });
        const captures = new FileCaptures();
        editThroughTool(captures, disk, "notes/a.md", "edited\n");
        move(disk, "notes/a.md", "notes/b.md");
        captures.vaultRenamed("notes/a.md", "notes/b.md", true, disk.read);
        disk.files.set("notes/a.md", "replacement\n");
        captures.vaultCreated("notes/a.md", true);

        expect(await changesOf(captures, disk)).toEqual([
          { path: "notes/b.md", status: "modified", before: "original\n", after: "edited\n" },
          { path: "notes/a.md", status: "created", before: null, after: "replacement\n" },
        ]);
      });

      it(`compares each path with its own original when a note moves onto a path whose file was deleted (${ISSUE_763})`, async () => {
        const disk = makeDisk({ "notes/a.md": "a\n", "notes/x.md": "x\n" });
        const captures = new FileCaptures();
        captures.observe("notes/a.md", disk.read).edited = true;
        captures.observe("notes/x.md", disk.read).edited = true;
        disk.files.delete("notes/x.md");
        captures.vaultDeleted("notes/x.md");
        move(disk, "notes/a.md", "notes/x.md");
        captures.vaultRenamed("notes/a.md", "notes/x.md", true, disk.read);

        expect(await changesOf(captures, disk)).toEqual([
          { path: "notes/x.md", status: "modified", before: "x\n", after: "a\n" },
          { path: "notes/a.md", status: "deleted", before: "a\n", after: null },
        ]);
      });

      it(`treats a move into a hidden folder as a deletion and a move out of one as a creation (${ISSUE_763})`, async () => {
        const disk = makeDisk({ "notes/a.md": "a\n", ".stash/b.md": "b\n" });
        const captures = new FileCaptures();
        captures.observe("notes/a.md", disk.read);
        move(disk, "notes/a.md", ".stash/a.md");
        captures.vaultRenamed("notes/a.md", ".stash/a.md", true, disk.read);
        move(disk, ".stash/b.md", "notes/b.md");
        captures.vaultRenamed(".stash/b.md", "notes/b.md", true, disk.read);

        expect(await changesOf(captures, disk)).toEqual([
          { path: "notes/a.md", status: "deleted", before: "a\n", after: null },
          { path: "notes/b.md", status: "created", before: null, after: "b\n" },
        ]);
      });
    });

    describe("vaultDeleted()", () => {
      it(`reports an edited note moved by the shell as its old path's deletion plus the destination's creation (${ISSUE_763})`, async () => {
        const disk = makeDisk({ "notes/a.md": "original\n" });
        const captures = new FileCaptures();
        editThroughTool(captures, disk, "notes/a.md", "edited\n");
        move(disk, "notes/a.md", "notes/b.md");
        captures.vaultCreated("notes/b.md", true);
        captures.vaultDeleted("notes/a.md");

        expect(await changesOf(captures, disk)).toEqual([
          { path: "notes/a.md", status: "deleted", before: "original\n", after: null },
          { path: "notes/b.md", status: "created", before: null, after: "edited\n" },
        ]);
      });

      it(`reports every captured note under a deleted folder as deleted (${ISSUE_763})`, async () => {
        const disk = makeDisk({ "F/a.md": "a\n", "F/sub/b.md": "b\n", "Fx.md": "x\n" });
        const captures = new FileCaptures();
        for (const path of ["F/a.md", "F/sub/b.md", "Fx.md"]) captures.observe(path, disk.read);
        disk.files.delete("F/a.md");
        disk.files.delete("F/sub/b.md");
        captures.vaultDeleted("F");

        expect(await changesOf(captures, disk)).toEqual([
          { path: "F/a.md", status: "deleted", before: "a\n", after: null },
          { path: "F/sub/b.md", status: "deleted", before: "b\n", after: null },
        ]);
      });

      it(`reports a note deleted and recreated within the turn as one modification (${ISSUE_763})`, async () => {
        const disk = makeDisk({ "notes/a.md": "original\n" });
        const captures = new FileCaptures();
        captures.observe("notes/a.md", disk.read);
        disk.files.delete("notes/a.md");
        captures.vaultDeleted("notes/a.md");
        disk.files.set("notes/a.md", "replacement\n");
        captures.vaultCreated("notes/a.md", true);

        expect(await changesOf(captures, disk)).toEqual([
          { path: "notes/a.md", status: "modified", before: "original\n", after: "replacement\n" },
        ]);
      });
    });

    describe("changes()", () => {
      it("prefers a write-time original over the first-mention snapshot", async () => {
        const disk = makeDisk({ "notes/a.md": "overtaken\n" });
        const captures = new FileCaptures();
        const capture = captures.observe("notes/a.md", disk.read);
        capture.edited = true;
        capture.writeTimeBefore = "original\n";

        expect(await changesOf(captures, disk)).toEqual([
          { path: "notes/a.md", status: "modified", before: "original\n", after: "overtaken\n" },
        ]);
      });

      it(`ignores the backend's path diff for a note that moved, comparing it with its original text instead (${ISSUE_763})`, async () => {
        const disk = makeDisk({ "notes/a.md": "original\n" });
        const captures = new FileCaptures();
        editThroughTool(captures, disk, "notes/a.md", "edited\n");
        move(disk, "notes/a.md", "notes/b.md");
        captures.vaultRenamed("notes/a.md", "notes/b.md", true, disk.read);
        const patches = filePatchesByVaultPath(
          {
            root: "/vault",
            unifiedDiff: ["--- /dev/null", "+++ b/notes/b.md", "@@ -0,0 +1 @@", "+edited", ""].join(
              "\n"
            ),
          },
          "/vault"
        );

        expect(
          (await captures.changes(disk.read, patches)).map(({ path, before }) => ({ path, before }))
        ).toEqual([{ path: "notes/b.md", before: "original\n" }]);
      });
    });
  });
});
