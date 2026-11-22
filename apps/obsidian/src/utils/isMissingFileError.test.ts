import { isMissingFileError } from "@/utils/isMissingFileError";

describe("isMissingFileError", () => {
  it("matches a Node ENOENT error code", () => {
    const error = Object.assign(new Error("whatever"), { code: "ENOENT" });
    expect(isMissingFileError(error)).toBe(true);
  });

  it("matches an ENOENT message without a code", () => {
    expect(isMissingFileError(new Error("ENOENT: no such file or directory"))).toBe(true);
  });

  it("matches a NotFoundError name", () => {
    const error = new Error("missing");
    error.name = "NotFoundError";
    expect(isMissingFileError(error)).toBe(true);
  });

  it("matches 'not found' / 'does not exist' messages from other adapters", () => {
    expect(isMissingFileError(new Error("File not found"))).toBe(true);
    expect(isMissingFileError(new Error("The path does not exist"))).toBe(true);
  });

  it("matches a plain string error", () => {
    expect(isMissingFileError("ENOENT")).toBe(true);
  });

  it("does not match a generic read failure", () => {
    expect(isMissingFileError(new Error("permission denied"))).toBe(false);
    expect(isMissingFileError(new Error("EACCES"))).toBe(false);
  });
});
