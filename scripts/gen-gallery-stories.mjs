import { glob, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const GENERATED_FILE = "dev/gallery/stories.generated.ts";
const SOURCE_ROOTS = ["apps/obsidian/src", "packages/*/src"];
const PRESENTATIONAL_COMPONENT_PATTERNS = SOURCE_ROOTS.map((root) => `${root}/**/ui/**/*.tsx`);
const STORY_PATTERNS = SOURCE_ROOTS.map((root) => `${root}/**/*.stories.tsx`);
const SOURCE_PATH = /^(?:apps\/obsidian|packages\/([^/]+))\/src\/(.*)$/;

function isPresentationalComponent(filePath) {
  return !filePath.endsWith(".test.tsx") && !filePath.endsWith(".stories.tsx");
}

function toModuleId(filePath, suffix) {
  const [, packageName, sourcePath] = SOURCE_PATH.exec(filePath.split(path.sep).join("/"));
  // Package code is imported by package name, never through the plugin's `@/` alias: https://github.com/Brevilabs/obsidian-copilot-private/issues/1010
  const moduleRoot = packageName ? `@copilot/${packageName}` : "@";
  return `${moduleRoot}/${sourcePath.slice(0, -suffix.length)}`;
}

async function findFiles(projectRoot, patterns) {
  const files = new Set();

  for (const pattern of patterns) {
    for await (const filePath of glob(pattern, { cwd: projectRoot })) {
      files.add(filePath);
    }
  }

  return [...files].sort((left, right) => left.localeCompare(right));
}

function renderGeneratedSource(storyFiles, presentationalComponentIds) {
  const moduleEntries = storyFiles.map((storyFile) => {
    const storyId = toModuleId(storyFile, ".stories.tsx");
    const componentId = presentationalComponentIds.has(storyId) ? storyId : null;

    return [
      "  {",
      `    componentId: ${JSON.stringify(componentId)},`,
      `    load: (): Promise<unknown> => import(${JSON.stringify(`${storyId}.stories`)}),`,
      "  },",
    ].join("\n");
  });

  return [
    `export const presentationalComponentCount = ${presentationalComponentIds.size};`,
    "",
    "export const modules = [",
    ...moduleEntries,
    "] as const;",
    "",
  ].join("\n");
}

async function generateGalleryStories(projectRoot) {
  const [storyFiles, componentFiles] = await Promise.all([
    findFiles(projectRoot, STORY_PATTERNS),
    findFiles(projectRoot, PRESENTATIONAL_COMPONENT_PATTERNS),
  ]);
  const presentationalComponentIds = new Set(
    componentFiles.filter(isPresentationalComponent).map((filePath) => toModuleId(filePath, ".tsx"))
  );
  const outputPath = path.join(projectRoot, GENERATED_FILE);

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, renderGeneratedSource(storyFiles, presentationalComponentIds));
}

await generateGalleryStories(process.cwd());
