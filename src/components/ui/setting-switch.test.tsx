import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { SettingSwitch } from "./setting-switch";

describe("SettingSwitch", () => {
  it("renders an element with role=switch", () => {
    render(<SettingSwitch />);
    expect(screen.getByRole("switch")).not.toBeNull();
  });

  it("reflects the checked state via aria-checked and data-state", () => {
    const { rerender } = render(<SettingSwitch checked />);
    const on = screen.getByRole("switch");
    expect(on.getAttribute("aria-checked")).toBe("true");
    expect(on.getAttribute("data-state")).toBe("checked");

    rerender(<SettingSwitch checked={false} />);
    const off = screen.getByRole("switch");
    expect(off.getAttribute("aria-checked")).toBe("false");
    expect(off.getAttribute("data-state")).toBe("unchecked");
  });

  it("calls onCheckedChange with the negation of checked when clicked", () => {
    const onCheckedChange = jest.fn();

    const { rerender } = render(
      <SettingSwitch checked={false} onCheckedChange={onCheckedChange} />
    );
    fireEvent.click(screen.getByRole("switch"));
    expect(onCheckedChange).toHaveBeenLastCalledWith(true);

    rerender(<SettingSwitch checked onCheckedChange={onCheckedChange} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onCheckedChange).toHaveBeenLastCalledWith(false);
  });

  it("toggles on Enter and on Space", () => {
    const onCheckedChange = jest.fn();
    render(<SettingSwitch checked={false} onCheckedChange={onCheckedChange} />);
    const sw = screen.getByRole("switch");

    fireEvent.keyDown(sw, { key: "Enter" });
    expect(onCheckedChange).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(sw, { key: " " });
    expect(onCheckedChange).toHaveBeenCalledTimes(2);
    expect(onCheckedChange).toHaveBeenNthCalledWith(1, true);
    expect(onCheckedChange).toHaveBeenNthCalledWith(2, true);

    fireEvent.keyDown(sw, { key: "a" });
    expect(onCheckedChange).toHaveBeenCalledTimes(2);
  });

  it("does not toggle and is not focusable when disabled", () => {
    const onCheckedChange = jest.fn();
    render(<SettingSwitch checked={false} disabled onCheckedChange={onCheckedChange} />);
    const sw = screen.getByRole("switch");

    fireEvent.click(sw);
    fireEvent.keyDown(sw, { key: "Enter" });
    fireEvent.keyDown(sw, { key: " " });
    expect(onCheckedChange).not.toHaveBeenCalled();

    expect(sw.getAttribute("aria-disabled")).toBe("true");
    expect(sw.tabIndex).toBe(-1);
  });
});
