// Single-process task ownership, matching the local sql.js server model.
// cancel() acknowledges only after the worker has stopped and saved its state.
export class CancellableWork {
  private active = new Map<string, { controller: AbortController; done: Promise<void> }>();

  start(id: string, work: (signal: AbortSignal) => Promise<void>): Promise<void> {
    if (this.active.has(id)) throw new Error("This run is already active.");
    const controller = new AbortController();
    const done = Promise.resolve().then(() => work(controller.signal)).finally(() => {
      this.active.delete(id);
    });
    this.active.set(id, { controller, done });
    return done;
  }

  async cancel(id: string): Promise<boolean> {
    const task = this.active.get(id);
    if (!task) return false;
    task.controller.abort();
    await task.done;
    return true;
  }
}
