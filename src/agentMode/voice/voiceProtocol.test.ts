import {
  VOICE_PROTOCOL_VERSION,
  controlSocketPath,
  parseCreateVoiceSessionResponse,
  parseServerEvent,
} from "@/agentMode/voice/voiceProtocol";

/**
 * Frames recorded during the transport check against the voice server, with
 * identifiers shortened and every payload that could carry speech removed.
 * `voiceProtocol.ts` is copied verbatim from the server repository, so this
 * suite is not testing the validators' internals — it pins the shapes the
 * deployed server actually sends, so a change on either side that drifts from
 * the other fails here instead of in a call.
 */
const RECORDED_SERVER_FRAMES = {
  ack: {
    protocolVersion: VOICE_PROTOCOL_VERSION,
    eventId: "ev_a1",
    conversationId: "voice-check-1",
    voiceSessionId: "vs_1",
    seq: 1,
    type: "ack",
    ackEventId: "ev_client_1",
  },
  delegationRequested: {
    protocolVersion: VOICE_PROTOCOL_VERSION,
    eventId: "ev_a2",
    conversationId: "voice-check-1",
    voiceSessionId: "vs_1",
    seq: 2,
    type: "delegation.requested",
    liveDelegationId: "fake_delegation_1",
    offsetMs: 1000,
  },
  usageUpdated: {
    protocolVersion: VOICE_PROTOCOL_VERSION,
    eventId: "ev_a3",
    conversationId: "voice-check-1",
    voiceSessionId: "vs_1",
    seq: 3,
    type: "usage.updated",
    usage: { connectedSeconds: 15, estimatedCostUsd: 0.0125, source: "provider" },
  },
  sessionWarning: {
    protocolVersion: VOICE_PROTOCOL_VERSION,
    eventId: "ev_a4",
    conversationId: "voice-check-1",
    voiceSessionId: "vs_1",
    seq: 4,
    type: "session.warning",
    reason: "deadline-approaching",
    secondsRemaining: 60,
  },
  error: {
    protocolVersion: VOICE_PROTOCOL_VERSION,
    eventId: "ev_a5",
    conversationId: "voice-check-1",
    voiceSessionId: "vs_1",
    seq: 5,
    type: "error",
    code: "upstream-failed",
    recoverable: true,
    detail: "input command was rejected upstream",
  },
  sessionClosed: {
    protocolVersion: VOICE_PROTOCOL_VERSION,
    eventId: "ev_a6",
    conversationId: "voice-check-1",
    voiceSessionId: "vs_1",
    seq: 6,
    type: "session.closed",
    reason: "client-requested",
    usage: { connectedSeconds: 20, estimatedCostUsd: 0.0167, source: "local-clock" },
    usageFinal: false,
  },
} as const;

/** Creation response recorded from the deployed server, SDP and ticket redacted. */
const RECORDED_CREATION_RESPONSE = {
  voiceSessionId: "vs_1",
  sdpAnswer: "v=0\r\n<redacted>",
  controlTicket: "<redacted>",
  expiresAt: "2026-09-11T05:56:40.084Z",
  limits: { maxSessionSeconds: 600, warnAtSeconds: 540 },
};

describe("voiceProtocol", () => {
  describe("parseServerEvent()", () => {
    it.each(Object.entries(RECORDED_SERVER_FRAMES))(
      "accepts the recorded %s frame and returns it typed",
      (_name, frame) => {
        const parsed = parseServerEvent(frame);

        expect(parsed).toEqual({ ok: true, value: frame });
      }
    );

    it("rejects a frame from a future protocol version rather than guessing its meaning", () => {
      const parsed = parseServerEvent({
        ...RECORDED_SERVER_FRAMES.ack,
        protocolVersion: VOICE_PROTOCOL_VERSION + 1,
      });

      expect(parsed.ok).toBe(false);
    });

    it("rejects a close frame whose usage is missing, so an unusable report is never shown", () => {
      const withoutUsage: Record<string, unknown> = { ...RECORDED_SERVER_FRAMES.sessionClosed };
      delete withoutUsage.usage;

      const parsed = parseServerEvent(withoutUsage);

      expect(parsed.ok).toBe(false);
    });

    it("rejects an unknown event type instead of passing it to the caller", () => {
      const parsed = parseServerEvent({
        ...RECORDED_SERVER_FRAMES.ack,
        type: "session.something.new",
      });

      expect(parsed.ok).toBe(false);
    });
  });

  describe("parseCreateVoiceSessionResponse()", () => {
    it("accepts the recorded creation response, including its limits", () => {
      const parsed = parseCreateVoiceSessionResponse(RECORDED_CREATION_RESPONSE);

      expect(parsed).toEqual({ ok: true, value: RECORDED_CREATION_RESPONSE });
    });

    it("accepts a null SDP answer, which is how a control-only call is reported", () => {
      const parsed = parseCreateVoiceSessionResponse({
        ...RECORDED_CREATION_RESPONSE,
        sdpAnswer: null,
      });

      expect(parsed.ok && parsed.value.sdpAnswer).toBeNull();
    });
  });

  describe("controlSocketPath()", () => {
    it("builds the control path the deployed server routes", () => {
      expect(controlSocketPath("vs_1")).toBe("/v1/voice/sessions/vs_1/control");
    });
  });
});
