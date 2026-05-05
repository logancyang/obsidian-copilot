import React from "react";

// 7-dot sigma (Σ) pattern. animIndex orders the snake trail:
// top-right → top-center → top-left → center → bottom-left → bottom-center → bottom-right.
const SIGMA_DOTS: { row: number; col: number; animIndex: number }[] = [
  { row: 0, col: 0, animIndex: 2 },
  { row: 0, col: 1, animIndex: 1 },
  { row: 0, col: 2, animIndex: 0 },
  { row: 1, col: 1, animIndex: 3 },
  { row: 2, col: 0, animIndex: 4 },
  { row: 2, col: 1, animIndex: 5 },
  { row: 2, col: 2, animIndex: 6 },
];

const DOT_SIZE = 2.5;
const DOT_GAP = 3;
const GRID_SIZE = DOT_SIZE * 3 + DOT_GAP * 2;

export const CopilotSpinner: React.FC = () => {
  return (
    <svg
      width={GRID_SIZE}
      height={GRID_SIZE}
      viewBox={`0 0 ${GRID_SIZE} ${GRID_SIZE}`}
      // eslint-disable-next-line tailwindcss/no-custom-classname
      className="copilot-spinner"
    >
      {SIGMA_DOTS.map((dot, index) => {
        const cx = dot.col * (DOT_SIZE + DOT_GAP) + DOT_SIZE / 2;
        const cy = dot.row * (DOT_SIZE + DOT_GAP) + DOT_SIZE / 2;
        return (
          <circle
            key={index}
            cx={cx}
            cy={cy}
            r={DOT_SIZE / 2}
            // eslint-disable-next-line tailwindcss/no-custom-classname
            className={`copilot-spinner-dot copilot-spinner-dot-${dot.animIndex}`}
          />
        );
      })}
    </svg>
  );
};

export default CopilotSpinner;
