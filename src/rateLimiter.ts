export class RateLimiter {
  private queue: (() => void)[] = [];
  private lastRequestTime = 0;
  private processing = false;
  private requestsPerSecond: number;

  constructor(requestsPerSecond: number) {
    this.requestsPerSecond = requestsPerSecond;
  }

  setRequestsPerSecond(requestsPerSecond: number) {
    this.requestsPerSecond = requestsPerSecond;
  }

  getRequestsPerSecond(): number {
    return this.requestsPerSecond;
  }

  async wait(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
      this.process();
    });
  }

  private async process(): Promise<void> {
    // Use an atomic compare-and-swap operation
    if (this.processing) return;
    this.processing = true;

    try {
      while (this.queue.length > 0) {
        const now = Date.now();
        // Calculate the time to wait until the next request can be made
        const timeToWait = Math.max(0, this.lastRequestTime + 1000 / this.requestsPerSecond - now);

        if (timeToWait > 0) {
          await new Promise((resolve) => setTimeout(resolve, timeToWait));
        }

        const resolve = this.queue.shift();
        if (resolve) {
          this.lastRequestTime = Date.now();
          resolve();
        }
      }
    } finally {
      this.processing = false;
    }
  }
}
