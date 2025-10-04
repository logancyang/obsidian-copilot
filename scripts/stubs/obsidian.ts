export class App {}

export class Notice {
  constructor(public message?: string) {
    if (message) {
      console.warn(`[Notice] ${message}`);
    }
  }
}

export class TFile {
  path: string;
  basename: string;
  extension: string;

  constructor(path: string) {
    this.path = path;
    this.basename = path.split("/").pop() || path;
    const parts = this.basename.split(".");
    this.extension = parts.length > 1 ? parts.pop() || "" : "";
  }
}

export class Vault {
  getRoot() {
    return { name: "root" };
  }

  getAbstractFileByPath() {
    return null;
  }

  async read() {
    return "";
  }

  getMarkdownFiles() {
    return [];
  }

  getAllLoadedFiles() {
    return [];
  }

  adapter = {
    mkdir: async () => {
      /* no-op */
    },
  };
}

export const Platform = {
  isDesktop: true,
  isMobile: false,
};

export function normalizePath(path: string): string {
  return path;
}

export async function requestUrl(): Promise<never> {
  throw new Error("requestUrl is not available in the CLI environment.");
}

export function getAllTags(): string[] {
  return [];
}

export class MarkdownView {}

export class TAbstractFile {}

export class WorkspaceLeaf {
  async openFile(): Promise<void> {
    /* no-op */
  }
}

export class ItemView {}

export class Modal {
  open(): void {
    /* no-op */
  }

  close(): void {
    /* no-op */
  }
}

export function parseYaml(_: string): any {
  return {};
}
