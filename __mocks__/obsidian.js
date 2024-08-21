// __mocks__/obsidian.js
/* eslint-disable no-undef */
import yaml from "js-yaml";

module.exports = {
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
    return yaml.load(content);
  }),
};
