import { randomUUID } from "node:crypto";
import { requestWithDeadline } from "../request-deadline";
import type { PaymentStatus } from "../payment-types";
import { getAdminClient } from "./supabase";
import { mejlPodesen, paymentOutcomeReceipt, posalji, type IshodMejla, type Mejl } from "./mail";

export const PAYMENT_NOTIFICATION_MAX_JOBS = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const statuses = new Set<PaymentStatus>([
  "unpaid", "pending", "authorized", "paid", "failed", "cancelled", "expired",
  "review_required", "refund_pending", "refunded",
]);
type RpcName = "claim_payment_notifications" | "finish_payment_notification";
type RpcResult = { data: unknown; error: unknown };
type WorkerError = "MAIL_NOT_CONFIGURED" | "WORKER_ABORTED" | "WORKER_INVALID" |
  "CLAIM_FAILED" | "CLAIM_INVALID_RESPONSE" | "FINISH_FAILED" |
  "INVALID_JOB" | "TEST_MODE_BLOCKED" | "MAIL_SEND_FAILED" | "MAIL_SEND_TIMEOUT";

export type PaymentNotificationReport = {
  claimed: number;
  sent: number;
  failed: number;
  suppressed: number;
  unfinished: number;
  errorCodes: WorkerError[];
};
export type PaymentNotificationDependencies = {
  rpc(name: RpcName, parameters: Record<string, unknown>, signal: AbortSignal): PromiseLike<RpcResult>;
  send(mail: Mejl, options: { idempotencyKey: string; signal: AbortSignal }): Promise<IshodMejla>;
  mailConfigured(): boolean;
  workerId(): string;
  // Shorter deadlines are useful in isolated tests; callers cannot raise the upper bounds.
  rpcTimeoutMs?: number;
  sendTimeoutMs?: number;
};
const defaultDependencies: PaymentNotificationDependencies = {
  rpc: (name, parameters, signal) => getAdminClient(signal).rpc(name, parameters).abortSignal(signal),
  send: posalji,
  mailConfigured: mejlPodesen,
  workerId: randomUUID,
};
type Job = {
  id: string;
  outcome: "authorized" | "failed";
  reference: string;
  email: string;
  fullName: string;
  amountMinor: number;
  bankStatusCode: string;
  orderStatus: string;
  paymentStatus: PaymentStatus;
  reversalRequired: boolean;
};
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const simpleText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
const deadline = (value: number | undefined, maximum: number) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.min(value, maximum) : maximum;

function parseJob(value: unknown, worker: string): Job | null {
  if (!record(value) || typeof value.id !== "string" || !UUID.test(value.id) ||
      value.worker !== worker || value.environment !== "production" || value.testMode !== false ||
      value.idempotencyKey !== "payment-notification/" + value.id ||
      !simpleText(value.attemptId, 36) || !UUID.test(value.attemptId) ||
      !simpleText(value.reference, 80) || !record(value.customer) ||
      !simpleText(value.customer.fullName, 200) || !simpleText(value.customer.email, 320) ||
      !/^[^\s<>@,;]{1,64}@[A-Za-z0-9.-]{1,253}$/.test(value.customer.email) ||
      value.currency !== "RSD" ||
      typeof value.amountMinor !== "number" || !Number.isSafeInteger(value.amountMinor) ||
      value.amountMinor <= 0 || value.amountMinor > 999_999_999_999 ||
      (value.outcome !== "authorized" && value.outcome !== "failed") ||
      typeof value.bankStatusCode !== "string" || !/^\d{3}$/.test(value.bankStatusCode) ||
      (value.outcome === "authorized") !== (value.bankStatusCode === "000") ||
      typeof value.paymentStatus !== "string" || !statuses.has(value.paymentStatus as PaymentStatus) ||
      !simpleText(value.orderStatus, 32) || typeof value.reversalRequired !== "boolean") return null;
  return {
    id: value.id, outcome: value.outcome, reference: value.reference,
    email: value.customer.email, fullName: value.customer.fullName,
    amountMinor: value.amountMinor, bankStatusCode: value.bankStatusCode,
    orderStatus: value.orderStatus, paymentStatus: value.paymentStatus as PaymentStatus,
    reversalRequired: value.reversalRequired,
  };
}

/** Durable service-role outbox only. Current checkout configuration does not disable historical mail.
 * Two concurrent jobs, at most ten, RPC <=5s and send <=12s, with a shared 45s budget.
 * Unfinished jobs retain their five-minute DB lease for a later retry. Never log jobs/provider errors.
 * Provider idempotency covers retry uncertainty; permanent sent-state belongs to the SQL outbox.
 */
