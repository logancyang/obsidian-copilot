import { oneAtATime } from "./oneAtATime";

describe("oneAtATime", () => {
  describe("oneAtATime()", () => {
    it("starts each call only after the previous one settles, even when that one failed", async () => {
      let releaseFirst!: () => void;
      const firstGate = new Promise<void>((resolve) => (releaseFirst = resolve));
      let firstFinished = false;

      const first = oneAtATime(async () => {
        await firstGate;
        firstFinished = true;
        throw new Error("first failed");
      });
      const second = oneAtATime(async () => firstFinished);
      releaseFirst();

      await expect(first).rejects.toThrow("first failed");
      await expect(second).resolves.toBe(true);
    });
  });
});
