import fs from "fs";
import path from "path";
import {
  startRemoteRig,
  waitUntil,
  type PhoneStack,
  type RemoteRig,
} from "@/agentMode/mobile/remoteTestKit";
import { PROTOCOL_VERSION } from "@/agentMode/protocol/frames";
import { makeTestSession } from "@/agentMode/session/host/hostTestHarness";
import { playScript } from "@/agentMode/session/host/scriptRunner";
import type { SessionScript } from "@/agentMode/session/host/sessionScript";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock("@/settings/model", () => ({
  getSettings: jest.fn().mockReturnValue({ agentMode: {} }),
}));
jest.mock("@/plusUtils", () => ({
  ensureMultiAgentEntitlement: jest.fn(async () => true),
  showMultiAgentUpgradePrompt: jest.fn(),
}));

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/613";
const FIXTURE_DIR = path.join(__dirname, "__fixtures__");
const SCRIPTS = fs
  .readdirSync(FIXTURE_DIR)
  .filter((name) => name.endsWith(".script.json"))
  .sort()
  .map((name) => ({
    name,
    script: JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), "utf8")) as SessionScript,
  }));

function replicaMatchesHost(rig: RemoteRig, phone: PhoneStack, id: string): boolean {
  try {
    expect(phone.client.getSession(id)).toEqual(rig.host().getSessionState(id));
    expect(phone.client.getHost()).toEqual(rig.host().getHostState());
    return true;
  } catch {
    return false;
  }
}

async function attach(rig: RemoteRig, id: string) {
  const { session, backend } = makeTestSession(id, "claude");
  rig.manager.add(session);
  const phone = rig.connectPhone();
  phone.client.watchSession(id);
  await waitUntil(() => phone.client.getConnection() === "live" && !!phone.client.getSession(id));
  return { phone, session, backend };
}

describe("SessionHost over the WebSocket transport", () => {
  let rig: RemoteRig;

  beforeEach(async () => {
    rig = await startRemoteRig();
  });
  afterEach(async () => {
    await rig.stop();
  });

  describe.each(SCRIPTS)("$name", ({ script }) => {
    it(`keeps a phone's replica equal to the host after every step of the recorded session (${ISSUE})`, async () => {
      const { session, backend } = makeTestSession("s1", script.backendId);
      rig.manager.add(session);
      const phone = rig.connectPhone();
      phone.client.watchSession("s1");
      await waitUntil(
        () => phone.client.getConnection() === "live" && !!phone.client.getSession("s1")
      );
      const settle = async () => {
        await waitUntil(() => replicaMatchesHost(rig, phone, "s1"), 5000);
      };

      await playScript(script, {
        session,
        backend,
        client: phone.client,
        sessionId: "s1",
        backendSessionId: "acp-s1",
        settle,
        afterStep: settle,
      });

      expect(replicaMatchesHost(rig, phone, "s1")).toBe(true);
    }, 30000);
  });

  describe("version handshake", () => {
    it(`reports both versions and subscribes to nothing when the phone speaks another protocol version (${ISSUE})`, async () => {
      const phone = rig.connectPhone({ helloVersion: PROTOCOL_VERSION + 1 });
      phone.client.watchSession("s1");

      await waitUntil(() => phone.client.getConnection() === "version_mismatch");

      expect(phone.client.getHostVersion()).toEqual({ v: PROTOCOL_VERSION, app: "test-1.0.0" });
      expect(phone.client.getHost()).toBeNull();
    });
  });

  describe("reconnecting", () => {
    it(`resumes from the cursor with ops and no snapshot when the phone returns to the foreground (${ISSUE})`, async () => {
      const { phone, session, backend } = await attach(rig, "s1");
      backend.holdPrompt();
      session.sendPrompt("hello");
      await waitUntil(() => replicaMatchesHost(rig, phone, "s1"));
      const frames: string[] = [];
      phone.transport.onFrame((frame) =>
        frames.push(`${frame.type}:${"scope" in frame ? frame.scope : ""}`)
      );

      phone.visibility.set(false);
      backend.emit({
        sessionId: "acp-s1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "while away" },
        },
      });
      phone.visibility.set(true);
      await waitUntil(() => replicaMatchesHost(rig, phone, "s1") && frames.length >= 2);

      expect(frames.filter((frame) => frame.startsWith("snapshot"))).toEqual([]);
      expect(frames).toContain("ops:session:s1");
      expect(frames).toContain("ops:host");
      expect(phone.client.getConnection()).toBe("live");
    });

    it(`resnapshots every scope instead of resuming when the desktop host restarted behind the same address (${ISSUE})`, async () => {
      const { phone } = await attach(rig, "s1");
      await waitUntil(() => replicaMatchesHost(rig, phone, "s1"));
      const frames: string[] = [];
      phone.transport.onFrame((frame) =>
        frames.push(`${frame.type}:${"scope" in frame ? frame.scope : ""}`)
      );
      const oldEpoch = phone.client.getCursorEpoch("session:s1");

      rig.replaceHost({ newHostId: () => "host-after-restart" });
      phone.transport.reconnectNow();
      await waitUntil(
        () => phone.client.getConnection() === "live" && replicaMatchesHost(rig, phone, "s1")
      );

      expect(frames).toContain("snapshot:host");
      expect(frames).toContain("snapshot:session:s1");
      expect(phone.client.getCursorEpoch("session:s1")).not.toBe(oldEpoch);
    });

    it(`fails a command the host already ran with disconnected when the socket drops before its result arrives, and never sends it again (${ISSUE})`, async () => {
      const session = makeTestSession("s1", "claude");
      rig.manager.add(session.session);
      const phone = rig.connectPhone({ dropResults: true });
      phone.client.watchSession("s1");
      await waitUntil(
        () => phone.client.getConnection() === "live" && !!phone.client.getSession("s1")
      );
      session.backend.holdPrompt();
      const sends = jest.spyOn(session.session, "sendPrompt");
      const pending = phone.client.command({ name: "send", sessionId: "s1", text: "hi" });
      await waitUntil(() => sends.mock.calls.length === 1);

      phone.transport.reconnectNow();
      const result = await pending;
      await waitUntil(() => phone.client.getConnection() === "live");
      await new Promise((resolve) => window.setTimeout(resolve, 100));

      expect(result).toEqual({ ok: false, code: "failed", message: "disconnected" });
      expect(sends).toHaveBeenCalledTimes(1);
    });
  });
});
