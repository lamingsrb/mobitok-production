type Stage = "mode" | "search" | "alias" | "meta" | "listing";
type DiagnosticStage = Stage | "layout" | "route";
const diagnosticCode = (error: unknown): string => {
  const value = error && typeof error === "object" ? error as { code?: unknown; status?: unknown } : {};
  if (typeof value.code === "string" && /^(?:[0-9A-Z]{5}|PGRST[0-9A-Z]{3})$/.test(value.code)) return value.code;
  return typeof value.status === "number" && Number.isInteger(value.status) && value.status >= 400 && value.status <= 599
    ? `HTTP${value.status}` : "unknown";
};
const reportFailure = (stage: DiagnosticStage, error: unknown, durationMs: number) =>
  console.warn("Catalog read failed", { stage, code: diagnosticCode(error), durationMs: Math.round(durationMs) });

/** Safe operation diagnostics never contain SQL/query text, body, key or raw error. */
export async function catalogOperation<T>(stage: DiagnosticStage, task: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try { return await task(); }
  catch (error) { reportFailure(stage, error, performance.now() - started); throw error; }
}

/** Request-local timings separate handler work from transport and cold startup. */
export function catalogTimings() {
  const started = performance.now();
  const stages: { name: Stage; duration: number }[] = [];
  let reported = false;
  return {
    async measure<T>(name: Stage, task: () => Promise<T>): Promise<T> {
      const before = performance.now();
      try { return await task(); }
      catch (error) { reported = true; reportFailure(name, error, performance.now() - before); throw error; }
      finally { stages.push({ name, duration: performance.now() - before }); }
    },
    failure(error: unknown) { if (!reported) { reported = true; reportFailure("route", error, performance.now() - started); } },
    header() {
      return [...stages, { name: "total", duration: performance.now() - started }]
        .map(({ name, duration }) => `${name};dur=${duration.toFixed(1)}`).join(", ");
    },
  };
}
