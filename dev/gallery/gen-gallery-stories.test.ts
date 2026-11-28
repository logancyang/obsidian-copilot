import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GENERATOR_PATH = path.resolve(process.cwd(), "scripts/gen-gallery-stories.mjs");

async function addFile(projectRoot: string, filePath: string): Promise<void> {
  const absolutePath = path.join(projectRoot, filePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, "export {};\n");
}

describe("gen-gallery-stories", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), "gallery generator "));
  });

  afterEach(async () => {
    await rm(projectRoot, { force: true, recursive: true });
  });

  describe("generator CLI", () => {
    it("writes a deterministic sorted import for every story across src", async () => {
      await Promise.all([
        addFile(projectRoot, "apps/obsidian/src/wired/Zeta.stories.tsx"),
        addFile(projectRoot, "apps/obsidian/src/components/ui/alpha.stories.tsx"),
        addFile(projectRoot, "apps/obsidian/src/agentMode/ui/nested/Agent Card.stories.tsx"),
        addFile(projectRoot, "apps/obsidian/src/components/ui/alpha.tsx"),
        addFile(projectRoot, "apps/obsidian/src/agentMode/ui/nested/Agent Card.tsx"),
      ]);

      await execFileAsync(process.execPath, [GENERATOR_PATH], { cwd: projectRoot });
      const firstOutput = await readFile(
        path.join(projectRoot, "dev/gallery/stories.generated.ts"),
        "utf8"
      );
      await execFileAsync(process.execPath, [GENERATOR_PATH], { cwd: projectRoot });
      const secondOutput = await readFile(
        path.join(projectRoot, "dev/gallery/stories.generated.ts"),
        "utf8"
      );

      expect(secondOutput).toBe(firstOutput);
      expect(firstOutput.match(/load: \(\): Promise<unknown> => import\(/g)).toHaveLength(3);
      expect(firstOutput).toContain(
        'componentId: "@/agentMode/ui/nested/Agent Card",\n    load: (): Promise<unknown> => import("@/agentMode/ui/nested/Agent Card.stories")'
      );
      expect(firstOutput).toContain(
        'componentId: null,\n    load: (): Promise<unknown> => import("@/wired/Zeta.stories")'
      );
      expect(firstOutput.indexOf("Agent Card.stories")).toBeLessThan(
        firstOutput.indexOf("alpha.stories")
      );
      expect(firstOutput.indexOf("alpha.stories")).toBeLessThan(
        firstOutput.indexOf("Zeta.stories")
      );
      expect(firstOutput).not.toContain(projectRoot);
      expect(firstOutput).not.toContain("\\");
    });

    it("counts only non-test component files recursively under ui directories", async () => {
      await Promise.all([
        addFile(projectRoot, "apps/obsidian/src/components/ui/button.tsx"),
        addFile(projectRoot, "apps/obsidian/src/components/ui/button.test.tsx"),
        addFile(projectRoot, "apps/obsidian/src/components/ui/button.stories.tsx"),
        addFile(projectRoot, "apps/obsidian/src/agentMode/ui/AgentWelcomeCard.tsx"),
        addFile(projectRoot, "apps/obsidian/src/agentMode/skills/ui/nested/SkillCard.tsx"),
        addFile(projectRoot, "apps/obsidian/src/modelManagement/ui/dialogs/ModelDialog.tsx"),
        addFile(projectRoot, "apps/obsidian/src/future/ui/FutureCard.tsx"),
        addFile(projectRoot, "apps/obsidian/src/future/ui/FutureCard.stories.tsx"),
        addFile(projectRoot, "apps/obsidian/src/wired/WiredComponent.tsx"),
        addFile(projectRoot, "apps/obsidian/src/components/ui/helper.ts"),
      ]);

      await execFileAsync(process.execPath, [GENERATOR_PATH], { cwd: projectRoot });
      const output = await readFile(
        path.join(projectRoot, "dev/gallery/stories.generated.ts"),
        "utf8"
      );

      expect(output).toContain("export const presentationalComponentCount = 5;");
      expect(output).toContain('componentId: "@/components/ui/button"');
      expect(output).toContain(
        'componentId: "@/future/ui/FutureCard",\n    load: (): Promise<unknown> => import("@/future/ui/FutureCard.stories")'
      );
    });

    it("imports a workspace package's stories and components by package name for https://github.com/Brevilabs/obsidian-copilot-private/issues/1010", async () => {
      await Promise.all([
        addFile(projectRoot, "packages/client/src/chat/ui/MessageCard.tsx"),
        addFile(projectRoot, "packages/client/src/chat/ui/MessageCard.stories.tsx"),
        addFile(projectRoot, "packages/core/src/ui/Badge.tsx"),
      ]);

      await execFileAsync(process.execPath, [GENERATOR_PATH], { cwd: projectRoot });
      const output = await readFile(
        path.join(projectRoot, "dev/gallery/stories.generated.ts"),
        "utf8"
      );

      expect(output).toContain("export const presentationalComponentCount = 2;");
      expect(output).toContain(
        'componentId: "@copilot/client/chat/ui/MessageCard",\n    load: (): Promise<unknown> => import("@copilot/client/chat/ui/MessageCard.stories")'
      );
    });
  });
});
