import { TFile, TFolder } from "obsidian";

export function mockTFile<T extends Partial<TFile>>(props: T): TFile {
  const file: TFile = Object.create(TFile.prototype);
  Object.assign(file, props);
  return file;
}

export function mockTFolder<T extends Partial<TFolder>>(props: T): TFolder {
  const folder: TFolder = Object.create(TFolder.prototype);
  Object.assign(folder, props);
  return folder;
}
