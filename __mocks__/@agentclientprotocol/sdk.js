// Lightweight mock for @agentclientprotocol/sdk so unit tests can import
// modules that reference its runtime values (RequestError, ClientSideConnection,
// PROTOCOL_VERSION, ndJsonStream) without pulling the real ESM package
// through ts-jest. Tests that need behavior beyond this mock should stub
// their own.
/* eslint-disable no-undef */

class RequestError extends Error {
  constructor(code, message, data) {
    super(message);
    this.code = code;
    this.data = data;
    this.name = "RequestError";
  }
  static parseError(data, msg) {
    return new RequestError(-32700, msg ?? "Parse error", data);
  }
  static invalidRequest(data, msg) {
    return new RequestError(-32600, msg ?? "Invalid Request", data);
  }
  static methodNotFound(method) {
    return new RequestError(-32601, `Method not found: ${method}`);
  }
  static invalidParams(data, msg) {
    return new RequestError(-32602, msg ?? "Invalid params", data);
  }
  static internalError(data, msg) {
    return new RequestError(-32603, msg ?? "Internal error", data);
  }
  static authRequired(data, msg) {
    return new RequestError(-32000, msg ?? "Authentication required", data);
  }
  static resourceNotFound(uri) {
    return new RequestError(-32001, `Resource not found${uri ? `: ${uri}` : ""}`);
  }
  toResult() {
    return { error: this.toErrorResponse() };
  }
  toErrorResponse() {
    return { code: this.code, message: this.message, data: this.data };
  }
}

class ClientSideConnection {
  constructor(toClient, _stream) {
    this._client = toClient(this);
  }
  initialize = jest.fn(async () => ({ protocolVersion: 1 }));
  newSession = jest.fn(async () => ({ sessionId: "test-session" }));
  prompt = jest.fn(async () => ({ stopReason: "end_turn" }));
  cancel = jest.fn(async () => undefined);
}

const ndJsonStream = jest.fn(() => ({}));
const PROTOCOL_VERSION = 1;

module.exports = {
  RequestError,
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
};
