import { AGENT_AUTO_COMPACT_TOKENS } from "@/constants";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { AgentAutoCompactSettings } from "./AgentAutoCompactSettings";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/180";

describe("AgentAutoCompactSettings", () => {
  beforeAll(() => {
    window.ResizeObserver = jest.fn(() => ({
      observe: jest.fn(),
      unobserve: jest.fn(),
      disconnect: jest.fn(),
    }));
  });

  describe("AgentAutoCompactSettings()", () => {
    it(`${ISSUE} shows only the switch, off, while every agent keeps its own compaction point`, () => {
      render(<AgentAutoCompactSettings tokens={undefined} onChange={() => undefined} />);

      expect(screen.getByText("Custom auto-compact threshold")).not.toBeNull();
      expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
      expect(screen.queryByRole("slider")).toBeNull();
    });

    it(`${ISSUE} shows the chosen threshold on a slider spanning the supported range`, () => {
      render(<AgentAutoCompactSettings tokens={250_000} onChange={() => undefined} />);

      expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
      const slider = screen.getByRole("slider");
      expect(slider.getAttribute("aria-valuenow")).toBe("250000");
      expect(slider.getAttribute("aria-valuemin")).toBe(String(AGENT_AUTO_COMPACT_TOKENS.min));
      expect(slider.getAttribute("aria-valuemax")).toBe(String(AGENT_AUTO_COMPACT_TOKENS.max));
      expect(screen.getByText("250k")).not.toBeNull();
    });

    it(`${ISSUE} starts a custom threshold at the initial value when switched on`, () => {
      const onChange = jest.fn();
      render(<AgentAutoCompactSettings tokens={undefined} onChange={onChange} />);

      fireEvent.click(screen.getByRole("switch"));

      expect(onChange).toHaveBeenCalledWith(AGENT_AUTO_COMPACT_TOKENS.initial);
    });

    it(`${ISSUE} returns to the backend default when switched off`, () => {
      const onChange = jest.fn();
      render(<AgentAutoCompactSettings tokens={250_000} onChange={onChange} />);

      fireEvent.click(screen.getByRole("switch"));

      expect(onChange).toHaveBeenCalledWith(undefined);
    });

    it(`${ISSUE} reports a threshold chosen on the slider`, () => {
      const onChange = jest.fn();
      render(<AgentAutoCompactSettings tokens={250_000} onChange={onChange} />);

      const slider = screen.getByRole("slider");
      slider.focus();
      fireEvent.keyDown(slider, { key: "ArrowRight" });

      expect(onChange).toHaveBeenCalledWith(260_000);
    });
  });
});
