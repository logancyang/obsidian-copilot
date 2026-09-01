export class RateLimiter {
  private lastRequestTime = 0;
  private requestsPerMin: number;

  constructor(requestsPerMin: number) {
    this.requestsPerMin = requestsPerMin;
  }

  async wait(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    const timeToWait = Math.max(0, 60000 / this.requestsPerMin - timeSinceLastRequest);

    if (timeToWait > 0) {
      await new Promise((resolve) => window.setTimeout(resolve, timeToWait));
    }

    this.lastRequestTime = Date.now();
  }
}
