import { watch } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const projectRoot = process.cwd();
const productionSourcePath = path.join(projectRoot, "src/styles/tailwind.css");
const galleryChromePath = path.join(projectRoot, "dev/gallery/gallery.css");
const outputPath = path.join(projectRoot, "dev/gallery/styles.source.css");

async function composeGalleryCss() {
  const [productionSource, galleryChrome] = await Promise.all([
    readFile(productionSourcePath, "utf8"),
    readFile(galleryChromePath, "utf8"),
  ]);

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${productionSource.trimEnd()}\n\n${galleryChrome.trim()}\n`);
}

await composeGalleryCss();

if (process.argv.includes("--watch")) {
  let pendingWrite = Promise.resolve();
  const watchers = [productionSourcePath, galleryChromePath].map((sourcePath) =>
    watch(sourcePath, () => {
      pendingWrite = pendingWrite.then(composeGalleryCss);
    })
  );

  await new Promise((resolve) => {
    const closeWatchers = () => {
      for (const watcher of watchers) {
        watcher.close();
      }
      resolve();
    };
    process.once("SIGINT", closeWatchers);
    process.once("SIGTERM", closeWatchers);
  });
}
