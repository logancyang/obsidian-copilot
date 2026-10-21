export class AsyncPushQueue<T> implements AsyncIterable<T> {
  private readonly items: T[] = [];
  private wake: (() => void) | null = null;
  private ended = false;

  push(item: T): void {
    if (this.ended) return;
    this.items.push(item);
    this.notify();
  }

  end(): void {
    this.ended = true;
    this.notify();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    for (;;) {
      if (this.items.length > 0) {
        yield this.items.shift() as T;
        continue;
      }
      if (this.ended) return;
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
    }
  }

  private notify(): void {
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }
}
