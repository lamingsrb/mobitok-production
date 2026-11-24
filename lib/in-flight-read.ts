/** Deli samo preklopljena citanja iste generacije; zavrsene vrednosti se ne cuvaju. */
export class InFlightRead<T> {
  private active?: { generation: number; promise: Promise<T>; signal?: AbortSignal };

  run(generation: number, work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.active?.generation === generation && !this.active.signal?.aborted) return this.active.promise;
    const entry = { generation, signal, promise: undefined as unknown as Promise<T> };
    entry.promise = Promise.resolve().then(work).finally(() => {
      if (this.active === entry) this.active = undefined;
    });
    this.active = entry;
    return entry.promise;
  }
}
