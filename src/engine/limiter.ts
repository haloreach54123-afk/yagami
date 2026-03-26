type Waiter = {
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
};

function abortError(message: string): Error {
  return new Error(message);
}

export class ConcurrencyLimiter {
  readonly maxConcurrency: number;

  private activeCount = 0;
  private queue: Waiter[] = [];

  constructor(maxConcurrency: number) {
    this.maxConcurrency = Math.max(1, Math.floor(maxConcurrency || 1));
  }

  get active(): number {
    return this.activeCount;
  }

  get pending(): number {
    return this.queue.length;
  }

  async acquire(signal?: AbortSignal, abortMessage = "operation aborted"): Promise<() => void> {
    if (signal?.aborted) {
      throw abortError(abortMessage);
    }

    if (this.activeCount < this.maxConcurrency) {
      this.activeCount += 1;
      return () => this.release();
    }

    return await new Promise<() => void>((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        signal,
      };

      const onAbort = () => {
        this.removeWaiter(waiter);
        reject(abortError(abortMessage));
      };

      waiter.onAbort = onAbort;
      if (signal) signal.addEventListener("abort", onAbort, { once: true });

      this.queue.push(waiter);
      this.drain();
    });
  }

  private release(): void {
    this.activeCount = Math.max(0, this.activeCount - 1);
    this.drain();
  }

  private removeWaiter(target: Waiter): void {
    const idx = this.queue.indexOf(target);
    if (idx >= 0) {
      this.queue.splice(idx, 1);
    }

    if (target.signal && target.onAbort) {
      target.signal.removeEventListener("abort", target.onAbort);
    }
  }

  private drain(): void {
    while (this.activeCount < this.maxConcurrency && this.queue.length > 0) {
      const waiter = this.queue.shift();
      if (!waiter) break;

      if (waiter.signal?.aborted) {
        if (waiter.signal && waiter.onAbort) {
          waiter.signal.removeEventListener("abort", waiter.onAbort);
        }
        waiter.reject(abortError("operation aborted"));
        continue;
      }

      if (waiter.signal && waiter.onAbort) {
        waiter.signal.removeEventListener("abort", waiter.onAbort);
      }

      this.activeCount += 1;
      waiter.resolve(() => this.release());
    }
  }
}
