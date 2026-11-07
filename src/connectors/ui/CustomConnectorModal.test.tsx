import { ReactModal } from "@/components/modals/ReactModal";
import { parseCustomConnectors } from "@/connectors/custom/customConnectorConfig";
import {
  CustomConnectorForm,
  CustomConnectorModal,
  ServerSummary,
  type CustomConnectorFormProps,
} from "@/connectors/ui/CustomConnectorModal";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { App } from "obsidian";
import React from "react";

const HELPER =
  "Paste the MCP server config from its README. Values in env and headers stay in this device's keychain.";

const LOCAL_AND_REMOTE = JSON.stringify({
  mcpServers: {
    GitHub: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_TOKEN: "ghp_secret" },
    },
    "Acme Docs": {
      url: "https://mcp.acme.test/mcp",
      headers: { Authorization: "Bearer key", "X-Team": "docs" },
    },
  },
});

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/862";

const parse = (text: string) => parseCustomConnectors(text, new Set());

function renderForm(props: Partial<CustomConnectorFormProps> = {}) {
  const handlers = { onSubmit: jest.fn(), onCancel: jest.fn() };
  render(
    <CustomConnectorForm helper={HELPER} submitLabel="Add" parse={parse} {...handlers} {...props} />
  );
  return handlers;
}

function paste(text: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "Connector config" }), {
    target: { value: text },
  });
}

function addButton(): HTMLButtonElement {
  return screen.getByRole<HTMLButtonElement>("button", { name: "Add" });
}

