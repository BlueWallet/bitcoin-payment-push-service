import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SwapManagerClient } from "@arkade-os/boltz-swap";
import { Registry } from "../src/registry.js";
import { attachPaymentNotifications, type PaymentService } from "../src/paymentService.js";
import type { Notifier } from "../src/notifier/types.js";
import { silentLogger, mockReverseSwap } from "./helpers.js";

/** Minimal SwapManagerClient — only the methods attachPaymentNotifications uses. */
function fakeManager(removeSwap: () => Promise<void>): SwapManagerClient {
  return {
    onSwapUpdate: async () => () => {},
    onSwapFailed: async () => () => {},
    onWebSocketConnected: async () => () => {},
    onWebSocketDisconnected: async () => () => {},
    removeSwap,
  } as unknown as SwapManagerClient;
}

describe("delivery reliability", () => {
  let dir: string;
  let payments: PaymentService;

  afterEach(() => {
    payments?.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it("recovers a settled swap via the sweep when the first delivery fails (no lost push)", async () => {
    dir = mkdtempSync(join(tmpdir(), "deliv-"));

    let calls = 0;
    const notify = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error("ntfy transiently down");
    });
    const notifier = { notify } as unknown as Notifier;

    const removed = vi.fn(async () => {});
    const registry = new Registry(join(dir, "reg.json"), silentLogger);
    payments = await attachPaymentNotifications({
      manager: fakeManager(removed),
      registry,
      notifier,
      logger: silentLogger,
      sweepIntervalMs: 25,
      deliveryAttempts: 1, // one shot per round, so the failure must be recovered by the sweep
    });

    // A swap that is already settled but not yet delivered (e.g. settled while the
    // process was down, or a prior delivery failed). The sweep must deliver it.
    registry.add({ swap: mockReverseSwap("s1", "invoice.settled"), topic: "t1" });

    // The first delivery throws, but the swap is not lost: a later sweep
    // redelivers successfully → push lands, swap is pruned. If a failure dropped
    // the push, it would stay at 1 call and never be pruned.
    await vi.waitFor(() => expect(registry.get("s1")).toBeUndefined(), { timeout: 1500 });
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(removed).toHaveBeenCalledWith("s1");
  });
});
