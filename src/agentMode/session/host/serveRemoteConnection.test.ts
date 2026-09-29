import { PROTOCOL_VERSION, type ServerFrame } from "@/agentMode/protocol/frames";
import {
  buildHost,
  FakeManager,
  makeTestSession,
  settle,
} from "@/agentMode/session/host/hostTestHarness";
import {
  MAX_OUTBOUND_FRAME_CHARS,
  serveRemoteConnection,
  type PhoneConnection,
} from "@/agentMode/session/host/serveRemoteConnection";
import { logWarn } from "@/logger";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock("@/settings/model", () => ({
  getSettings: jest.fn().mockReturnValue({ agentMode: {} }),
}));
jest.mock("@/plusUtils", () => ({
  ensureMultiAgentEntitlement: jest.fn(async () => true),
  showMultiAgentUpgradePrompt: jest.fn(),
}));

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/613";

class FakePhone implements PhoneConnection {
  readonly sent: ServerFrame[] = [];
  closedWith: number | null = null;
  private onMessageHandlers = new Set<(text: string) => void>();
  private onCloseHandlers = new Set<(event: { code: number }) => void>();

  send(text: string): void {
    this.sent.push(JSON.parse(text) as ServerFrame);
  }
  onMessage(handler: (text: string) => void): () => void {
    this.onMessageHandlers.add(handler);
    return () => this.onMessageHandlers.delete(handler);
  }
  onClose(handler: (event: { code: number }) => void): () => void {
    this.onCloseHandlers.add(handler);
    return () => this.onCloseHandlers.delete(handler);
  }
  close(code?: number): void {
    this.closedWith = code ?? 1000;
  }
  receive(frame: unknown): void {
    for (const handler of [...this.onMessageHandlers]) handler(JSON.stringify(frame));
  }
  receiveText(text: string): void {
    for (const handler of [...this.onMessageHandlers]) handler(text);
  }
  drop(code = 1006): void {
    for (const handler of [...this.onCloseHandlers]) handler({ code });
  }
  get messageHandlerCount(): number {
    return this.onMessageHandlers.size;
  }
}

function setup() {
  const manager = new FakeManager();
  manager.add(makeTestSession("s1").session);
  const host = buildHost(manager);
  const phone = new FakePhone();
  const onSessionStart = jest.fn();
  const onCommand = jest.fn();
  const detach = serveRemoteConnection(host, phone, { onSessionStart, onCommand });
  return { manager, host, phone, detach, onSessionStart, onCommand };
}

describe("serveRemoteConnection", () => {
  describe("serveRemoteConnection()", () => {
    it("answers the phone's hello and its subscription with the host's frames as JSON text", () => {
      const { phone } = setup();

      phone.receive({ type: "hello", v: PROTOCOL_VERSION, app: "1.0" });
      phone.receive({ type: "subscribe", scope: "host" });

      expect(phone.sent.map((frame) => frame.type)).toEqual(["hello", "snapshot"]);
      expect(phone.sent[0]).toMatchObject({ ok: true, hostId: "host-under-test" });
    });

    it("runs a command from the phone and returns its result", async () => {
      const { phone } = setup();
      phone.receive({ type: "hello", v: PROTOCOL_VERSION, app: "1.0" });
      phone.receive({ type: "subscribe", scope: "host" });

      phone.receive({
        type: "command",
        id: "1",
        command: { name: "renameSession", sessionId: "s1", label: "From my phone" },
      });
      await settle();

      expect(phone.sent.find((frame) => frame.type === "result")).toMatchObject({
        id: "1",
        result: { ok: true },
      });
    });

    it(`closes with 1003 on text that is not a protocol frame and never forwards it to the host (${ISSUE})`, () => {
      const { phone } = setup();

      phone.receiveText("not json");
      phone.receive({ type: "mystery" });

      expect(phone.closedWith).toBe(1003);
      expect(phone.sent).toEqual([]);
    });

    it(`reports the session start once and each command by name only (${ISSUE})`, async () => {
      const { phone, onSessionStart, onCommand } = setup();

      phone.receive({ type: "hello", v: PROTOCOL_VERSION, app: "1.0" });
      phone.receive({ type: "hello", v: PROTOCOL_VERSION, app: "1.0" });
      phone.receive({
        type: "command",
        id: "1",
        command: { name: "renameSession", sessionId: "s1", label: "secret title" },
      });
      await settle();

      expect(onSessionStart).toHaveBeenCalledTimes(1);
      expect(onCommand).toHaveBeenCalledWith("renameSession");
      expect(JSON.stringify(onCommand.mock.calls)).not.toContain("secret title");
    });

    it(`does not report a command whose name is too long to be one of the protocol's (${ISSUE})`, () => {
      const { phone, onCommand } = setup();
      phone.receive({ type: "hello", v: PROTOCOL_VERSION, app: "1.0" });

      phone.receive({ type: "command", id: "1", command: { name: "x".repeat(200) } });

      expect(onCommand).not.toHaveBeenCalled();
    });

    it("stops delivering host frames and listening once the connection closes", () => {
      const { phone, manager } = setup();
      phone.receive({ type: "hello", v: PROTOCOL_VERSION, app: "1.0" });
      phone.receive({ type: "subscribe", scope: "host" });
      phone.sent.length = 0;

      phone.drop(1006);
      manager.add(makeTestSession("s2").session);

      expect(phone.sent).toEqual([]);
      expect(phone.messageHandlerCount).toBe(0);
    });

    it("closes the connection with 1001 when the host shuts down", () => {
      const { phone, host } = setup();
      phone.receive({ type: "hello", v: PROTOCOL_VERSION, app: "1.0" });

      host.dispose();

      expect(phone.closedWith).toBe(1001);
    });

    it(`refuses to send a frame over the outbound limit and closes with 1009 instead (${ISSUE})`, () => {
      const manager = new FakeManager();
      const host = buildHost(manager);
      const phone = new FakePhone();
      let deliver: (frame: ServerFrame) => void = () => {};
      serveRemoteConnection(
        {
          connect: (send) => {
            deliver = send;
            return { receive: () => {}, close: () => {} };
          },
        },
        phone
      );

      deliver({
        type: "snapshot",
        scope: "host",
        epoch: "e",
        seq: 0,
        state: { padding: "x".repeat(MAX_OUTBOUND_FRAME_CHARS) } as never,
      });

      expect(phone.closedWith).toBe(1009);
      expect(phone.sent).toEqual([]);
      expect(logWarn).toHaveBeenCalled();
      host.dispose();
    });
  });
});
