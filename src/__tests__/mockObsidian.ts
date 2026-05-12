import { TFile, TFolder } from "obsidian";

/**
 * Construct a TFile-typed mock from a partial spec. Uses the real TFile prototype
 * so `instanceof TFile` returns true. Test helper — keeps `as TFile` casts out of
 * test files so the `no-restricted-syntax` rule stays clean.
 */
export function mockTFile<T extends Partial<TFile>>(props: T): TFile {
  const file: TFile = Object.create(TFile.prototype);
  Object.assign(file, props);
  return file;
}

/** TFolder counterpart to mockTFile. */
export function mockTFolder<T extends Partial<TFolder>>(props: T): TFolder {
  const folder: TFolder = Object.create(TFolder.prototype);
  Object.assign(folder, props);
  return folder;
}
