import { SearchBar } from "@/components/ui/SearchBar";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

function ControlledSearchBar() {
  const [value, setValue] = React.useState("tides");
  return <SearchBar value={value} onChange={setValue} placeholder="Search notes..." />;
}

describe("SearchBar", () => {
  describe("SearchBar()", () => {
    it("shows a clear button only while there is a query", () => {
      render(<ControlledSearchBar />);
      expect(screen.getByRole("button", { name: "Clear search" })).toBeTruthy();

      fireEvent.change(screen.getByPlaceholderText("Search notes..."), { target: { value: "" } });

      expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
    });

    it("empties the query and keeps typing focus in the field when the clear button is used", () => {
      render(<ControlledSearchBar />);

      fireEvent.click(screen.getByRole("button", { name: "Clear search" }));

      const input = screen.getByPlaceholderText<HTMLInputElement>("Search notes...");
      expect(input.value).toBe("");
      expect(document.activeElement).toBe(input);
    });
  });
});
