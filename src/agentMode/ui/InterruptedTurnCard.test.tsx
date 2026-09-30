import { InterruptedTurnCard } from "@/agentMode/ui/InterruptedTurnCard";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

describe("InterruptedTurnCard", () => {
  it("names the interrupted state and says nothing was sent again", () => {
    render(<InterruptedTurnCard onResume={jest.fn()} onRetry={jest.fn()} />);

    const card = screen.getByRole("status");
    expect(card.textContent).toContain("Interrupted");
    expect(card.textContent).toContain("Nothing has been sent again");
  });

  it("calls onResume only when Resume is pressed", () => {
    const onResume = jest.fn();
    const onRetry = jest.fn();
    render(<InterruptedTurnCard onResume={onResume} onRetry={onRetry} />);

    fireEvent.click(screen.getByRole("button", { name: "Resume" }));

    expect(onResume).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("calls onRetry only when Retry is pressed", () => {
    const onResume = jest.fn();
    const onRetry = jest.fn();
    render(<InterruptedTurnCard onResume={onResume} onRetry={onRetry} />);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onResume).not.toHaveBeenCalled();
  });

  it("offers only Retry when the turn cannot be resumed", () => {
    render(<InterruptedTurnCard onRetry={jest.fn()} />);

    expect(screen.queryByRole("button", { name: "Resume" })).toBeNull();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});
