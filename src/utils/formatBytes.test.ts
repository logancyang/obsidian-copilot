import { formatBytes } from "@/utils/formatBytes";

describe("formatBytes", () => {
  describe("formatBytes()", () => {
    it("reports sub-kilobyte counts in whole bytes", () => {
      expect(formatBytes(0)).toBe("0 B");
      expect(formatBytes(512)).toBe("512 B");
      expect(formatBytes(1023)).toBe("1023 B");
    });

    it("switches to kilobytes at 1 KiB and to megabytes at 1 MiB", () => {
      expect(formatBytes(1024)).toBe("1.0 KB");
      expect(formatBytes(2048)).toBe("2.0 KB");
      expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
      expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
      expect(formatBytes(26_214_400)).toBe("25.0 MB");
    });
  });
});
