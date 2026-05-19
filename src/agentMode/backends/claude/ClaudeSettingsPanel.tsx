import { BinaryPathSetting } from "@/components/agent/BinaryPathSetting";
import { Button } from "@/components/ui/button";
import { SettingItem } from "@/components/ui/setting-item";
import type CopilotPlugin from "@/main";
import { setSettings, useSettingsValue } from "@/settings/model";
import { validateExecutableFile } from "@/utils/detectBinary";
import type { App } from "obsidian";
import { Notice } from "obsidian";
import React from "react";
import { CLAUDE_INSTALL_COMMAND, resolveClaudeCliPath, updateClaudeFields } from "./descriptor";

interface Props {
  plugin: CopilotPlugin;
  app: App;
}

interface AuthEnvSummary {
  bedrock: boolean;
  vertex: boolean;
  apiKey: boolean;
}

/**
 * Read Claude SDK auth-related env vars once. The SDK resolves credentials
 * through the spawned `claude` CLI, so any of these may be unset and the
 * agent still works (the CLI's saved login covers it).
 */
function readAuthEnv(): AuthEnvSummary {
  return {
    apiKey: Boolean(process.env.ANTHROPIC_API_KEY),
    bedrock: Boolean(process.env.CLAUDE_CODE_USE_BEDROCK),
    vertex: Boolean(process.env.CLAUDE_CODE_USE_VERTEX),
  };
}

function renderAuthDescription(env: AuthEnvSummary): React.ReactNode {
  const parts: string[] = [];
  if (env.apiKey) parts.push("Anthropic API key set");
  if (env.bedrock) parts.push("Bedrock configured");
  if (env.vertex) parts.push("Vertex configured");
  if (parts.length === 0) {
    return (
      <span className="tw-text-muted">
        No auth env vars set — credentials inherit from the <code>claude</code> CLI login state.
      </span>
    );
  }
  return <div>{parts.join(" · ")}</div>;
}

/**
 * Settings panel for the Claude (Agent SDK) backend. Shows the resolved
 * `claude` CLI status, lets users force a re-detect, override the path, and
 * inspects auth-relevant env vars. There is no managed install for this
 * backend — the user must install the `claude` CLI themselves.
 */
export const ClaudeSettingsPanel: React.FC<Props> = () => {
  const settings = useSettingsValue();
  const [, force] = React.useReducer((x: number) => x + 1, 0);

  const overridePath = settings.agentMode?.claudeCli?.path ?? "";
  // Each render re-walks fs.existsSync via the resolver — pressing
  // "Re-detect" simply forces a new render via `force`.
  const resolvedPath = resolveClaudeCliPath(settings);
  const isCustom = Boolean(overridePath);

  // Env doesn't change without an Obsidian restart; read once on mount.
  const authEnv = React.useMemo(readAuthEnv, []);

  const statusDescription = resolvedPath ? (
    <>
      <div>
        Ready — <code>claude</code>
        {isCustom && <span className="tw-text-muted"> (custom)</span>}
      </div>
      <div className="tw-break-all tw-font-mono tw-text-xs">{resolvedPath}</div>
    </>
  ) : (
    <span className="tw-text-warning">
      Setup required — Claude CLI not found. Install with <code>{CLAUDE_INSTALL_COMMAND}</code>.
    </span>
  );

  const onSaveCustomPath = React.useCallback(async (path: string): Promise<string | null> => {
    const err = await validateExecutableFile(path);
    if (err) return err;
    setSettings((cur) => ({
      agentMode: { ...cur.agentMode, claudeCli: { path } },
    }));
    new Notice("Claude CLI path saved.");
    return null;
  }, []);

  const clearCustomPath = (): void => {
    setSettings((cur) => ({
      agentMode: { ...cur.agentMode, claudeCli: undefined },
    }));
    new Notice("Claude CLI override cleared. Auto-detection will be used.");
  };

  return (
    <>
      <SettingItem type="custom" title="Claude CLI" description={statusDescription}>
        <div className="tw-flex tw-flex-wrap tw-justify-end tw-gap-2">
          <Button variant="secondary" onClick={force}>
            Re-detect
          </Button>
          {isCustom && (
            <Button variant="destructive" onClick={clearCustomPath}>
              Clear path
            </Button>
          )}
        </div>
      </SettingItem>

      <SettingItem
        type="custom"
        title="Use custom Claude CLI path"
        description="Skip auto-detection and point Agent Mode at a `claude` binary you already have on disk. Useful for non-standard prefixes (Volta, asdf, NVM, etc.)."
      >
        <BinaryPathSetting
          binaryName="claude"
          placeholder="/absolute/path/to/claude"
          initialPath={overridePath}
          notFoundHint={`claude not found on PATH. Install with \`${CLAUDE_INSTALL_COMMAND}\` and try again.`}
          onSave={onSaveCustomPath}
          persistOnAutoDetect
        />
      </SettingItem>

      <SettingItem
        type="custom"
        title="Authentication"
        description={renderAuthDescription(authEnv)}
      >
        <span />
      </SettingItem>

      <SettingItem
        type="switch"
        title="Show extended thinking"
        description="Stream the model's reasoning blocks during a turn. Increases token usage."
        checked={Boolean(settings.agentMode?.backends?.claude?.enableThinking)}
        onCheckedChange={(checked) => updateClaudeFields({ enableThinking: checked })}
      />
    </>
  );
};
