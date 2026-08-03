import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const projectRoot = process.cwd();
const productionSourcePath = path.join(projectRoot, "src/styles/tailwind.css");
const galleryChromePath = path.join(projectRoot, "dev/gallery/gallery.css");
const outputPath = path.join(projectRoot, "dev/gallery/styles.source.css");

const [productionSource, galleryChrome] = await Promise.all([
  readFile(productionSourcePath, "utf8"),
  readFile(galleryChromePath, "utf8"),
]);

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${productionSource.trimEnd()}\n\n${galleryChrome.trim()}\n`);
