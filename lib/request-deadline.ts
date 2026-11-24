/** Bound auth, response headers and response body with one cancellable deadline. */
export function requestWithDeadline<T>(
  work: (signal: AbortSignal) => PromiseLike<T> | T,
  { timeoutMs = 20000, signal: parent }: { timeoutMs?: number; signal?: AbortSignal | null } = {},
): Promise<T> {
  if (parent?.aborted) return Promise.reject(parent.reason ?? new Error("Network request cancelled."));
  const controller = new AbortController();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (done: (value: any) => void, value: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      parent?.removeEventListener("abort", cancel);
      controller.signal.removeEventListener("abort", aborted);
      done(value);
    };
    const aborted = () => finish(reject, controller.signal.reason);
    const cancel = () => controller.abort(parent?.reason ?? new Error("Network request cancelled."));
    const timer = setTimeout(() => controller.abort(new Error("Network request timed out. Please retry.")), timeoutMs);
    controller.signal.addEventListener("abort", aborted, { once: true });
    parent?.addEventListener("abort", cancel, { once: true });
    Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return work(controller.signal);
    }).then(value => finish(resolve, value), error => finish(reject, error));
  });
}

/** Supabase reads the body after fetch returns, so its signal stays active. */
export function fetchWithDeadline(input: RequestInfo | URL, init?: RequestInit, timeoutMs = 12000): Promise<Response> {
  const parent = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  const timeout = AbortSignal.timeout(timeoutMs);
  return fetch(input, { ...init, signal: parent ? AbortSignal.any([parent, timeout]) : timeout });
}