describe("CustomConnectorModal", () => {
  afterEach(() => document.body.replaceChildren());

  describe("CustomConnectorForm()", () => {
    it("shows the helper text, and keeps Add disabled with no error while the box is empty", () => {
      renderForm();

      expect(screen.getByText(HELPER)).toBeTruthy();
      expect(addButton().disabled).toBe(true);
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("previews each pasted server before adding: its command or URL and how many values stay in the keychain", () => {
      renderForm();

      paste(LOCAL_AND_REMOTE);

      const github = within(screen.getByRole("listitem", { name: "GitHub" }));
      expect(github.getByText("Local · npx -y @modelcontextprotocol/server-github")).toBeTruthy();
      expect(github.getByText("1 value stays in this device's keychain")).toBeTruthy();
      const acme = within(screen.getByRole("listitem", { name: "Acme Docs" }));
      expect(acme.getByText("Remote · https://mcp.acme.test/mcp")).toBeTruthy();
      expect(acme.getByText("2 values stay in this device's keychain")).toBeTruthy();
      expect(addButton().disabled).toBe(false);
    });

    it("leaves out the keychain line for a server with no env or header values", () => {
      renderForm();

      paste('{"name": "Echo", "command": "echo-server"}');

      const echo = within(screen.getByRole("listitem", { name: "Echo" }));
      expect(echo.getByText("Local · echo-server")).toBeTruthy();
      expect(echo.queryByText(/keychain/)).toBeNull();
    });

    it(`names each value with nothing typed and nothing stored on this device, without blocking Save: ${ISSUE}`, () => {
      renderForm({ submitLabel: "Save", storedValueNames: new Set(["FAKE_KEY"]) });

      paste(
        JSON.stringify({
          mcpServers: {
            Echo: { command: "echo-server", env: { FAKE_KEY: "", FAKE_STORE: "", FAKE_LABEL: "" } },
          },
        })
      );
      const echo = within(screen.getByRole("listitem", { name: "Echo" }));
      expect(echo.getByText("No value on this device: FAKE_STORE, FAKE_LABEL")).toBeTruthy();
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled).toBe(false);

      paste(
        JSON.stringify({
          mcpServers: {
            Echo: {
              command: "echo-server",
              env: { FAKE_KEY: "", FAKE_STORE: "s", FAKE_LABEL: "l" },
            },
          },
        })
      );
      expect(echo.queryByText(/No value on this device/)).toBeNull();
    });

    it("shows why the input isn't valid, previews nothing and keeps Add disabled", () => {
      renderForm();

      paste('{"mcpServers": {');

      expect(screen.getByRole("alert").textContent).toBe("This isn't valid JSON.");
      expect(screen.queryByRole("listitem")).toBeNull();
      expect(addButton().disabled).toBe(true);
    });

    it("hands the previewed servers and the text to Add", () => {
      const { onSubmit } = renderForm();

      paste(LOCAL_AND_REMOTE);
      fireEvent.click(addButton());

      const parsed = parse(LOCAL_AND_REMOTE);
      if (!parsed.ok) throw new Error(parsed.error);
      expect(onSubmit).toHaveBeenCalledWith(LOCAL_AND_REMOTE, parsed.connectors);
    });

    it("starts from the given text with its own submit label, as Edit does", () => {
      const text = JSON.stringify({ mcpServers: { Echo: { command: "echo-server" } } });
      const { onSubmit } = renderForm({ initialText: text, submitLabel: "Save" });

      expect(screen.getByRole("textbox", { name: "Connector config" })).toHaveProperty(
        "value",
        text
      );
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(onSubmit).toHaveBeenCalledWith(text, expect.any(Array));
    });

    it("cancels on Cancel", () => {
      const { onCancel, onSubmit } = renderForm();

      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });

  describe("ServerSummary()", () => {
    it("shows a local server's whole command, how many values stay in the keychain, and the values still missing", () => {
      render(
        <ServerSummary
          config={{
            id: "fake",
            name: "Fake",
            command: "node",
            args: ["/srv/fake.mjs", "--verbose"],
            envNames: ["FAKE_KEY", "FAKE_STORE"],
          }}
          missing={["FAKE_STORE"]}
        />
      );

      expect(screen.getByText("Local · node /srv/fake.mjs --verbose")).toBeTruthy();
      expect(screen.getByText("2 values stay in this device's keychain")).toBeTruthy();
      expect(screen.getByText("No value on this device: FAKE_STORE")).toBeTruthy();
    });
  });

  describe("CustomConnectorModal", () => {
    async function openModal(onSubmit: CustomConnectorFormProps["onSubmit"]) {
      const modal = new CustomConnectorModal(new App(), "Add custom connector", {
        helper: HELPER,
        submitLabel: "Add",
        parse,
        onSubmit,
      });
      modal.contentEl.empty = () => modal.contentEl.replaceChildren();
      document.body.appendChild(modal.containerEl);
      await act(async () => {
        ReactModal.prototype.onOpen.call(modal);
      });
      return modal;
    }

    describe("constructor()", () => {
      it("titles the dialog", () => {
        const modal = new CustomConnectorModal(new App(), "Edit GitHub", {
          helper: "",
          submitLabel: "Save",
          parse,
          onSubmit: jest.fn(),
        });

        expect(modal.titleEl.textContent).toBe("Edit GitHub");
      });
    });

    describe("onOpen()", () => {
      it("submits the pasted servers and closes the dialog", async () => {
        const onSubmit = jest.fn();
        const modal = await openModal(onSubmit);

        paste(LOCAL_AND_REMOTE);
        fireEvent.click(within(modal.contentEl).getByRole("button", { name: "Add" }));

        expect(onSubmit).toHaveBeenCalledWith(LOCAL_AND_REMOTE, expect.any(Array));
        expect(modal.close).toHaveBeenCalledTimes(1);
        await act(async () => {
          ReactModal.prototype.onClose.call(modal);
        });
      });

      it("closes without submitting on Cancel", async () => {
        const onSubmit = jest.fn();
        const modal = await openModal(onSubmit);

        fireEvent.click(within(modal.contentEl).getByRole("button", { name: "Cancel" }));

        expect(modal.close).toHaveBeenCalledTimes(1);
        expect(onSubmit).not.toHaveBeenCalled();
        await act(async () => {
          ReactModal.prototype.onClose.call(modal);
        });
      });
    });
  });
});
