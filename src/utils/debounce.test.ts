import { debounce } from "./debounce";

jest.useFakeTimers();

describe("debounce", () => {
  it("invokes once after the wait period with the latest args (trailing default)", () => {
    const fn = jest.fn();
    const d = debounce(fn, 100);

    d("a");
    d("b");
    d("c");

    expect(fn).not.toHaveBeenCalled();
    jest.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("c");
  });

  it("supports leading-only mode", () => {
    const fn = jest.fn();
    const d = debounce(fn, 100, { leading: true, trailing: false });

    d("a");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("a");

    d("b");
    d("c");
    jest.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("fires both edges when leading and trailing are true and there are multiple calls", () => {
    const fn = jest.fn();
    const d = debounce(fn, 100, { leading: true, trailing: true });

    d("a");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenLastCalledWith("a");

    d("b");
    jest.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith("b");
  });

  it("does not fire trailing if leading already covered the single call", () => {
    const fn = jest.fn();
    const d = debounce(fn, 100, { leading: true, trailing: true });

    d("only");
    expect(fn).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("cancel prevents pending trailing invocation", () => {
    const fn = jest.fn();
    const d = debounce(fn, 100);

    d("a");
    d.cancel();
    jest.advanceTimersByTime(100);
    expect(fn).not.toHaveBeenCalled();
  });

  it("flush invokes the pending call synchronously", () => {
    const fn = jest.fn();
    const d = debounce(fn, 100);

    d("a");
    d.flush();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("a");
    jest.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("flush is a no-op when nothing is pending", () => {
    const fn = jest.fn();
    const d = debounce(fn, 100);
    expect(d.flush()).toBeUndefined();
    expect(fn).not.toHaveBeenCalled();
  });
});
