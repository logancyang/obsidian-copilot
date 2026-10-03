import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface CompanionSetupViewProps {
  displayName: string;
  binaryPath: string;
  busy: boolean;
  output: string;
  automaticTools?: boolean;
  consent: boolean;
  onInstall: () => void;
  onCheck: () => void;
  onSignIn: () => void;
  onTerminalSignIn?: () => void;
  onSavePath: (path: string) => Promise<unknown>;
  onConsent: () => void;
}

export const CompanionSetupView: React.FC<CompanionSetupViewProps> = (props) => {
  const [draft, setDraft] = React.useState<{ source: string; value: string }>({
    source: props.binaryPath,
    value: props.binaryPath,
  });
  const path = draft.source === props.binaryPath ? draft.value : props.binaryPath;
  return (
    <div className="tw-flex tw-flex-col tw-gap-3 tw-p-4">
      <p className="tw-my-0">Use your {props.displayName} account through its local CLI.</p>
      <label className="tw-flex tw-flex-col tw-gap-1">
        CLI path
        <Input
          aria-label="CLI path"
          value={path}
          onChange={(event) => setDraft({ source: props.binaryPath, value: event.target.value })}
          disabled={props.busy}
        />
      </label>
      <div className="tw-flex tw-flex-wrap tw-gap-2">
        <Button disabled={props.busy} onClick={props.onInstall}>
          Install / update
        </Button>
        <Button
          disabled={props.busy || !path.trim()}
          onClick={() => {
            void props.onSavePath(path.trim());
          }}
        >
          Save path
        </Button>
        <Button disabled={props.busy} onClick={props.onCheck}>
          Re-check
        </Button>
        <Button disabled={props.busy || !props.binaryPath} onClick={props.onSignIn}>
          Sign in
        </Button>
      </div>
      {props.onTerminalSignIn && (
        <Button disabled={props.busy || !props.binaryPath} onClick={props.onTerminalSignIn}>
          Sign in in terminal
        </Button>
      )}
      {props.binaryPath && (
        <p className="tw-my-0 tw-break-all tw-text-muted">Configured: {props.binaryPath}</p>
      )}
      {props.automaticTools && (
        <div role="alert" className="tw-flex tw-flex-col tw-gap-2">
          <p className="tw-my-0">
            Antigravity automatically executes tools. Its file and command access is controlled by
            the CLI; Copilot cannot ask before each tool.
          </p>
          <Button disabled={props.busy} onClick={props.onConsent}>
            {props.consent ? "Disable automatic tools" : "Enable automatic tools for this vault"}
          </Button>
        </div>
      )}
      {props.busy && (
        <p role="status" className="tw-my-0">
          Working…
        </p>
      )}
      {props.output && (
        <pre role="status" className="tw-whitespace-pre-wrap tw-break-words">
          {props.output}
        </pre>
      )}
    </div>
  );
};
