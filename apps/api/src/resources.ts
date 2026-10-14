import { Global, Injectable, Module } from "@nestjs/common";
// Single API process: serialize every LLM/TTS GPU owner, including other rooms.
@Injectable()
export class ResourceGate {
  private failure: string | undefined;
  block(reason: string) {
    this.failure = reason;
  }
  private tail: Promise<void> = Promise.resolve();
  async acquire(signal: AbortSignal): Promise<() => void> {
    if (this.failure) throw new Error(this.failure);
    signal.throwIfAborted();
    let release!: () => void;
    const next = new Promise<void>((r) => (release = r)),
      previous = this.tail;
    this.tail = previous.then(() => next);
    let abort!: () => void;
    try {
      await Promise.race([
        previous,
        new Promise<never>((_, reject) => {
          abort = () => reject(signal.reason ?? new Error("Cancelled"));
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) abort();
        }),
      ]);
      signal.throwIfAborted();
      if (this.failure) throw new Error(this.failure);
    } catch (e) {
      release();
      throw e;
    } finally {
      signal.removeEventListener("abort", abort);
    }
    let released = false;
    return () => {
      if (!released) {
        released = true;
        release();
      }
    };
  }
}
@Global()
@Module({ providers: [ResourceGate], exports: [ResourceGate] })
export class ResourceModule {}
