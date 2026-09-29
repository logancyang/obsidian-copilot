import React, { useMemo } from "react";
import { encode } from "uqr";

export interface QrCodeProps {
  value: string;
  label: string;
}

const QUIET_ZONE_MODULES = 4;

function buildDarkModulesPath(value: string): { path: string; size: number } {
  const { data, size } = encode(value, { ecc: "M", border: QUIET_ZONE_MODULES });
  let path = "";
  data.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) path += `M${x} ${y}h1v1h-1z`;
    })
  );
  return { path, size };
}

// A scanner needs dark modules on a light ground whatever the Obsidian theme is, so the code
// carries its own black and white instead of theme tokens.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/610
export const QrCode: React.FC<QrCodeProps> = ({ value, label }) => {
  const { path, size } = useMemo(() => buildDarkModulesPath(value), [value]);
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className="tw-size-48 tw-shrink-0 tw-rounded-md"
    >
      <rect width={size} height={size} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
};
