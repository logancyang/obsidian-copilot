import { appendUniqueFiles, getFileIdentityKey } from "@/utils/fileListUtils";

const makePng = (name: string, lastModified: number, content = "image") =>
  new File([content], name, { type: "image/png", lastModified });

describe("fileListUtils", () => {
  describe("appendUniqueFiles()", () => {
    it("appends only incoming files whose identity is not already present, each once", () => {
      const existingFile = makePng("image.png", 123);
      const duplicateFile = makePng("image.png", 123);
      const newFile = makePng("other.png", 456, "other");

      const result = appendUniqueFiles([existingFile], [duplicateFile, newFile, duplicateFile]);

      expect(result).toEqual([existingFile, newFile]);
    });

    it("returns the original array when every incoming file is already present", () => {
      const existingFiles = [makePng("image.png", 123)];

      const result = appendUniqueFiles(existingFiles, [makePng("image.png", 123)]);

      expect(result).toBe(existingFiles);
    });
  });

  describe("getFileIdentityKey()", () => {
    it("differs for files that differ only in MIME type", () => {
      const pngFile = new File(["image"], "image", { type: "image/png", lastModified: 123 });
      const jpegFile = new File(["image"], "image", { type: "image/jpeg", lastModified: 123 });

      expect(getFileIdentityKey(pngFile)).not.toBe(getFileIdentityKey(jpegFile));
    });
  });
});
