import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { BoltzReverseSwap, BoltzSwapStatus } from "@arkade-os/boltz-swap";
import type { Logger } from "./logger.js";

export interface Registration {
  swapId: string;
  /** ntfy topic to push to (extensible to device tokens for other providers). */
  topic: string;
  label?: string;
  /**
   * The pending reverse swap as supplied by the wallet at registration time.
   * Re-fed to the SwapManager on restart so monitoring resumes. The wallet may
   * redact `preimage` (the service never claims), keeping the secret off this box.
   */
  swap: BoltzReverseSwap;
  status: BoltzSwapStatus;
  createdAt: number;
  updatedAt: number;
  /** True once we have sent the "payment received" push, so we never double-notify. */
  notifiedSettled: boolean;
}

export interface RegisterInput {
  topic: string;
  label?: string;
  swap: BoltzReverseSwap;
}

/**
 * Stores swap-id -> registration mappings, persisted to a JSON file so that
 * registrations survive restarts and can be re-subscribed on boot.
 */
export class Registry {
  private readonly byId = new Map<string, Registration>();

  constructor(
    private readonly filePath: string,
    private readonly logger: Logger,
  ) {}

  load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const raw = readFileSync(this.filePath, "utf8");
      const items = JSON.parse(raw) as Registration[];
      for (const item of items) this.byId.set(item.swapId, item);
      this.logger.info({ count: this.byId.size }, "loaded registrations from disk");
    } catch (err) {
      this.logger.error({ err, filePath: this.filePath }, "failed to load registrations");
    }
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify([...this.byId.values()], null, 2));
    } catch (err) {
      this.logger.error({ err, filePath: this.filePath }, "failed to persist registrations");
    }
  }

  add(input: RegisterInput): Registration {
    const now = Date.now();
    const swapId = input.swap.id;
    const existing = this.byId.get(swapId);
    const reg: Registration = {
      swapId,
      topic: input.topic,
      label: input.label,
      swap: input.swap,
      status: existing?.status ?? input.swap.status,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      notifiedSettled: existing?.notifiedSettled ?? false,
    };
    this.byId.set(swapId, reg);
    this.persist();
    return reg;
  }

  get(swapId: string): Registration | undefined {
    return this.byId.get(swapId);
  }

  remove(swapId: string): boolean {
    const removed = this.byId.delete(swapId);
    if (removed) this.persist();
    return removed;
  }

  /** All registrations. */
  all(): Registration[] {
    return [...this.byId.values()];
  }

  /** Registrations still awaiting settlement (the ones worth re-subscribing). */
  active(): Registration[] {
    return this.all().filter((r) => !r.notifiedSettled);
  }

  markStatus(swapId: string, status: BoltzSwapStatus): Registration | undefined {
    const reg = this.byId.get(swapId);
    if (!reg) return undefined;
    reg.status = status;
    reg.swap.status = status;
    reg.updatedAt = Date.now();
    this.persist();
    return reg;
  }

  markNotified(swapId: string): void {
    const reg = this.byId.get(swapId);
    if (!reg) return;
    reg.notifiedSettled = true;
    reg.updatedAt = Date.now();
    this.persist();
  }
}
