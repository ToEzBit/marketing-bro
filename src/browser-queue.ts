/**
 * The Browser queue (ADR 0006). One holder at a time; everyone else waits
 * FIFO and proceeds the moment the holder lets go — no polling, no
 * fixed-delay retries. A waiter can leave early (abort signal or
 * cancelWaiting) or expire at a deadline (a Schedule waits at most until its
 * own next round), and neither wedges the queue.
 */

export type AcquireOutcome = "acquired" | "cancelled" | "deadline";

export type AcquireOptions = {
  /** Aborting while waiting resolves the acquire with "cancelled". */
  signal?: AbortSignal;
  /** Epoch ms. Still waiting when it passes → the acquire resolves "deadline". */
  deadlineAt?: number;
  /** Called when the requester starts waiting and whenever it moves up. */
  onWait?: (position: number, holder: string) => void;
};

type Waiter = {
  requester: string;
  options: AcquireOptions;
  resolve: (outcome: AcquireOutcome) => void;
  /** Last position reported through onWait, so a waiter only hears changes. */
  notifiedPosition?: number;
  /** Undoes this waiter's abort listener and deadline timer. */
  cleanup: () => void;
};

export class BrowserQueue {
  private current: string | undefined;
  private readonly waiters: Waiter[] = [];

  /** Who holds the browser right now, if anyone. */
  get holder(): string | undefined {
    return this.current;
  }

  /** Requesters still in line, in the order they will be served. For `/status`. */
  get waiting(): string[] {
    return this.waiters.map((waiter) => waiter.requester);
  }

  /**
   * Resolves "acquired" once the requester holds the browser — immediately if
   * it is free (or already held by this requester), otherwise after everyone
   * ahead in the line is done.
   */
  acquire(requester: string, options: AcquireOptions = {}): Promise<AcquireOutcome> {
    if (this.current === undefined || this.current === requester) {
      this.current = requester;
      return Promise.resolve("acquired");
    }
    if (options.deadlineAt !== undefined && options.deadlineAt <= Date.now()) {
      return Promise.resolve("deadline");
    }
    return new Promise((resolve) => {
      const waiter: Waiter = { requester, options, resolve, cleanup: () => undefined };

      const leave = (outcome: AcquireOutcome) => {
        const index = this.waiters.indexOf(waiter);
        if (index === -1) return;
        this.waiters.splice(index, 1);
        waiter.cleanup();
        waiter.resolve(outcome);
        this.notifyPositions();
      };

      const onAbort = () => leave("cancelled");
      options.signal?.addEventListener("abort", onAbort, { once: true });
      // Chained timer: setTimeout clamps delays over 2^31-1 ms (~25 days) down
      // to ~1 ms, so a far deadline must re-arm instead of firing early.
      let timer: NodeJS.Timeout | undefined;
      const armDeadline = (deadlineAt: number) => {
        const remaining = deadlineAt - Date.now();
        if (remaining <= 0) {
          leave("deadline");
          return;
        }
        timer = setTimeout(() => armDeadline(deadlineAt), Math.min(remaining, 2 ** 31 - 1));
      };
      if (options.deadlineAt !== undefined) armDeadline(options.deadlineAt);
      waiter.cleanup = () => {
        options.signal?.removeEventListener("abort", onAbort);
        if (timer) clearTimeout(timer);
      };

      this.waiters.push(waiter);
      this.notifyPositions();
    });
  }

  /** Lets go of the browser; the head of the line takes it immediately. */
  release(requester: string): void {
    if (this.current !== requester) return;
    const next = this.waiters.shift();
    if (next) {
      next.cleanup();
      this.current = next.requester;
      next.resolve("acquired");
      this.notifyPositions();
    } else {
      this.current = undefined;
    }
  }

  /** Pulls every waiting entry of this requester out of the line ("cancelled"). */
  cancelWaiting(requester: string): void {
    for (const waiter of this.waiters.filter((entry) => entry.requester === requester)) {
      const index = this.waiters.indexOf(waiter);
      this.waiters.splice(index, 1);
      waiter.cleanup();
      waiter.resolve("cancelled");
    }
    this.notifyPositions();
  }

  private notifyPositions(): void {
    const holder = this.current;
    if (holder === undefined) return;
    this.waiters.forEach((waiter, index) => {
      const position = index + 1;
      if (waiter.notifiedPosition === position) return;
      waiter.notifiedPosition = position;
      waiter.options.onWait?.(position, holder);
    });
  }
}
