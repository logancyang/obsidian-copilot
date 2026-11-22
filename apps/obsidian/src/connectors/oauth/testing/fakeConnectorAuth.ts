import type { ConnectorAuthPort } from "@/connectors/connectionManager";
import type {
  AccessTokenResult,
  ConnectorLoginTarget,
  LoginOutcome,
} from "@/connectors/oauth/connectorAuth";

export const LOGIN_URL = "https://notion.example/authorize?state=1";

interface PendingLogin {
  target: ConnectorLoginTarget;
  finish: (outcome: LoginOutcome) => void;
}

export function fakeAuth() {
  const logins = new Set<string>();
  const nextAccess = new Map<string, AccessTokenResult>();
  let pending: PendingLogin | null = null;
  const auth = {
    hasLogin: (connectionId: string) => logins.has(connectionId),
    login: jest.fn((target: ConnectorLoginTarget) => {
      if (pending) throw new Error("Finish or cancel the login first.");
      let finish: (outcome: LoginOutcome) => void = () => {};
      const outcome = new Promise<LoginOutcome>((resolve) => {
        finish = (result) => {
          pending = null;
          if (result.status === "connected") logins.add(target.connectionId);
          resolve(result);
        };
      });
      pending = { target, finish };
      return {
        connectionId: target.connectionId,
        serviceName: target.serviceName,
        outcome,
        loginUrl: () => LOGIN_URL,
        cancel: () => finish({ status: "cancelled" }),
      };
    }),
    accessToken: jest.fn(
      async (connectionId: string, _options?: { forceRefresh?: boolean }) =>
        nextAccess.get(connectionId) ??
        (logins.has(connectionId)
          ? ({ status: "connected", accessToken: `token-${connectionId}` } as const)
          : ({ status: "needs-login" } as const))
    ),
    disconnect: jest.fn(async (connectionId: string) => {
      logins.delete(connectionId);
    }),
  } satisfies ConnectorAuthPort;
  return {
    auth,
    logins,
    nextAccess,
    pendingLogin: () => pending,
    finishLogin: (outcome: LoginOutcome) => pending?.finish(outcome),
  };
}
