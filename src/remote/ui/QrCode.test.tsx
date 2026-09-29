import { render, screen } from "@testing-library/react";
import jsQR from "jsqr";
import React from "react";
import { QrCode } from "@/remote/ui/QrCode";

const SCALE = 4;

function decodeRendered(container: HTMLElement): string | null {
  const svg = container.querySelector("svg");
  const size = Number((svg?.getAttribute("viewBox") ?? "").split(" ")[2]);
  const width = size * SCALE;
  const pixels = new Uint8ClampedArray(width * width * 4).fill(255);
  const path = container.querySelector("path")?.getAttribute("d") ?? "";
  for (const [, x, y] of path.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) {
    for (let dy = 0; dy < SCALE; dy++) {
      for (let dx = 0; dx < SCALE; dx++) {
        const offset = ((Number(y) * SCALE + dy) * width + Number(x) * SCALE + dx) * 4;
        pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 0;
      }
    }
  }
  return jsQR(pixels, width, width)?.data ?? null;
}

describe("QrCode", () => {
  describe("QrCode()", () => {
    it("draws a code that a scanner decodes back to the exact pairing link", () => {
      const link =
        "obsidian://copilot-pair?host=100.118.223.39&port=52341&vault=Work+notes&vaultId=3f9a1c2e&secret=k3Jd8sLq0Zt5vXw9bN2mRa7Y";
      const { container } = render(<QrCode value={link} label="Pairing QR code" />);

      expect(decodeRendered(container)).toBe(link);
    });

    it("renders an accessible image labelled for the pairing code", () => {
      render(<QrCode value="obsidian://copilot-pair?host=100.64.0.1" label="Pairing QR code" />);

      expect(screen.getByRole("img", { name: "Pairing QR code" })).toBeTruthy();
    });

    it("draws dark modules on a white ground with a quiet zone, whatever the theme", () => {
      const { container } = render(<QrCode value="hello" label="code" />);

      const svg = container.querySelector("svg");
      const [, , width, height] = (svg?.getAttribute("viewBox") ?? "").split(" ").map(Number);
      expect(width).toBe(height);
      expect(width).toBeGreaterThan(8);
      expect(container.querySelector("rect")?.getAttribute("fill")).toBe("#ffffff");
      expect(container.querySelector("path")?.getAttribute("fill")).toBe("#000000");
      expect((container.querySelector("path")?.getAttribute("d") ?? "").length).toBeGreaterThan(50);
    });

    it("draws a different code for a different value", () => {
      const first = render(<QrCode value="one" label="code" />).container.querySelector("path");
      const second = render(<QrCode value="two" label="code" />).container.querySelector("path");

      expect(first?.getAttribute("d")).not.toBe(second?.getAttribute("d"));
    });

    it("keeps every module inside the quiet-zone-padded viewBox", () => {
      const { container } = render(
        <QrCode value="obsidian://copilot-pair?host=100.64.0.1" label="c" />
      );

      const size = Number(
        (container.querySelector("svg")?.getAttribute("viewBox") ?? "").split(" ")[2]
      );
      const coordinates = [
        ...(container.querySelector("path")?.getAttribute("d") ?? "").matchAll(
          /M(\d+) (\d+)h1v1h-1z/g
        ),
      ];
      expect(coordinates.length).toBeGreaterThan(0);
      for (const [, x, y] of coordinates) {
        expect(Number(x)).toBeGreaterThanOrEqual(4);
        expect(Number(y)).toBeGreaterThanOrEqual(4);
        expect(Number(x)).toBeLessThan(size - 4);
        expect(Number(y)).toBeLessThan(size - 4);
      }
    });
  });
});
