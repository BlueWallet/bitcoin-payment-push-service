import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SwapManagerClient } from "@arkade-os/boltz-swap";
import { Registry } from "../src/registry.js";
import { createSwapWatcher } from "../src/swapWatcher.js";
import { attachPaymentNotifications } from "../src/paymentService.js";
import { buildServer } from "../src/server.js";
import type { Notifier } from "../src/notifier/types.js";
import { silentLogger, mockReverseSwap } from "./helpers.js";

/**
 * Controllable stand-in for `globalThis.WebSocket`. The real boltz-swap
 * SwapManager constructs `new globalThis.WebSocket(url)` and drives it via
 * `onopen` / `onmessage` / `send` / `readyState`, so swapping this in lets us
 * exercise the REAL SwapManager with mocked Boltz events.
 */
class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((err: unknown) => void) | null = null;
  onmessage: ((msg: { data: string }) => void | Promise<void>) | null = null;
  sent: string[] = [];

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.onclose?.();
  }

  // test helpers
  emitUpdate(id: string, status: string): Promise<void> | void {
    return this.onmessage?.({ data: JSON.stringify({ event: "update", args: [{ id, status }] }) });
  }
  subscribedIds(): string[] {
    return this.sent
      .map((s) => JSON.parse(s) as { op?: string; args?: string[] })
      .filter((m) => m.op === "subscribe")
      .flatMap((m) => m.args ?? []);
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("payment flow (real SwapManager, mocked Boltz events)", () => {
  let dir: string;
  let manager: SwapManagerClient;
  let app: ReturnType<typeof buildServer>;
  let notify: ReturnType<typeof vi.fn>;
  let notifier: Notifier;
  let originalWebSocket: unknown;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "flow-"));
    FakeWebSocket.instances = [];
    originalWebSocket = (globalThis as Record<string, unknown>).WebSocket;
    (globalThis as Record<string, unknown>).WebSocket = FakeWebSocket;
    // Polling fallback hits fetch; keep it benign and offline.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ status: "swap.created" }) })),
    );

    notify = vi.fn(async () => {});
    notifier = { notify } as unknown as Notifier;

    const registry = new Registry(join(dir, "reg.json"), silentLogger);
    registry.load();
    manager = createSwapWatcher(
      { network: "mutinynet", apiUrl: "https://api.boltz.mutinynet.arkade.sh", pollIntervalMs: 600_000 },
      silentLogger,
    );
    const { onSwapUpdate } = await attachPaymentNotifications({ manager, registry, notifier, logger: silentLogger });

    app = buildServer({ registry, manager, simulate: onSwapUpdate, logger: silentLogger });
    await app.ready();

    // Start the manager and bring the (fake) websocket up.
    await manager.start([]);
    const ws = FakeWebSocket.instances[0]!;
    ws.onopen?.();
  });

  afterEach(async () => {
    await manager.stop();
    await app.close();
    (globalThis as Record<string, unknown>).WebSocket = originalWebSocket;
    vi.unstubAllGlobals();
    rmSync(dir, { recursive: true, force: true });
  });

  it("pushes exactly once when a registered reverse swap reaches invoice.settled", async () => {
    const ws = FakeWebSocket.instances[0]!;
    const swap = mockReverseSwap("reverse-swap-1");

    // 1. Wallet registers the pending reverse swap with a phone topic.
    const res = await app.inject({
      method: "POST",
      url: "/register",
      payload: { swap, topic: "phone-topic", label: "1000 sats" },
    });
    expect(res.statusCode).toBe(201);

    // 2. SwapManager subscribed this swap id over the websocket.
    expect(ws.subscribedIds()).toContain("reverse-swap-1");
    expect(await manager.hasSwap("reverse-swap-1")).toBe(true);

    // 3. Boltz streams the lifecycle; no push until the terminal settle.
    await ws.emitUpdate("reverse-swap-1", "transaction.mempool");
    await ws.emitUpdate("reverse-swap-1", "transaction.confirmed");
    await flush();
    expect(notify).not.toHaveBeenCalled();

    // 4. invoice.settled => payment received => one push to the registered topic.
    await ws.emitUpdate("reverse-swap-1", "invoice.settled");
    await flush();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]![0]).toEqual({ topic: "phone-topic" });
    expect(notify.mock.calls[0]![1]).toMatchObject({ title: "Payment received" });

    // 5. The swap is marked settled and unwatched.
    const list = await app.inject({ method: "GET", url: "/register" });
    expect(list.json().registrations[0]).toMatchObject({ status: "invoice.settled", notifiedSettled: true });
    expect(await manager.hasSwap("reverse-swap-1")).toBe(false);
  });

  it("does not double-notify on a duplicate settled event", async () => {
    const ws = FakeWebSocket.instances[0]!;
    await app.inject({
      method: "POST",
      url: "/register",
      payload: { swap: mockReverseSwap("reverse-swap-2"), topic: "phone-topic" },
    });

    await ws.emitUpdate("reverse-swap-2", "invoice.settled");
    await flush();
    await ws.emitUpdate("reverse-swap-2", "invoice.settled"); // swap already removed -> ignored
    await flush();

    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("supports the /simulate endpoint for manual phone testing", async () => {
    await app.inject({
      method: "POST",
      url: "/register",
      payload: { swap: mockReverseSwap("reverse-swap-3"), topic: "phone-topic" },
    });

    const sim = await app.inject({
      method: "POST",
      url: "/simulate",
      payload: { swapId: "reverse-swap-3", status: "invoice.settled" },
    });
    expect(sim.statusCode).toBe(200);
    await flush();
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
