declare module 'sse' {
  class SSE {
    constructor(url: string, options?: any);
    addEventListener(event: string, listener: (e: any) => void): void;
    removeEventListener(event: string, listener: (e: any) => void): void;
    dispatchEvent(event: any): boolean;
    close(): void;
    stream(): void;
  }

  export = SSE;
}
