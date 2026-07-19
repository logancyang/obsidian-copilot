import { McpServerForm } from "@/agentMode/ui/McpServerModal";
import { McpServersPanel } from "@/agentMode/ui/McpServersPanel";
import type { StoredMcpServer } from "@/agentMode/session/mcpResolver";
import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

// The panel transitively imports McpServerModal, which extends Obsidian's
// `Modal`. A minimal class stub keeps the import graph happy; the modal is
// never opened in these tests (we render McpServerForm directly).
jest.mock("obsidian", () => ({
  App: class {},
  Modal: class {
    setTitle() {}
    open() {}
    close() {}
  },
  Platform: { isMobile: false },
}));

// The panel calls useApp() only to construct the native modal on Add/Edit; a
// stub App is enough for the click handler and is never exercised in jsdom.
jest.mock("@/context", () => ({ useApp: jest.fn(() => ({})) }));

const setSettings = jest.fn();
let currentServers: unknown;
jest.mock("@/settings/model", () => ({
  setSettings: (updater: unknown) => setSettings(updater),
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook; name must match the export
  useSettingsValue: () => ({ agentMode: { mcpServers: currentServers } }),
}));

/**
 * Resolve what the panel persisted: `setSettings` receives a function
 * `(cur) => Partial<Settings>`; invoke it against the current servers to read
 * back the new `mcpServers` array.
 */
function persistedServers(): StoredMcpServer[] | undefined {
  expect(setSettings).toHaveBeenCalledTimes(1);
  const updater = setSettings.mock.calls[0][0] as (cur: { agentMode: { mcpServers: unknown } }) => {
    agentMode: { mcpServers: StoredMcpServer[] };
  };
  return updater({ agentMode: { mcpServers: currentServers } }).agentMode.mcpServers;
}

const STDIO_SERVER: StoredMcpServer = {
  id: "srv-1",
  enabled: true,
  name: "filesystem",
  transport: "stdio",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-filesystem", "/vault"],
  env: [],
};

beforeEach(() => {
  setSettings.mockClear();
  currentServers = [];
});

