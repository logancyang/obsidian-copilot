import {
  isCustomConnectorConfig,
  parseCustomConnectors,
} from "@/connectors/custom/customConnectorConfig";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/862";

describe("customConnectorConfig", () => {
  describe("parseCustomConnectors()", () => {
    it("reads every server of an mcpServers block, keeping env and header names apart from their values", () => {
      const text = JSON.stringify({
        mcpServers: {
          GitHub: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-github"],
            env: { GITHUB_TOKEN: "ghp_secret" },
          },
          "Acme Docs": {
            type: "http",
            url: "https://mcp.acme.test/mcp",
            headers: { Authorization: "Bearer acme-key" },
          },
        },
      });

      expect(parseCustomConnectors(text, new Set())).toEqual({
        ok: true,
        connectors: [
          {
            config: {
              id: "github",
              name: "GitHub",
              command: "npx",
              args: ["-y", "@modelcontextprotocol/server-github"],
              envNames: ["GITHUB_TOKEN"],
            },
            secrets: { GITHUB_TOKEN: "ghp_secret" },
          },
          {
            config: {
              id: "acmedocs",
              name: "Acme Docs",
              url: "https://mcp.acme.test/mcp",
              headerNames: ["Authorization"],
            },
            secrets: { Authorization: "Bearer acme-key" },
          },
        ],
      });
    });

    it("reads a single pasted server object named by its name field, with no args, env or headers", () => {
      const result = parseCustomConnectors(
        JSON.stringify({ name: "Echo", command: "/usr/local/bin/echo-server" }),
        new Set()
      );

      expect(result).toEqual({
        ok: true,
        connectors: [
          {
            config: {
              id: "echo",
              name: "Echo",
              command: "/usr/local/bin/echo-server",
              args: [],
              envNames: [],
            },
            secrets: {},
          },
        ],
      });
    });

    it(`gives a name that clashes with a catalog service or another connector the next free digit, and caps ids at 16 characters: ${ISSUE}`, () => {
      const text = JSON.stringify({
        mcpServers: {
          Notion: { url: "https://a.test/mcp" },
          notion: { url: "https://b.test/mcp" },
          "A very long server name indeed": { command: "x" },
          "!!!": { command: "y" },
        },
      });

      const result = parseCustomConnectors(text, new Set(["notion", "notion2"]));

      expect(result.ok && result.connectors.map(({ config }) => config.id)).toEqual([
        "notion3",
        "notion4",
        "averylongservern",
        "custom",
      ]);
    });

    it.each([
      ["text that isn't JSON", "{mcpServers:", "This isn't valid JSON."],
      [
        "an object that is neither a block nor a server",
        JSON.stringify({ foo: 1 }),
        'Paste an "mcpServers" block, or one server with "command" or "url".',
      ],
      ["a list", "[]", 'Paste an "mcpServers" block, or one server with "command" or "url".'],
      [
        "an empty mcpServers block",
        JSON.stringify({ mcpServers: {} }),
        'The "mcpServers" block has no servers.',
      ],
      [
        "a single server without a name",
        JSON.stringify({ command: "npx" }),
        'Add a "name" to the server, or paste it inside an "mcpServers" block.',
      ],
      [
        "a server with neither command nor url",
        JSON.stringify({ mcpServers: { Echo: { args: [] } } }),
        '"Echo" needs a "command" or a "url".',
      ],
      [
        "a server with both command and url",
        JSON.stringify({ mcpServers: { Echo: { command: "x", url: "https://a.test" } } }),
        '"Echo" has both a "command" and a "url". Keep one.',
      ],
      [
        "args that aren't strings",
        JSON.stringify({ mcpServers: { Echo: { command: "x", args: [1] } } }),
        '"Echo": "args" must be a list of text values.',
      ],
      [
        "an env value that isn't a string",
        JSON.stringify({ mcpServers: { Echo: { command: "x", env: { KEY: 1 } } } }),
        '"Echo": "env" values must be text.',
      ],
      [
        "a header value that isn't a string",
        JSON.stringify({ mcpServers: { Echo: { url: "https://a.test", headers: [] } } }),
        '"Echo": "headers" values must be text.',
      ],
      [
        "a url that isn't http or https",
        JSON.stringify({ mcpServers: { Echo: { url: "ftp://a.test" } } }),
        '"Echo": "url" must start with http:// or https://.',
      ],
    ])("rejects %s with an inline error and adds nothing", (_case, text, error) => {
      expect(parseCustomConnectors(text, new Set())).toEqual({ ok: false, error });
    });
  });

  describe("isCustomConnectorConfig()", () => {
    it("accepts stored local and remote configs", () => {
      expect(
        isCustomConnectorConfig({ id: "echo", name: "Echo", command: "x", args: [], envNames: [] })
      ).toBe(true);
      expect(
        isCustomConnectorConfig({ id: "acme", name: "Acme", url: "https://a", headerNames: ["A"] })
      ).toBe(true);
    });

    it.each([
      ["null", null],
      [
        "an id outside [a-z0-9]{1,16}",
        { id: "Echo-1", name: "E", command: "x", args: [], envNames: [] },
      ],
      ["a missing name", { id: "echo", command: "x", args: [], envNames: [] }],
      ["no command or url", { id: "echo", name: "E" }],
      ["non-string args", { id: "echo", name: "E", command: "x", args: [1], envNames: [] }],
      ["missing header names", { id: "echo", name: "E", url: "https://a" }],
      [
        "a url beside a non-text command",
        { id: "acme", name: "A", command: null, url: "https://a", headerNames: [] },
      ],
    ])(`rejects %s from a synced or hand-edited data.json: ${ISSUE}`, (_case, value) => {
      expect(isCustomConnectorConfig(value)).toBe(false);
    });
  });
});
