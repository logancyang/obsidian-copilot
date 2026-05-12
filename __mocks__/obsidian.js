// __mocks__/obsidian.js
import { parse as parseYamlString } from "yaml";

// Per-test overrides set via the exported `__setRequestUrlImpl` helper.
// Default: empty success response. Tests that exercise network paths should
// install their own implementation.
let requestUrlImpl = jest.fn().mockResolvedValue({
  status: 200,
  text: "",
  json: undefined,
  arrayBuffer: new ArrayBuffer(0),
  headers: {},
});

module.exports = {
  // Reason: normalizePath is used by projectPaths.ts; identity function is sufficient for tests
  normalizePath: jest.fn().mockImplementation((p) => p),
  moment: jest.requireActual("moment"),
  requestUrl: (...args) => requestUrlImpl(...args),
  __setRequestUrlImpl: (impl) => {
    requestUrlImpl = impl;
  },
  Vault: jest.fn().mockImplementation(() => {
    return {
      getMarkdownFiles: jest.fn().mockImplementation(() => {
        // Return an array of mock markdown file objects
        return [
          { path: "test/test2/note1.md" },
          { path: "test/note2.md" },
          { path: "test2/note3.md" },
          { path: "note4.md" },
        ];
      }),
      cachedRead: jest.fn().mockImplementation((file) => {
        // Simulate reading file contents. You can adjust the content as needed for your tests.
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
  },
  parseYaml: jest.fn().mockImplementation((content) => {
    return parseYamlString(content);
  }),
  Modal: class Modal {
    constructor() {
      this.open = jest.fn();
      this.close = jest.fn();
      this.onOpen = jest.fn();
      this.onClose = jest.fn();
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
  ItemView: jest.fn().mockImplementation(function () {
    this.containerEl = window.document.createElement("div");
    this.onOpen = jest.fn();
    this.onClose = jest.fn();
    this.getDisplayText = jest.fn().mockReturnValue("Mock View");
    this.getViewType = jest.fn().mockReturnValue("mock-view");
    this.getIcon = jest.fn().mockReturnValue("document");
  }),
  Notice: jest.fn().mockImplementation(function (message) {
    this.message = message;
    this.noticeEl = window.document.createElement("div");
    this.hide = jest.fn();
  }),
  TFile: jest.fn().mockImplementation(function (path) {
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

// Mock the global app object
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
