import type {
  CustomConnectorState,
  CustomConnectorStatus,
} from "@/connectors/custom/customConnectors";
import { ConnectorRow, RowMenu, StatusLine, type StatusTone } from "@/connectors/ui/ConnectorRow";
import { Button } from "@/components/ui/button";
import { Pencil, Power, PowerOff, Trash2 } from "lucide-react";
import React from "react";

export interface CustomConnectorActions {
  onEdit: (id: string) => void;
  onTryAgain: () => void;
  onSetTurnedOff: (id: string, off: boolean) => void;
  onRemove: (id: string) => void;
}

interface CustomConnectorRowProps extends CustomConnectorActions {
  connector: CustomConnectorState;
}

export function CustomConnectorRow({
  connector: { config, status },
  onEdit,
  onTryAgain,
  onSetTurnedOff,
  onRemove,
}: CustomConnectorRowProps): React.ReactElement {
  const [tone, text] = customStatusText(status);
  let action: React.ReactNode = null;
  if (status.kind === "needs-key" || status.kind === "key-not-accepted") {
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
        <StatusLine tone={tone}>
          {/* A remote server's error can be a whole HTTP error page.
            https://github.com/Brevilabs/obsidian-copilot-private/issues/862 */}
          <span className="tw-block tw-truncate" title={text}>
            {text}
          </span>
        </StatusLine>
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

export function customStatusText(status: CustomConnectorStatus): [StatusTone, string] {
  switch (status.kind) {
    case "connected":
      return ["ok", `${status.toolCount} ${status.toolCount === 1 ? "tool" : "tools"}`];
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
    case "off":
      return ["idle", "Off on this device"];
  }
}
