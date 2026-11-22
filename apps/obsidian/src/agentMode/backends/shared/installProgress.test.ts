import {
  InstallProgressReporter,
  type ManagedInstallProgress,
} from "@/agentMode/backends/shared/installProgress";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/578";

describe("installProgress", () => {
  describe("InstallProgressReporter", () => {
    let published: ManagedInstallProgress[];
    let reporter: InstallProgressReporter;
    beforeEach(() => {
      jest.useFakeTimers();
      published = [];
      reporter = new InstallProgressReporter("Agent", (progress) => published.push(progress));
    });
    afterEach(() => {
      reporter.dispose();
      jest.useRealTimers();
    });

    describe("connecting()", () => {
      it(`names the download and appends elapsed seconds while no bytes arrive: ${ISSUE}`, () => {
        reporter.connecting();
        jest.advanceTimersByTime(10_000);

        expect(published).toEqual([
          { label: "Connecting to Agent download…", percent: 5 },
          { label: "Connecting to Agent download… 5s elapsed", percent: 5 },
          { label: "Connecting to Agent download… 10s elapsed", percent: 5 },
        ]);
      });
    });

    describe("download()", () => {
      it(`shows transferred bytes within the download band and ends the elapsed wait: ${ISSUE}`, () => {
        reporter.connecting();
        reporter.download(0, 2048);
        reporter.download(1024, 2048);
        reporter.download(2048, 2048);
        jest.advanceTimersByTime(30_000);

        expect(published.slice(1)).toEqual([
          { label: "Downloading Agent — 0 B / 2.0 KB", percent: 10 },
          { label: "Downloading Agent — 1.0 KB / 2.0 KB", percent: 42 },
          { label: "Downloading Agent — 2.0 KB / 2.0 KB", percent: 75 },
        ]);
      });
      it("caps the bar at the end of the download band when a server overshoots its size", () => {
        reporter.download(4096, 2048);

        expect(published).toEqual([{ label: "Downloading Agent — 4.0 KB / 2.0 KB", percent: 75 }]);
      });
    });

    describe("extracting()", () => {
      it(`names extraction and keeps its elapsed time moving: ${ISSUE}`, () => {
        reporter.extracting();
        jest.advanceTimersByTime(5_000);

        expect(published).toEqual([
          { label: "Extracting Agent…", percent: 80 },
          { label: "Extracting Agent… 5s elapsed", percent: 80 },
        ]);
      });
    });

    describe("verifying()", () => {
      it("names the binary by default or the bundled part being checked", () => {
        reporter.verifying();
        reporter.verifying("bundled runtime");

        expect(published).toEqual([
          { label: "Verifying Agent…", percent: 90 },
          { label: "Verifying bundled runtime…", percent: 90 },
        ]);
      });
    });

    describe("activating()", () => {
      it("names activation just before completion", () => {
        reporter.activating();

        expect(published).toEqual([{ label: "Activating Agent…", percent: 98 }]);
      });
    });

    describe("done()", () => {
      it("reports completion and stops elapsed-time updates from the previous phase", () => {
        reporter.activating();
        reporter.done();
        jest.advanceTimersByTime(30_000);

        expect(published).toEqual([
          { label: "Activating Agent…", percent: 98 },
          { label: "Agent ready.", percent: 100 },
        ]);
      });
    });

    describe("dispose()", () => {
      it(`stops elapsed-time updates after a failed or cancelled install: ${ISSUE}`, () => {
        reporter.connecting();
        reporter.dispose();
        jest.advanceTimersByTime(30_000);

        expect(published).toEqual([{ label: "Connecting to Agent download…", percent: 5 }]);
      });
    });
  });
});
