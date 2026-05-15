/**
 * Minimal async mutex: serializes async callbacks via Promise chaining.
 * Mirrors the `Mutex.runExclusive` API from the `async-mutex` package.
 */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();
  private pending = 0;

  async runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    this.pending++;
    const decrement = () => {
      this.pending--;
    };
    const run: Promise<T> = this.tail.then(fn, fn);
    // Reason: chain `tail` off the same promise so the pending counter and
    // tail update share one handler — avoids the unhandled-rejection that
    // a separate `.finally(...)` produces when `run` rejects.
    this.tail = run.then(decrement, decrement);
    return run;
  }

  isLocked(): boolean {
    return this.pending > 0;
  }
}
