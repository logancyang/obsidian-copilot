/**
 * Row classes shared by the composer's two pickers — the agent roster and the
 * model list — so a row means the same thing visually in both.
 */

/** One selectable row, shared so both lists start at the same leading edge. */
export const ROW_CLASS =
  "tw-flex tw-cursor-pointer tw-items-center tw-justify-between tw-gap-3 tw-px-3 tw-py-1.5 tw-text-sm";

/*
 * Selection is color, not a marker column (`designdocs/CUSTOM_AGENTS.md` §3).
 * The row holding the current choice takes the accent tint an active fan-out
 * tab and the effort footer's active step already wear, and weights its name.
 * The name keeps the normal text color: a theme is free to pick an accent
 * bright enough that accent-on-tint falls under 4.5:1, and Atom's light theme
 * does, at 2.7:1.
 *
 * A row gets exactly one background — two background utilities would leave the
 * winner to stylesheet order — and the tint wins over the keyboard highlight,
 * because both lists open with the keyboard already on the current row and
 * that row has to read as the current one.
 */
export const SELECTED_ROW_BG = "tw-bg-interactive-accent-hsl/10";
export const SELECTED_ROW_NAME = "tw-font-medium";
export const HIGHLIGHT_ROW_BG = "tw-bg-interactive-hover";
