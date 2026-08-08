import { frozenOr, sliceMemo, sliceMemoByKey } from "./sliceCache";

describe("sliceMemo", () => {
  it("returns the same value reference when source reference is unchanged", () => {
    const compute = jest.fn((src: { rows: number[] }) => src.rows.map((n) => n * 2));
    const memo = sliceMemo(compute);
    const source = { rows: [1, 2, 3] };

    const a = memo(source);
    const b = memo(source);

    expect(a).toBe(b);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("recomputes when the source reference changes, even if contents are equal", () => {
    const compute = jest.fn((src: { rows: number[] }) => [...src.rows]);
    const memo = sliceMemo(compute);

    const a = memo({ rows: [1, 2, 3] });
    const b = memo({ rows: [1, 2, 3] });

    expect(a).not.toBe(b);
    expect(compute).toHaveBeenCalledTimes(2);
  });
});

describe("sliceMemoByKey", () => {
  it("caches independently per key and reuses on source-reference match", () => {
    const compute = jest.fn((src: Record<string, number>, key: string) => src[key] ?? 0);
    const memo = sliceMemoByKey(compute);
    const source = { a: 1, b: 2 };

    const a1 = memo(source, "a");
    const b1 = memo(source, "b");
    const a2 = memo(source, "a");

    expect(a1).toBe(a2);
    expect(a1).toBe(1);
    expect(b1).toBe(2);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("recomputes a key when source reference changes", () => {
    const compute = jest.fn((src: { rows: number[] }, key: number) => src.rows[key]);
    const memo = sliceMemoByKey(compute);

    const v1 = memo({ rows: [10, 20] }, 0);
    const v2 = memo({ rows: [10, 20] }, 0);

    expect(v1).toBe(10);
    expect(v2).toBe(10);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("invalidates all keys when the source reference flips", () => {
    const compute = jest.fn((src: Record<string, string[]>, key: string) => src[key] ?? []);
    const memo = sliceMemoByKey(compute);

    const src1 = { x: ["a"], y: ["b"] };
    memo(src1, "x");
    memo(src1, "y");
    expect(compute).toHaveBeenCalledTimes(2);

    const src2 = { x: ["a"], y: ["b"] };
    memo(src2, "x");
    memo(src2, "y");
    expect(compute).toHaveBeenCalledTimes(4);
  });
});

describe("frozenOr", () => {
  it("returns the provided empty constant when input is empty", () => {
    const EMPTY: readonly number[] = Object.freeze([]);
    expect(frozenOr([], EMPTY)).toBe(EMPTY);
  });

  it("returns a frozen copy (not the same reference) when input is non-empty", () => {
    const EMPTY: readonly number[] = Object.freeze([]);
    const input = [1, 2, 3];
    const result = frozenOr(input, EMPTY);

    expect(result).not.toBe(input);
    expect(result).toEqual([1, 2, 3]);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("does not mutate or freeze the input array", () => {
    const EMPTY: readonly number[] = Object.freeze([]);
    const input = [1, 2, 3];
    frozenOr(input, EMPTY);

    expect(Object.isFrozen(input)).toBe(false);
    input.push(4);
    expect(input).toEqual([1, 2, 3, 4]);
  });
});
