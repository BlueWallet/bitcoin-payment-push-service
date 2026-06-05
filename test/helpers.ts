import type { BoltzReverseSwap, BoltzSwapStatus } from "@arkade-os/boltz-swap";
import type { Logger } from "../src/logger.js";

export const silentLogger = {
  fatal: () => {},
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  trace: () => {},
  silent: () => {},
  level: "silent",
  child: () => silentLogger,
} as unknown as Logger;

/** A minimal but type-complete pending reverse swap, as a wallet would register. */
export function mockReverseSwap(
  id = "reverse-swap-1",
  status: BoltzSwapStatus = "swap.created",
): BoltzReverseSwap {
  return {
    id,
    type: "reverse",
    createdAt: Math.floor(Date.now() / 1000),
    preimage: "", // redacted by the wallet; monitoring never needs it
    status,
    request: {
      claimPublicKey: "0".repeat(66),
      invoiceAmount: 10_000,
      preimageHash: "0".repeat(64),
    },
    response: {
      id,
      invoice: "lnbc100n1ptest",
      lockupAddress: "ark1test",
      onchainAmount: 10_000,
      refundPublicKey: "0".repeat(66),
      timeoutBlockHeights: {
        refund: 100,
        unilateralClaim: 200,
        unilateralRefund: 300,
        unilateralRefundWithoutReceiver: 400,
      },
    },
  } as unknown as BoltzReverseSwap;
}
