import {
  isReverseSuccessStatus,
  isReverseFailedStatus,
  type BoltzSwap,
  type BoltzSwapStatus,
  type SwapManagerClient,
} from "@arkade-os/boltz-swap";
import type { Logger } from "./logger.js";
import type { Registry } from "./registry.js";
import type { Notifier } from "./notifier/types.js";

export interface PaymentServiceDeps {
  manager: SwapManagerClient;
  registry: Registry;
  notifier: Notifier;
  logger: Logger;
}

export interface PaymentService {
  /** The single status-update handler. Returned so /simulate can drive it too. */
  onSwapUpdate: (swap: BoltzSwap, oldStatus: BoltzSwapStatus) => void;
}

/**
 * Wires the Boltz SwapManager's lifecycle events to push notifications.
 *
 * Flow: the wallet registers a reverse swap → SwapManager streams its status over
 * the Boltz websocket → on `invoice.settled` (reverse success) we push to the
 * registered ntfy topic exactly once, then stop watching the swap.
 */
export async function attachPaymentNotifications(deps: PaymentServiceDeps): Promise<PaymentService> {
  const { manager, registry, notifier, logger } = deps;

  const onSwapUpdate = (swap: BoltzSwap, _oldStatus: BoltzSwapStatus): void => {
    if (swap.type !== "reverse") return; // this service notifies on receives only
    const reg = registry.markStatus(swap.id, swap.status);
    if (!reg) return;

    if (isReverseSuccessStatus(swap.status) && !reg.notifiedSettled) {
      const suffix = reg.label ? ` (${reg.label})` : "";
      notifier
        .notify(
          { topic: reg.topic },
          {
            title: "Payment received",
            body: `⚡ Lightning payment settled${suffix}.`,
            tags: ["zap", "moneybag"],
            priority: "high",
          },
        )
        .then(() => {
          registry.markNotified(reg.swapId);
          return manager.removeSwap(reg.swapId);
        })
        .catch((err) => logger.error({ err, swapId: reg.swapId }, "failed to send push"));
      return;
    }

    if (isReverseFailedStatus(swap.status)) {
      logger.info({ swapId: swap.id, status: swap.status }, "reverse swap failed; unwatching");
      void manager.removeSwap(swap.id);
    }
  };

  await manager.onSwapUpdate(onSwapUpdate);
  await manager.onSwapFailed((swap, error) => {
    logger.warn({ swapId: swap.id, err: error.message }, "swap failed");
  });
  await manager.onWebSocketConnected(() => logger.info("Boltz websocket connected"));
  await manager.onWebSocketDisconnected((err) =>
    logger.warn({ err: err?.message }, "Boltz websocket disconnected"),
  );

  return { onSwapUpdate };
}
