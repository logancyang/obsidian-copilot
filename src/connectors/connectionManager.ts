import type { ConnectorCatalogEntry } from "@/connectors/catalog";
import type { CustomConnectors } from "@/connectors/custom/customConnectors";
import type {
  AccessTokenResult,
  ConnectorAuth,
  LoginFailureReason,
  LoginOutcome,
} from "@/connectors/oauth/connectorAuth";
import { getSettings, updateSetting } from "@/settings/model";

export interface ConnectorConnection {
  readonly id: string;
  readonly serviceId: string;
  readonly accountLabel?: string;
}

export type ConnectionStatus = AccessTokenResult["status"];

export interface ConnectionState extends ConnectorConnection {
  readonly status: ConnectionStatus;
}

export interface WaitingLogin {
  readonly connectionId: string;
  readonly serviceId: string;
  loginUrl(): string | null;
  cancel(): void;
}

export interface FailedLogin {
  readonly connectionId: string;
  readonly serviceId: string;
  readonly reason: LoginFailureReason;
}

export interface ConnectorsSnapshot {
  readonly connections: readonly ConnectionState[];
  readonly waitingLogin: WaitingLogin | null;
  readonly failedLogin: FailedLogin | null;
  readonly needsAttention: boolean;
}

export type ConnectorAuthPort = Pick<
  ConnectorAuth,
  "login" | "accessToken" | "disconnect" | "hasLogin"
>;

export interface ConnectionManagerDeps {
  auth: ConnectorAuthPort;
  catalog: readonly ConnectorCatalogEntry[];
  custom?: Pick<CustomConnectors, "subscribe" | "getSnapshot">;
}

const EMPTY_CONNECTIONS: readonly ConnectionState[] = Object.freeze([]);

export class ConnectionManager {
  private readonly services: ReadonlyMap<string, ConnectorCatalogEntry>;
  private readonly statuses = new Map<string, ConnectionStatus>();
  private readonly listeners = new Set<() => void>();
  private waitingLogin: WaitingLogin | null = null;
  private failedLogin: FailedLogin | null = null;
  private snapshot: ConnectorsSnapshot;

  constructor(private readonly deps: ConnectionManagerDeps) {
    this.services = new Map(deps.catalog.map((service) => [service.id, service]));
    this.snapshot = this.buildSnapshot();
    // A custom connector that lacks its key on this device raises the same banner and settings dot as a catalog login.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/862
    deps.custom?.subscribe(() => this.publish());
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): ConnectorsSnapshot => this.snapshot;

  connect(serviceId: string): Promise<LoginOutcome> {
    const service = this.services.get(serviceId);
    if (!service) throw new Error(`No connector for ${serviceId}.`);
    return this.login(crypto.randomUUID(), service, true);
  }

  reconnect(connectionId: string): Promise<LoginOutcome> {
    const connection = this.snapshot.connections.find(({ id }) => id === connectionId);
    const service = connection && this.services.get(connection.serviceId);
    if (!service) throw new Error(`No connection ${connectionId}.`);
    return this.login(connectionId, service, false);
  }

  async disconnect(connectionId: string): Promise<void> {
    // A reconnect left waiting would store a login for a connection that no longer exists.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/856
    if (this.waitingLogin?.connectionId === connectionId) this.waitingLogin.cancel();
    // Removing the connection before revoking its login stops a Reconnect during revocation from storing a login nothing tracks.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/856
    this.statuses.delete(connectionId);
    if (this.failedLogin?.connectionId === connectionId) this.failedLogin = null;
    updateSetting(
      "connectors",
      getSettings().connectors.filter(({ id }) => id !== connectionId)
    );
    this.publish();
    await this.deps.auth.disconnect(connectionId);
  }

  async accessToken(
    connectionId: string,
    options?: { forceRefresh?: boolean }
  ): Promise<AccessTokenResult> {
    const result = await this.deps.auth.accessToken(connectionId, options);
    this.setStatus(connectionId, result.status);
    return result;
  }

  reportFailure(connectionId: string, status: Exclude<ConnectionStatus, "connected">): void {
    this.setStatus(connectionId, status);
  }

  dismissFailedLogin(): void {
    if (!this.failedLogin) return;
    this.failedLogin = null;
    this.publish();
  }

  async checkStatus(): Promise<void> {
    await Promise.all(this.snapshot.connections.map(({ id }) => this.accessToken(id)));
  }

  dispose(): void {
    this.listeners.clear();
    this.waitingLogin?.cancel();
  }

  private login(
    connectionId: string,
    service: ConnectorCatalogEntry,
    isNew: boolean
  ): Promise<LoginOutcome> {
    const login = this.deps.auth.login({
      connectionId,
      serverUrl: service.serverUrl,
      serviceName: service.name,
    });
    this.waitingLogin = Object.freeze({
      connectionId,
      serviceId: service.id,
      loginUrl: () => login.loginUrl(),
      cancel: () => login.cancel(),
    });
    this.failedLogin = null;
    this.publish();
    return login.outcome.then((outcome) => {
      this.waitingLogin = null;
      if (outcome.status === "connected") {
        this.statuses.set(connectionId, "connected");
        if (isNew) {
          updateSetting("connectors", [
            ...getSettings().connectors,
            { id: connectionId, serviceId: service.id },
          ]);
        }
      } else if (outcome.status === "failed") {
        this.failedLogin = Object.freeze({
          connectionId,
          serviceId: service.id,
          reason: outcome.reason,
        });
      }
      this.publish();
      return outcome;
    });
  }

  private setStatus(connectionId: string, status: ConnectionStatus): void {
    if (this.statuses.get(connectionId) === status) return;
    this.statuses.set(connectionId, status);
    this.publish();
  }

  private publish(): void {
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) listener();
  }

  private buildSnapshot(): ConnectorsSnapshot {
    // A list synced from another Copilot version can name a service this catalog does not have.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/856
    const connections = getSettings()
      .connectors.filter(({ serviceId }) => this.services.has(serviceId))
      .map((connection) =>
        Object.freeze({
          ...connection,
          status:
            this.statuses.get(connection.id) ??
            (this.deps.auth.hasLogin(connection.id) ? "connected" : "needs-login"),
        })
      );
    return Object.freeze({
      connections: connections.length > 0 ? Object.freeze(connections) : EMPTY_CONNECTIONS,
      waitingLogin: this.waitingLogin,
      failedLogin: this.failedLogin,
      needsAttention:
        connections.some(({ status }) => status === "needs-login") ||
        this.deps.custom?.getSnapshot().needsAttention === true,
    });
  }
}
