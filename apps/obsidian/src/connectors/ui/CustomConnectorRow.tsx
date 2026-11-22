import type {
  CustomConnectorState,
  CustomConnectorStatus,
} from "@/connectors/custom/customConnectors";
import { loginFailureMessage } from "@/connectors/oauth/connectorAuth";
import {
  ConnectedStatus,
  ConnectorRow,
  RowMenu,
  StatusLine,
  WaitingConnectorRow,
  type StatusTone,
} from "@/connectors/ui/ConnectorRow";
import { Button } from "@/components/ui/button";
import { Pencil, Power, PowerOff, Trash2 } from "lucide-react";
import React from "react";

export interface CustomConnectorActions {
  onEdit: (id: string) => void;
  onTryAgain: () => void;
  onLogIn: (id: string) => void;
  onSetTurnedOff: (id: string, off: boolean) => void;
  onRemove: (id: string) => void;
  onShowTools: (id: string) => void;
}

interface CustomConnectorRowProps extends CustomConnectorActions {
  connector: CustomConnectorState;
}

export function CustomConnectorRow({
  connector: { config, status },
  onEdit,
  onTryAgain,
  onLogIn,
  onSetTurnedOff,
  onRemove,
  onShowTools,
}: CustomConnectorRowProps): React.ReactElement {
  if (status.kind === "logging-in") {
    return <WaitingConnectorRow service={config} waitingLogin={status} />;
  }
  const [tone, text] = statusText(status, config.name);
  let action: React.ReactNode = null;
  if (status.kind === "needs-login") {
    action = (
      <Button size="sm" onClick={() => onLogIn(config.id)}>
        Log in
      </Button>
    );
  } else if (status.kind === "login-failed") {
    action = (
      <Button size="sm" variant="secondary" onClick={() => onLogIn(config.id)}>
        Try again
      </Button>
    );
  } else if (status.kind === "needs-key" || status.kind === "key-not-accepted") {
    action = (
      <Button size="sm" onClick={() => onEdit(config.id)}>
        Add API key
      </Button>
    );
  } else if (status.kind === "couldnt-start" || status.kind === "unreachable") {
    action = (
      <Button size="sm" variant="secondary" onClick={onTryAgain}>
        Try again
      </Button>
    );
  }
  const off = status.kind === "off";

  return (
    <ConnectorRow
      service={config}
      tag="Custom"
      detail={
        status.kind === "connected" ? (
          <ConnectedStatus
            toolCount={status.tools.length}
            onShowTools={() => onShowTools(config.id)}
          />
        ) : (
          <StatusLine tone={tone}>
            {/* A remote server's error can be a whole HTTP error page.
              https://github.com/Brevilabs/obsidian-copilot-private/issues/862 */}
            <span className="tw-block tw-truncate" title={text}>
              {text}
            </span>
          </StatusLine>
        )
      }
      actions={
        <>
          {action}
          <RowMenu
            name={config.name}
            items={[
              {
                label: "Edit",
                icon: <Pencil />,
                onSelect: () => onEdit(config.id),
                opensDialog: true,
              },
              {
                label: off ? "Turn on on this device" : "Turn off on this device",
                icon: off ? <Power /> : <PowerOff />,
                onSelect: () => onSetTurnedOff(config.id, !off),
              },
              {
                label: "Remove",
                icon: <Trash2 />,
                onSelect: () => onRemove(config.id),
                opensDialog: true,
                destructive: true,
              },
            ]}
          />
        </>
      }
    />
  );
}

function statusText(
  status: Exclude<CustomConnectorStatus, { kind: "logging-in" }>,
  name: string
): [StatusTone, string] {
  switch (status.kind) {
    case "connected":
      return [
        "ok",
        `Connected · ${status.tools.length} ${status.tools.length === 1 ? "tool" : "tools"}`,
      ];
    case "starting":
      return ["idle", "Starting…"];
    case "idle":
      return ["idle", "Starts in your next chat"];
    case "couldnt-start":
      return ["attention", `Couldn't start · ${status.reason}`];
    case "unreachable":
      return ["idle", `Couldn't reach · ${status.reason}`];
    case "key-not-accepted":
      return ["attention", "Key not accepted"];
    case "needs-key":
      return ["attention", "Add API key on this device"];
    case "needs-login":
      return ["attention", "Needs login"];
    case "login-failed":
      return ["attention", loginFailureMessage(status.reason, name)];
    case "off":
      return ["idle", "Off on this device"];
  }
}
