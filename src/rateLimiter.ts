export class RateLimiter {
  private lastRequestTime = 0;
  private requestsPerMin: number;

  constructor(requestsPerMin: number) {
    this.requestsPerMin = requestsPerMin;
  }

  setRequestsPerMin(requestsPerMin: number) {
    this.requestsPerMin = requestsPerMin;
  }

  getRequestsPerMin(): number {
    return this.requestsPerMin;
  }

  async wait(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    const timeToWait = Math.max(0, 60000 / this.requestsPerMin - timeSinceLastRequest);

    if (timeToWait > 0) {
      await new Promise((resolve) => setTimeout(resolve, timeToWait));
    }

    this.lastRequestTime = Date.now();
  }
}
