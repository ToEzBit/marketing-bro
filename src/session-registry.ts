/**
 * The register of live Agent Sessions, one per Task thread (1 Task = 1 Thread
 * = 1 Session). Every path that touches a session — `/task`, a message in the
 * thread, `/stop`, `/status`, ThreadDelete, the idle sweeper, shutdown — goes
 * through here, so no session can exist outside it.
 *
 * The guarantee it exists for: a thread's slot is reserved *synchronously*,
 * before the creation reaches its first await. Whoever asks while a creation
 * (or a `/task` hand-over) is in flight is handed that same session once it is
 * ready. There is no window in which the slot looks empty and a second session
 * gets built for the same thread — which used to leave the first one orphaned:
 * still holding a subprocess, but no longer reachable by `/stop`, the sweeper
 * or shutdown.
 */

/** Builds the session for a thread. Async: creating one may post to Discord. */
export type SessionFactory<T> = () => T | Promise<T>;

export type RegistryHooks<T> = {
  /**
   * Everything that has to happen when a session leaves the register — closing
   * its subprocess, and whatever else the owner hangs off a session's life.
   * Called once per entry, and never for an entry that is dropped by
   * {@link SessionRegistry.forget}.
   */
  retire: (entry: T, threadId: string) => Promise<void> | void;
};

/**
 * When this thread's slot was taken. Carried over unchanged when the slot goes
 * live, so whoever watches the register sees one arrival, not two: the moment
 * someone asked for a session, not the moment building it happened to finish.
 */
type Reserved = { since: number };

type Slot<T> =
  /** Built and usable. */
  | ({ state: "live"; entry: T } & Reserved)
  /** Reserved: being built (or handed over) right now; `ready` is the result. */
  | ({ state: "pending"; ready: Promise<T> } & Reserved);

export class SessionRegistry<T> {
  private readonly slots = new Map<string, Slot<T>>();

  constructor(private readonly hooks: RegistryHooks<T>) {}

  /** How many sessions are live — one still being built is not one yet. */
  get size(): number {
    let count = 0;
    for (const slot of this.slots.values()) {
      if (slot.state === "live") count += 1;
    }
    return count;
  }

  /** The thread's live session, or undefined while it has none. */
  get(threadId: string): T | undefined {
    const slot = this.slots.get(threadId);
    return slot?.state === "live" ? slot.entry : undefined;
  }

  /** Every live session, for listing them (`/status`). */
  values(): T[] {
    const entries: T[] = [];
    for (const slot of this.slots.values()) {
      if (slot.state === "live") entries.push(slot.entry);
    }
    return entries;
  }

  /**
   * Every slot, the ones still being built included — unlike {@link values},
   * which only knows about sessions that finished building. A read-only view
   * for whoever draws what the bot is doing right now (Office UI): a thread
   * someone just typed in has to show up immediately, before Discord has been
   * touched, or the room lags behind the person watching it.
   */
  entries(): { threadId: string; state: "live" | "pending"; entry?: T; since: number }[] {
    return [...this.slots].map(([threadId, slot]) => ({
      threadId,
      state: slot.state,
      since: slot.since,
      ...(slot.state === "live" ? { entry: slot.entry } : {}),
    }));
  }

  /**
   * The thread's session: the live one, the one someone else is already
   * building, or a new one from `factory`.
   *
   * Deliberately not `async`. The slot is reserved in the same synchronous
   * step as the call, so a caller arriving during someone else's creation can
   * only ever wait for it — never start a second one.
   */
  getOrCreate(threadId: string, factory: SessionFactory<T>): Promise<T> {
    const slot = this.slots.get(threadId);
    if (slot?.state === "live") return Promise.resolve(slot.entry);
    if (slot?.state === "pending") return slot.ready;
    return this.reserve(threadId, undefined, factory);
  }

