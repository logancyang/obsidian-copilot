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
    it("prepares a gallery-only source before Tailwind builds it", () => {
      expect(packageJson.scripts["gallery:css:source"]).toBe(
        "node scripts/prepare-gallery-css.mjs"
      );
      expect(packageJson.scripts["gallery:css:tailwind"]).toBe(
        "npx tailwindcss -i dev/gallery/styles.source.css -o dev/gallery/styles.css --content './src/**/*.{js,ts,jsx,tsx},./dev/gallery/**/*.{js,ts,jsx,tsx}'"
      );
      expect(packageJson.scripts["gallery:css"]).toBe(
        "npm run gallery:css:source && npm run gallery:css:tailwind"
      );
    });
  });

  describe("gallery:dev", () => {
    it("generates sources before watching both CSS inputs and gallery artifacts", () => {
      expect(packageJson.scripts["gallery:stories"]).toBe("node scripts/gen-gallery-stories.mjs");
      expect(packageJson.scripts["gallery:esbuild"]).toBe("node dev/gallery/esbuild.config.mjs");
      expect(packageJson.scripts["gallery:dev"]).toBe(
        'npm run gallery:stories && npm run gallery:css:source && run-p "gallery:css:source -- --watch" "gallery:css:tailwind -- --watch --poll" "gallery:esbuild -- --watch"'
      );
    });
  });
});
