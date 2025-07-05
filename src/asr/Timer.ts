export class Timer {
  private elapsedTime: number = 0;
  private intervalId: number | null = null;
  private onUpdate: (() => void) | null = null;

  setOnUpdate(callback: () => void): void {
    this.onUpdate = callback;
  }

  start(): void {
    this.intervalId = window.setInterval(() => {
      this.elapsedTime += 1000;
      if (this.onUpdate) {
        this.onUpdate();
      }
    }, 1000);
  }

  pause(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      if (this.onUpdate) {
        this.onUpdate();
      }
    } else {
      this.intervalId = window.setInterval(() => {
        this.elapsedTime += 1000;
        if (this.onUpdate) {
          this.onUpdate();
        }
      }, 1000);
    }
  }

  reset(): void {
    this.elapsedTime = 0;
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.onUpdate) {
      this.onUpdate();
    }
  }

  getFormattedTime(): string {
    const seconds = Math.floor(this.elapsedTime / 1000) % 60;
    const minutes = Math.floor(this.elapsedTime / 1000 / 60) % 60;
    const hours = Math.floor(this.elapsedTime / 1000 / 60 / 60);

    const pad = (n: number) => (n < 10 ? "0" + n : n);

    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
}