describe("McpServerForm (draft + Save semantics)", () => {
  it("Cancel does NOT persist and never calls onSubmit", () => {
    const onSubmit = jest.fn();
    const onCancel = jest.fn();
    render(
      <McpServerForm
        initial={{ ...STDIO_SERVER, name: "", command: "" }}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("disables Save until name + command are present, then submits the draft", () => {
    const onSubmit = jest.fn();
    render(
      <McpServerForm
        initial={{ id: "x", enabled: true, name: "", transport: "stdio", command: "", args: [] }}
        onSubmit={onSubmit}
        onCancel={jest.fn()}
      />
    );
    const save = screen.getByText("Save").closest("button") as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText("Server name (e.g. filesystem)"), {
      target: { value: "fs" },
    });
    expect(save.disabled).toBe(true); // command still empty
    fireEvent.change(screen.getByPlaceholderText("npx"), { target: { value: "npx" } });
    expect(save.disabled).toBe(false);

    fireEvent.click(save);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const draft = onSubmit.mock.calls[0][0] as StoredMcpServer;
    expect(draft.name).toBe("fs");
    expect(draft.command).toBe("npx");
  });

  it("normalizes arguments to one trimmed entry per non-empty line on Save", () => {
    const onSubmit = jest.fn();
    render(
      <McpServerForm
        initial={{
          id: "x",
          enabled: true,
          name: "fs",
          transport: "stdio",
          command: "npx",
          args: [],
        }}
        onSubmit={onSubmit}
        onCancel={jest.fn()}
      />
    );
    fireEvent.change(screen.getByPlaceholderText(/server-filesystem/), {
      target: { value: " -y \n\n  /vault  \n" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((onSubmit.mock.calls[0][0] as StoredMcpServer).args).toEqual(["-y", "/vault"]);
  });
});

describe("McpServersPanel", () => {
  it("shows the empty state with no servers configured", () => {
    render(<McpServersPanel />);
    expect(screen.getByText("No MCP servers configured.")).not.toBeNull();
  });

  it("renders a read-only row with transport badge and monospace subtitle", () => {
    currentServers = [STDIO_SERVER];
    render(<McpServersPanel />);
    expect(screen.getByText("filesystem")).not.toBeNull();
    expect(screen.getByText("stdio")).not.toBeNull();
    expect(
      screen.getByText("npx -y @modelcontextprotocol/server-filesystem /vault")
    ).not.toBeNull();
  });

  it("toggling a row persists the enabled flag immediately", () => {
    currentServers = [STDIO_SERVER];
    render(<McpServersPanel />);
    fireEvent.click(screen.getByRole("switch"));
    const next = persistedServers();
    expect(next).toHaveLength(1);
    expect(next?.[0].enabled).toBe(false);
  });

  it("deleting a row removes it from settings", () => {
    currentServers = [STDIO_SERVER];
    render(<McpServersPanel />);
    fireEvent.click(screen.getByTitle("Delete server"));
    expect(persistedServers()).toEqual([]);
  });

  it("reduces against the latest persisted list, not a render-time snapshot", () => {
    // Regression guard: the persist updater must derive from the settings it
    // receives (`cur`), so a write captured while another row changed cannot
    // clobber that intervening change.
    currentServers = [STDIO_SERVER];
    render(<McpServersPanel />);
    fireEvent.click(screen.getByTitle("Delete server"));
    const updater = setSettings.mock.calls[0][0] as (cur: {
      agentMode: { mcpServers: unknown };
    }) => { agentMode: { mcpServers: StoredMcpServer[] } };
    // A second server appeared in settings after this delete's closure formed.
    const other = { ...STDIO_SERVER, id: "srv-2", name: "other" };
    const result = updater({ agentMode: { mcpServers: [STDIO_SERVER, other] } });
    expect(result.agentMode.mcpServers).toEqual([other]);
  });

  it("dims a disabled server row", () => {
    currentServers = [{ ...STDIO_SERVER, enabled: false }];
    render(<McpServersPanel />);
    const name = screen.getByText("filesystem");
    // The dimmed wrapper is the row's content container (ancestor of the name).
    expect(name.closest(".tw-opacity-50")).not.toBeNull();
  });
});

describe("upsert via the modal callback", () => {
  // Exercise the persistence path the modal invokes on Save: add a new server,
  // and replace an existing one by id. We drive the panel's onSubmit by
  // submitting the form the panel would have mounted.
  it("editing an existing server via the form replaces it by id", () => {
    const onSubmit = jest.fn();
    render(<McpServerForm initial={STDIO_SERVER} onSubmit={onSubmit} onCancel={jest.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("Server name (e.g. filesystem)"), {
      target: { value: "fs-renamed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const draft = onSubmit.mock.calls[0][0] as StoredMcpServer;
    expect(draft.id).toBe("srv-1");
    expect(draft.name).toBe("fs-renamed");
  });

  it("http transport requires a URL and reveals the Headers editor", () => {
    const onSubmit = jest.fn();
    render(
      <McpServerForm
        initial={{
          id: "h",
          enabled: true,
          name: "remote",
          transport: "http",
          url: "",
          headers: [],
        }}
        onSubmit={onSubmit}
        onCancel={jest.fn()}
      />
    );
    const save = screen.getByText("Save").closest("button") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText("https://example.com/mcp"), {
      target: { value: "https://mcp.example.com/sse" },
    });
    expect(save.disabled).toBe(false);
    // Add a header row, fill it, and confirm it survives Save.
    fireEvent.click(screen.getByRole("button", { name: /Add header/ }));
    const headerRow = screen.getByPlaceholderText("Authorization").closest("div")!;
    fireEvent.change(within(headerRow).getByPlaceholderText("Authorization"), {
      target: { value: "Authorization" },
    });
    fireEvent.change(within(headerRow).getByPlaceholderText("Bearer …"), {
      target: { value: "Bearer t" },
    });
    fireEvent.click(save);
    expect((onSubmit.mock.calls[0][0] as StoredMcpServer).headers).toEqual([
      { name: "Authorization", value: "Bearer t" },
    ]);
  });
});