  /**
   * `/task` in a thread that already has a session: start over. The old
   * session is retired first and the new one takes its place — and because the
   * slot stays reserved for the whole hand-over, a message arriving in the
   * middle of it waits for the new session instead of building a third.
   */
  async replace(threadId: string, factory: SessionFactory<T>): Promise<T> {
    // Two `/task` at once: let the hand-over already in flight finish, then
    // replace what it produced. Re-read after every await — single-threaded
    // resumption means whoever reserves the slot first wins outright.
    let slot = this.slots.get(threadId);
    while (slot?.state === "pending") {
      await slot.ready.catch(() => undefined);
      slot = this.slots.get(threadId);
    }
    return this.reserve(
      threadId,
      slot?.state === "live" ? slot.entry : undefined,
      factory,
    );
  }

  /**
   * Drops a session that died on its own, without retiring it (there is
   * nothing left to close). Identity-checked on purpose: a newer `/task` may
   * already own this thread, and a late death notice from the session it
   * replaced must not unregister it.
   */
  forget(threadId: string, entry: T): void {
    const slot = this.slots.get(threadId);
    if (slot?.state === "live" && slot.entry === entry) this.slots.delete(threadId);
  }

  /** Retires the thread's session — waiting first if one is still being built. */
  async close(threadId: string): Promise<void> {
    for (;;) {
      const slot = this.slots.get(threadId);
      if (!slot) return;
      if (slot.state === "live") {
        this.slots.delete(threadId);
        await this.retire(threadId, slot.entry);
        return;
      }
      // Mid-creation. Wait for it and close what it produced: a session that
      // arrives after we looked would otherwise outlive its thread.
      await slot.ready.catch(() => undefined);
    }
  }

  /** Shutdown: retires everything registered now, sessions mid-creation included. */
  async closeAll(): Promise<void> {
    await Promise.allSettled([...this.slots.keys()].map((threadId) => this.close(threadId)));
  }

  /**
   * Retires the sessions `isIdle` picks out (how idle subprocesses get reaped).
   * A session still being built is never idle, so it is left alone. Returns the
   * threads that were reaped.
   */
  async sweepIdle(isIdle: (entry: T, threadId: string) => boolean): Promise<string[]> {
    const reaped: string[] = [];
    for (const threadId of [...this.slots.keys()]) {
      // Re-read each round: retiring the previous one awaited, and this thread
      // may have gained a new session — or lost its old one — meanwhile.
      const slot = this.slots.get(threadId);
      if (slot?.state !== "live") continue;
      if (!isIdle(slot.entry, threadId)) continue;
      this.slots.delete(threadId);
      reaped.push(threadId);
      await this.retire(threadId, slot.entry);
    }
    return reaped;
  }

  /**
   * Reserves the slot first, then does the slow part: retire the session being
   * replaced (when this is a hand-over), build the new one, install it.
   */
  private reserve(
    threadId: string,
    previous: T | undefined,
    factory: SessionFactory<T>,
  ): Promise<T> {
    // The executor runs synchronously, so `settle` is set before it is used.
    let settle!: { resolve: (entry: T) => void; reject: (error: unknown) => void };
    const ready = new Promise<T>((resolve, reject) => {
      settle = { resolve, reject };
    });
    // Nothing has awaited yet: from here on, this thread has an owner.
    const since = Date.now();
    this.slots.set(threadId, { state: "pending", ready, since });

    void (async () => {
      try {
        if (previous !== undefined) await this.retire(threadId, previous);
        const entry = await factory();
        this.slots.set(threadId, { state: "live", entry, since });
        settle.resolve(entry);
      } catch (error) {
        // Building failed. A slot left reserved would wedge the thread for
        // good, so it goes back to empty and the error reaches the caller.
        const slot = this.slots.get(threadId);
        if (slot?.state === "pending" && slot.ready === ready) this.slots.delete(threadId);
        settle.reject(error);
      }
    })();

    return ready;
  }

  /** A session that refuses to close cleanly must not wedge the register. */
  private async retire(threadId: string, entry: T): Promise<void> {
    try {
      await this.hooks.retire(entry, threadId);
    } catch (error) {
      console.error(`[sessions] closing the session of thread ${threadId} failed:`, error);
    }
  }
}
