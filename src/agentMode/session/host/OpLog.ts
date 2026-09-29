export interface OpLogOptions<Op> {
  epoch: string;
  maxOps: number;
  maxBytes: number;
  sizeOf: (op: Op) => number;
}

const COMPACT_THRESHOLD = 512;

export class OpLog<Op> {
  private entries: { op: Op; bytes: number }[] = [];
  private start = 0;
  private bytes = 0;
  private evicted = 0;

  constructor(private readonly options: OpLogOptions<Op>) {}

  getEpoch(): string {
    return this.options.epoch;
  }

  getHead(): number {
    return this.evicted + this.entries.length - this.start;
  }

  append(op: Op): number {
    const bytes = this.options.sizeOf(op);
    this.entries.push({ op, bytes });
    this.bytes += bytes;
    while (
      this.entries.length > this.start &&
      (this.entries.length - this.start > this.options.maxOps || this.bytes > this.options.maxBytes)
    ) {
      this.bytes -= this.entries[this.start].bytes;
      this.start += 1;
      this.evicted += 1;
    }
    if (this.start >= COMPACT_THRESHOLD && this.start * 2 >= this.entries.length) {
      this.entries = this.entries.slice(this.start);
      this.start = 0;
    }
    return this.getHead();
  }

  covers(fromSeq: number): boolean {
    return Number.isInteger(fromSeq) && fromSeq >= this.evicted && fromSeq <= this.getHead();
  }

  since(fromSeq: number): Op[] {
    const first = this.start + Math.max(0, fromSeq - this.evicted);
    return this.entries.slice(first).map((entry) => entry.op);
  }
}
