// __mocks__/obsidian.js
module.exports = {
  Vault: jest.fn().mockImplementation(() => {
      return {
        getMarkdownFiles: jest.fn().mockImplementation(() => {
          // Return an array of mock markdown file objects
          return Promise.resolve([
            { path: 'test/test2/note1.md' },
            { path: 'test/note2.md' },
            { path: 'test2/note3.md' },
            { path: 'note4.md' },
          ]);
        }),
      };
    }),
};
