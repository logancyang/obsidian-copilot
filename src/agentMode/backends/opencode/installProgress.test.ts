import { phaseLabel, phaseProgress } from "@/agentMode/backends/opencode/installProgress";

describe("installProgress", () => {
  describe("phaseLabel()", () => {
    it("says the install is starting before the first progress event arrives", () => {
      expect(phaseLabel(null)).toBe("Starting…");
    });

    it("caps the percentage it reports at 100, like the bar beside it", () => {
      // A server that under-reports `Content-Length` delivers more than it
      // promised. The bar clamps, so an uncapped label would read "300%" next to
      // a full bar and neither number could be trusted.
      expect(
        phaseLabel({ phase: "download", received: 300, total: 100, assetName: "opencode" })
      ).toContain("(100%)");
    });

    it("passes through the message carried by the resolve and extract phases", () => {
      expect(phaseLabel({ phase: "resolve", message: "Resolving platform asset…" })).toBe(
        "Resolving platform asset…"
      );
      expect(phaseLabel({ phase: "extract", message: "Extracting archive…" })).toBe(
        "Extracting archive…"
      );
    });

    it("shows received bytes, total bytes and a percentage for a sized download", () => {
      expect(
        phaseLabel({
          phase: "download",
          received: 1024 * 1024,
          total: 4 * 1024 * 1024,
          assetName: "opencode.zip",
        })
      ).toBe("Downloading opencode.zip — 1.0 MB / 4.0 MB (25%)");
    });

    it("omits the total and percentage when the server sent no content length", () => {
      expect(phaseLabel({ phase: "download", received: 2048, assetName: "opencode.zip" })).toBe(
        "Downloading opencode.zip — 2.0 KB"
      );
    });

    it("reports completion for the done phase", () => {
      expect(phaseLabel({ phase: "done", version: "1.2.3", path: "/bin/opencode" })).toBe("Done");
    });
  });

  describe("phaseProgress()", () => {
    it("has no percentage before the first event or during phases with no measurable fraction", () => {
      expect(phaseProgress(null)).toBeUndefined();
      expect(phaseProgress({ phase: "resolve", message: "…" })).toBeUndefined();
      expect(
        phaseProgress({ phase: "download", received: 500, assetName: "a.zip" })
      ).toBeUndefined();
    });

    it("derives the percentage from received over total while downloading", () => {
      expect(phaseProgress({ phase: "download", received: 25, total: 100, assetName: "a" })).toBe(
        25
      );
    });

    it("never exceeds 100 when a server over-reports received bytes", () => {
      expect(phaseProgress({ phase: "download", received: 300, total: 100, assetName: "a" })).toBe(
        100
      );
    });

    it("holds just short of complete while extracting and reaches 100 when done", () => {
      expect(phaseProgress({ phase: "extract", message: "…" })).toBe(98);
      expect(phaseProgress({ phase: "done", version: "1", path: "/p" })).toBe(100);
    });
  });
});
