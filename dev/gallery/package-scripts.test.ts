import { readFileSync } from "node:fs";
import path from "node:path";

interface PackageJson {
  scripts: Record<string, string>;
}

describe("package.json", () => {
  const packageJson = JSON.parse(
    readFileSync(path.resolve(process.cwd(), "package.json"), "utf8")
  ) as PackageJson;

  describe("gallery:css", () => {
    it("prepares a gallery-only source before Tailwind watches or builds it", () => {
      expect(packageJson.scripts["gallery:css"]).toBe(
        "node scripts/prepare-gallery-css.mjs && npx tailwindcss -i dev/gallery/styles.source.css -o dev/gallery/styles.css --content './src/**/*.{js,ts,jsx,tsx},./dev/gallery/**/*.{js,ts,jsx,tsx}'"
      );
    });
  });

  describe("gallery:dev", () => {
    it("generates the current story index before starting both artifact watchers", () => {
      expect(packageJson.scripts["gallery:stories"]).toBe("node scripts/gen-gallery-stories.mjs");
      expect(packageJson.scripts["gallery:esbuild"]).toBe("node dev/gallery/esbuild.config.mjs");
      expect(packageJson.scripts["gallery:dev"]).toBe(
        'npm run gallery:stories && run-p "gallery:css -- --watch --poll" "gallery:esbuild -- --watch"'
      );
    });
  });
});
