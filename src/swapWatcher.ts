import {
  BoltzSwapProvider,
  SwapManager,
  type SwapManagerCallbacks,
  type SwapManagerClient,
  type SwapManagerConfig,
  type Network,
} from "@arkade-os/boltz-swap";
import type { Logger } from "./logger.js";

export interface SwapWatcherOptions {
  network: Network;
  apiUrl: string;
  pollIntervalMs: number;
}

/**
 * Builds a monitoring-only Boltz SwapManager from the official @arkade-os/boltz-swap
 * package. The SwapManager owns a single multiplexed websocket to Boltz (subscribed
 * to `swap.update`), with built-in polling fallback and exponential reconnect backoff.
 *
 * We run it with `enableAutoActions: false` because this is a *notification* service:
 * it watches swaps created by the wallet and never claims/refunds them, so it needs no
 * wallet keys. No-op callbacks are wired only to keep the manager's internal logging
 * quiet (their guarded paths are never exercised when auto-actions are off).
 */
export function createSwapWatcher(opts: SwapWatcherOptions, logger: Logger): SwapManagerClient {
  const provider = new BoltzSwapProvider({ network: opts.network, apiUrl: opts.apiUrl });

  const config: SwapManagerConfig = {
    enableAutoActions: false,
    pollInterval: opts.pollIntervalMs,
  };

  const manager = new SwapManager(provider, config);

  const noop = async (): Promise<void> => {};
  const noopTxid = async (): Promise<{ txid: string }> => ({ txid: "" });
  const callbacks: SwapManagerCallbacks = {
    claim: noop,
    refund: noop,
    claimArk: noopTxid,
    claimBtc: noopTxid,
    refundArk: async () => ({ swept: 0, skipped: 0 }),
    saveSwap: noop,
  };
  manager.setCallbacks(callbacks);

  logger.info({ network: opts.network, apiUrl: opts.apiUrl }, "Boltz SwapManager created (monitor-only)");
  return manager;
}
