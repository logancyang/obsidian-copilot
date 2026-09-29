import { requireNodeModule } from "@/utils/desktopRuntime";

export function sha256Hex(value: string): string {
  const crypto = requireNodeModule<typeof import("node:crypto")>("crypto");
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function digestsEqual(leftHex: string, rightHex: string): boolean {
  const crypto = requireNodeModule<typeof import("node:crypto")>("crypto");
  const left = new Uint8Array(Buffer.from(leftHex, "hex"));
  const right = new Uint8Array(Buffer.from(rightHex, "hex"));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
