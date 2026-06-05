import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Registry } from "../src/registry.js";
import { silentLogger, mockReverseSwap } from "./helpers.js";

function makeRegistry(file: string): Registry {
  return new Registry(file, silentLogger);
}

describe("Registry", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "reg-"));
    file = join(dir, "registrations.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("adds and retrieves a registration keyed by swap id", () => {
    const reg = makeRegistry(file);
    const added = reg.add({ swap: mockReverseSwap("s1"), topic: "t1", label: "lbl" });
    expect(added.swapId).toBe("s1");
    expect(added.notifiedSettled).toBe(false);
    expect(reg.get("s1")?.topic).toBe("t1");
  });

  it("persists and reloads (including the swap object) across instances", () => {
    const a = makeRegistry(file);
    a.add({ swap: mockReverseSwap("s1"), topic: "t1" });
    a.add({ swap: mockReverseSwap("s2"), topic: "t2" });

    const b = makeRegistry(file);
    b.load();
    expect(b.all()).toHaveLength(2);
    expect(b.get("s2")?.topic).toBe("t2");
    expect(b.get("s2")?.swap.type).toBe("reverse");
  });

  it("tracks status and notified flag; active() excludes settled", () => {
    const reg = makeRegistry(file);
    reg.add({ swap: mockReverseSwap("s1"), topic: "t1" });
    reg.add({ swap: mockReverseSwap("s2"), topic: "t2" });

    reg.markStatus("s1", "transaction.mempool");
    expect(reg.get("s1")?.status).toBe("transaction.mempool");

    reg.markNotified("s1");
    expect(reg.active().map((r) => r.swapId)).toEqual(["s2"]);
  });

  it("removes a registration", () => {
    const reg = makeRegistry(file);
    reg.add({ swap: mockReverseSwap("s1"), topic: "t1" });
    expect(reg.remove("s1")).toBe(true);
    expect(reg.remove("s1")).toBe(false);
    expect(reg.all()).toHaveLength(0);
  });
});
