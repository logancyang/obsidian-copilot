import { AcpBackendProcess } from "@/agentMode/acp/AcpBackendProcess";
import type { AcpBackend, AcpSpawnDescriptor } from "@/agentMode/acp/types";
import { augmentPathForNodeShebang } from "@/agentMode/acp/nodeShebangPath";
import type { BackendStartArgs } from "@/agentMode/session/descriptor";
import type { BackendProcess } from "@/agentMode/session/types";

export function buildSimpleSpawnDescriptor(
  binaryPath: string | undefined,
  configErrorMessage: string,
  envOverrides?: Record<string, string>,
  managedEnv?: Readonly<Record<string, string>>
): AcpSpawnDescriptor {
  if (!binaryPath) throw new Error(configErrorMessage);
  return {
    command: binaryPath,
    args: [],
    env: {
      ...process.env,
      PATH: augmentPathForNodeShebang(binaryPath, process.env.PATH),
      ...(managedEnv ?? {}),
      ...(envOverrides ?? {}),
    },
  };
}

export function simpleBinaryBackendProcess(
  args: Pick<BackendStartArgs, "app" | "clientVersion" | "descriptor">,
  backend: AcpBackend
): BackendProcess {
  return new AcpBackendProcess(args.app, backend, args.clientVersion, args.descriptor);
}
