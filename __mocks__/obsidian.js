import { parse as parseYamlString } from "yaml";

let requestUrlImpl = jest.fn().mockResolvedValue({
  status: 200,
  text: "",
  json: undefined,
  arrayBuffer: new ArrayBuffer(0),
  headers: {},
});

module.exports = {
  moment: jest.requireActual("moment"),
  requestUrl: (...args) => requestUrlImpl(...args),
  __setRequestUrlImpl: (impl) => {
    requestUrlImpl = impl;
  },
  Vault: jest.fn().mockImplementation(() => {
    return {
      getMarkdownFiles: jest.fn().mockImplementation(() => {
        return [
          { path: "test/test2/note1.md" },
          { path: "test/note2.md" },
          { path: "test2/note3.md" },
          { path: "note4.md" },
        ];
      }),
      cachedRead: jest.fn().mockImplementation((file) => {
        const fileContents = {
          "test/test2/note1.md": "---\ntags: [Tag1, tag2]\n---\nContent of note1",
          "test/note2.md": "---\ntags: [tag2, tag3]\n---\nContent of note2",
          "test2/note3.md": "something else ---\ntags: [false_tag]\n---\nContent of note3",
          "note4.md": "---\ntags: [tag1, Tag4]\n---\nContent of note4",
        };
        return Promise.resolve(fileContents[file.path]);
      }),
    };
  }),
  Platform: {
    isDesktop: true,
    isDesktopApp: true,
    isMobile: false,
    isWin: false,
    isMacOS: false,
    isIosApp: false,
  },
  FileSystemAdapter: class FileSystemAdapter {
    constructor(basePath = "/vault") {
      this._basePath = basePath;
      this.read = jest.fn();
      this.write = jest.fn();
      this.exists = jest.fn().mockResolvedValue(true);
      this.mkdir = jest.fn().mockResolvedValue(undefined);
      this.list = jest.fn().mockResolvedValue({ files: [], folders: [] });
      this.remove = jest.fn().mockResolvedValue(undefined);
    }
    getBasePath() {
      return this._basePath;
    }
    getFullPath(p) {
      const rel = String(p).replace(/\\/g, "/").replace(/^\/+/, "");
      return rel ? `${this._basePath}/${rel}` : this._basePath;
    }
  },
  normalizePath: (p) => String(p).replace(/\\\\/g, "/").replace(/\/+/g, "/"),
  parseYaml: jest.fn().mockImplementation((content) => {
    return parseYamlString(content);
  }),
  Modal: class Modal {
    constructor(app) {
      this.app = app;
      const doc = window.document;
      this.containerEl = doc.createElement("div");
      this.containerEl.className = "modal-container";
      this.modalEl = this.containerEl.appendChild(doc.createElement("div"));
      this.modalEl.className = "modal";
      this.headerEl = this.modalEl.appendChild(doc.createElement("div"));
      this.headerEl.className = "modal-header";
      this.titleEl = this.headerEl.appendChild(doc.createElement("div"));
      this.titleEl.className = "modal-title";
      this.contentEl = this.modalEl.appendChild(doc.createElement("div"));
      this.contentEl.className = "modal-content";
      this.open = jest.fn();
      this.close = jest.fn();
      this.onOpen = jest.fn();
      this.onClose = jest.fn();
    }
  },
  Component: class Component {
    load() {}
    unload() {}
    register() {}
  },
  FuzzySuggestModal: class FuzzySuggestModal {
    constructor(app) {
      this.app = app;
      this.open = jest.fn();
      this.close = jest.fn();
      this.setPlaceholder = jest.fn();
    }
  },
  App: jest.fn().mockImplementation(() => ({
    workspace: {
      getActiveFile: jest.fn(),
    },
    vault: {
      read: jest.fn(),
    },
  })),
  ItemView: class ItemView {
    constructor(leaf) {
      this.leaf = leaf;
      this.app = leaf?.app;
      this.containerEl = window.document.createElement("div");
      this.containerEl.createDiv({ cls: "view-header" });
      this.containerEl.createDiv({ cls: "view-content" });
      this.registered = [];
    }
    register(cb) {
      this.registered.push(cb);
    }
  },
  Notice: jest.fn().mockImplementation(function (message) {
    this.message = message;
    this.noticeEl = window.document.createElement("div");
    this.hide = jest.fn();
  }),
  TFile: jest.fn().mockImplementation(function (path = "") {
    this.path = path;
    this.name = path.split("/").pop();
    this.basename = this.name.replace(/\.[^/.]+$/, "");
    this.extension = path.split(".").pop();
  }),
  TFolder: jest.fn().mockImplementation(function (path) {
    this.path = path || "";
    this.name = this.path.split("/").pop() || "";
  }),
  WorkspaceLeaf: jest.fn().mockImplementation(function () {
    this.view = null;
    this.setViewState = jest.fn();
    this.detach = jest.fn();
    this.getViewState = jest.fn().mockReturnValue({});
  }),
};

window.app = {
  vault: {
    getAbstractFileByPath: jest.fn().mockReturnValue({
      name: "test-file.md",
      path: "test-file.md",
    }),
    read: jest.fn().mockResolvedValue("test content"),
    modify: jest.fn().mockResolvedValue(undefined),
    getMarkdownFiles: jest.fn().mockReturnValue([]),
    getAllLoadedFiles: jest.fn().mockReturnValue([]),
  },
  workspace: {
    getActiveFile: jest.fn().mockReturnValue(null),
    getLeaf: jest.fn().mockReturnValue({
      openFile: jest.fn().mockResolvedValue(undefined),
    }),
  },
  metadataCache: {
    getFirstLinkpathDest: jest.fn().mockReturnValue(null),
    getFileCache: jest.fn().mockReturnValue(null),
  },
  fileManager: {
    trashFile: jest.fn().mockResolvedValue(undefined),
  },
};