export async function processPaymentNotifications(
  options: { limit?: number; signal?: AbortSignal } = {},
  dependencies: PaymentNotificationDependencies = defaultDependencies,
): Promise<PaymentNotificationReport> {
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(45_000)])
    : AbortSignal.timeout(45_000);
  const report: PaymentNotificationReport = {
    claimed: 0, sent: 0, failed: 0, suppressed: 0, unfinished: 0, errorCodes: [],
  };
  const error = (code: WorkerError) => { if (!report.errorCodes.includes(code)) report.errorCodes.push(code); };
  if (signal.aborted) { error("WORKER_ABORTED"); return report; }
  if (!dependencies.mailConfigured()) { error("MAIL_NOT_CONFIGURED"); return report; }
  const worker = dependencies.workerId();
  if (!UUID.test(worker)) { error("WORKER_INVALID"); return report; }
  const limit = Number.isSafeInteger(options.limit) && options.limit! > 0
    ? Math.min(options.limit!, PAYMENT_NOTIFICATION_MAX_JOBS) : PAYMENT_NOTIFICATION_MAX_JOBS;
  const rpcMs = deadline(dependencies.rpcTimeoutMs, 5000), sendMs = deadline(dependencies.sendTimeoutMs, 12000);
  const rpc = async (name: RpcName, parameters: Record<string, unknown>) => {
    const result = await requestWithDeadline(
      signal => dependencies.rpc(name, parameters, signal), { timeoutMs: rpcMs, signal },
    );
    if (result.error) throw new Error("Payment notification RPC failed");
    return result.data;
  };
  let claimed: unknown;
  try { claimed = await rpc("claim_payment_notifications", { p_worker: worker, p_limit: limit }); }
  catch { error(signal.aborted ? "WORKER_ABORTED" : "CLAIM_FAILED"); return report; }
  if (!Array.isArray(claimed) || claimed.length > limit) {
    error("CLAIM_INVALID_RESPONSE");
    return report;
  }
  const jobs: unknown[] = claimed;
  report.claimed = jobs.length;
  let cursor = 0;
  const seen = new Set<string>();
  const finish = async (id: string, success: boolean, code: WorkerError | null, providerMessageId: string | null) => {
    try {
      const result = await rpc("finish_payment_notification", {
        p_id: id, p_worker: worker, p_success: success,
        p_provider_message_id: providerMessageId, p_error_code: code,
      });
      if (!record(result) || result.sent !== success || typeof result.duplicate !== "boolean") {
        throw new Error("Invalid finish result");
      }
      return true;
    } catch {
      report.unfinished++;
      error("FINISH_FAILED");
      return false;
    }
  };
  const run = async () => {
    while (cursor < jobs.length) {
      const value: unknown = jobs[cursor++];
      if (!record(value) || typeof value.id !== "string" || !UUID.test(value.id) || seen.has(value.id)) {
        report.unfinished++;
        error("INVALID_JOB");
        continue;
      }
      seen.add(value.id);
      const id = value.id;
      if (value.testMode === true || value.environment !== "production") {
        error("TEST_MODE_BLOCKED");
        if (await finish(id, false, "TEST_MODE_BLOCKED", null)) report.suppressed++;
        continue;
      }
      const job = parseJob(value, worker);
      if (!job) {
        error("INVALID_JOB");
        if (await finish(id, false, "INVALID_JOB", null)) report.failed++;
        continue;
      }
      if (signal.aborted) {
        report.unfinished++;
        error("WORKER_ABORTED");
        continue;
      }
      const reviewRequired = job.reversalRequired || job.orderStatus === "cancelled" ||
        ["review_required", "cancelled", "expired", "refund_pending", "refunded"].includes(job.paymentStatus);
      let result: IshodMejla;
      let sendSignal: AbortSignal | undefined;
      try {
        const receipt = paymentOutcomeReceipt({
          reference: job.reference, fullName: job.fullName, amount: job.amountMinor / 100,
          status: job.outcome, bankStatusCode: job.bankStatusCode, method: "card",
          reviewRequired, orderCancelled: job.orderStatus === "cancelled", currentPaymentStatus: job.paymentStatus,
        });
        result = await requestWithDeadline(signal => {
          sendSignal = signal;
          return dependencies.send({ ...receipt, to: job.email }, {
            idempotencyKey: "payment-notification/" + id, signal,
          });
        }, { timeoutMs: sendMs, signal });
      } catch {
        const code = sendSignal?.aborted ? "MAIL_SEND_TIMEOUT" : "MAIL_SEND_FAILED";
        error(code);
        if (await finish(id, false, code, null)) report.failed++;
        continue;
      }
      if (!result.sent) {
        const code = result.reason === "nije-podesen" ? "MAIL_NOT_CONFIGURED" : "MAIL_SEND_FAILED";
        error(code);
        if (await finish(id, false, code, null)) report.failed++;
        continue;
      }
      const providerMessageId = typeof result.providerMessageId === "string" && UUID.test(result.providerMessageId)
        ? result.providerMessageId : null;
      if (await finish(id, true, null, providerMessageId)) report.sent++;
    }
  };
  await Promise.all([run(), run()]);
  return report;
}
