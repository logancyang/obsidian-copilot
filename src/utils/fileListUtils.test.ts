import { appendUniqueFiles, getFileIdentityKey } from "@/utils/fileListUtils";

describe("fileListUtils", () => {
  it("deduplicates appended files by stable file identity", () => {
    const existingFile = new File(["image"], "image.png", {
      type: "image/png",
      lastModified: 123,
    });
    const duplicateFile = new File(["image"], "image.png", {
      type: "image/png",
      lastModified: 123,
    });
    const newFile = new File(["other"], "other.png", {
      type: "image/png",
      lastModified: 456,
    });

    const result = appendUniqueFiles([existingFile], [duplicateFile, newFile, duplicateFile]);

    expect(result).toEqual([existingFile, newFile]);
  });

  it("returns the original array when every incoming file is already present", () => {
    const existingFile = new File(["image"], "image.png", {
      type: "image/png",
      lastModified: 123,
    });
    const duplicateFile = new File(["image"], "image.png", {
      type: "image/png",
      lastModified: 123,
    });
    const existingFiles = [existingFile];

    const result = appendUniqueFiles(existingFiles, [duplicateFile]);

    expect(result).toBe(existingFiles);
  });

  it("includes the file type in the identity key", () => {
    const pngFile = new File(["image"], "image", {
      type: "image/png",
      lastModified: 123,
    });
    const jpegFile = new File(["image"], "image", {
      type: "image/jpeg",
      lastModified: 123,
    });

    expect(getFileIdentityKey(pngFile)).not.toBe(getFileIdentityKey(jpegFile));
  });
});
