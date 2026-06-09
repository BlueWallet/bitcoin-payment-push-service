import {
  isReverseSuccessStatus,
  isReverseFailedStatus,
  type BoltzSwap,
  type BoltzSwapStatus,
  type SwapManagerClient,
} from "@arkade-os/boltz-swap";
import type { Logger } from "./logger.js";
import type { Registry, Registration } from "./registry.js";
import type { Notifier } from "./notifier/types.js";

export interface PaymentServiceDeps {
  manager: SwapManagerClient;
  registry: Registry;
  notifier: Notifier;
  logger: Logger;
  /** How often to retry delivery for settled-but-undelivered swaps. Default 60s. */
  sweepIntervalMs?: number;
  /** Delivery attempts before giving up for this round. Default 3. */
  deliveryAttempts?: number;
}

export interface PaymentService {
  /** The single status-update handler. Returned so /simulate can drive it too. */
  onSwapUpdate: (swap: BoltzSwap, oldStatus: BoltzSwapStatus) => void;
  /** Stops the reconciliation sweep. */
  stop: () => void;
}

const DEFAULT_SWEEP_INTERVAL_MS = 60_000;
const DEFAULT_DELIVERY_ATTEMPTS = 3;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Wires the Boltz SwapManager's lifecycle events to push notifications.
 *
 * Flow: the wallet registers a reverse swap → SwapManager streams its status over
 * the Boltz websocket → on `invoice.settled` (reverse success) we push to the
 * registered ntfy topic exactly once, then stop watching the swap.
 *
 * Delivery is made robust on three fronts:
 *  - an in-flight guard (set synchronously) prevents a re-entrant event from
 *    sending a duplicate push before the first send resolves;
 *  - each send is retried with backoff;
 *  - a periodic reconciliation sweep re-attempts any swap that is settled but
 *    still registered (i.e. a previous delivery failed, or settled while the
 *    process was down), so a transient ntfy outage never loses the one push.
 * A delivered or terminally-failed swap is pruned from the registry and the
 * manager, keeping both bounded.
 */
export async function attachPaymentNotifications(deps: PaymentServiceDeps): Promise<PaymentService> {
  const { manager, registry, notifier, logger } = deps;
  const sweepIntervalMs = deps.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
  const deliveryAttempts = deps.deliveryAttempts ?? DEFAULT_DELIVERY_ATTEMPTS;

  // Swaps with a delivery currently in progress — guards against double-send.
  const inFlight = new Set<string>();

  const deliver = async (reg: Registration): Promise<void> => {
    if (inFlight.has(reg.swapId)) return;
    inFlight.add(reg.swapId);
    try {
      const suffix = reg.label ? ` (${reg.label})` : "";
      let lastErr: unknown;
      for (let attempt = 0; attempt < deliveryAttempts; attempt++) {
        try {
          const swap = reg.swap;
          await notifier.notify(
            { topic: reg.topic },
            {
              title: "Payment received",
              body: `⚡ Lightning payment settled${suffix}.`,
              tags: ["zap", "moneybag"],
              priority: "high",
              memo: reg.label ?? swap.request.description ?? "",
              preimage: swap.preimage,
              amtPaidSat: swap.request.invoiceAmount,
            },
          );
          // Delivered: stop watching and prune.
          registry.remove(reg.swapId);
          await manager.removeSwap(reg.swapId);
          return;
        } catch (err) {
          lastErr = err;
          if (attempt < deliveryAttempts - 1) await sleep(500 * 2 ** attempt);
        }
      }
      // Left registered & settled — the sweep will retry it later.
      logger.error(
        { err: lastErr, swapId: reg.swapId },
        "failed to deliver push after retries; will retry on next sweep",
      );
    } finally {
      inFlight.delete(reg.swapId);
    }
  };

  const onSwapUpdate = (swap: BoltzSwap, _oldStatus: BoltzSwapStatus): void => {
    if (swap.type !== "reverse") return; // this service notifies on receives only
    const reg = registry.markStatus(swap.id, swap.status);
    if (!reg) return;

    if (isReverseSuccessStatus(swap.status)) {
      void deliver(reg);
      return;
    }

    if (isReverseFailedStatus(swap.status)) {
      logger.info({ swapId: swap.id, status: swap.status }, "reverse swap failed; pruning");
      registry.remove(swap.id);
      void manager.removeSwap(swap.id);
    }
  };

  // Reconciliation: re-attempt any settled-but-still-registered swap. Catches
  // deliveries that failed all retries, and swaps that settled while we were down
  // (the SwapManager dedupes an unchanged status, so it won't re-emit on restart).
  const sweep = (): void => {
    for (const reg of registry.all()) {
      if (isReverseSuccessStatus(reg.swap.status) && !inFlight.has(reg.swapId)) {
        void deliver(reg);
      }
    }
  };
  const timer = setInterval(sweep, sweepIntervalMs);
  timer.unref?.(); // don't keep the process alive for the sweep alone

  await manager.onSwapUpdate(onSwapUpdate);
  await manager.onSwapFailed((swap, error) => {
    logger.warn({ swapId: swap.id, err: error.message }, "swap failed");
  });
  await manager.onWebSocketConnected(() => logger.info("Boltz websocket connected"));
  await manager.onWebSocketDisconnected((err) =>
    logger.warn({ err: err?.message }, "Boltz websocket disconnected"),
  );

  return { onSwapUpdate, stop: () => clearInterval(timer) };
}
