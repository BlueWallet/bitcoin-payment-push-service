/**
 * Demo: use the real @arkade-os SDK to create a Lightning invoice (Boltz reverse
 * swap) on mutinynet, then register the resulting pending swap with the local push
 * service so a phone push fires when it settles.
 *
 *   pnpm demo -- --topic <ntfy-topic> [--amount 1000] [--service http://localhost:3000]
 *
 * This is the wallet side of the flow: it owns the keys, creates the invoice via
 * `ArkadeSwaps.createLightningInvoice`, and hands the (preimage-redacted) pending
 * swap to the monitor-only push service. Requires connectivity to the Arkade
 * mutinynet server + Boltz. Set ARKADE_PRIVATE_KEY to reuse a wallet across runs.
 */
import { randomBytes } from "node:crypto";
import {
  Wallet,
  SingleKey,
  InMemoryWalletRepository,
  InMemoryContractRepository,
} from "@arkade-os/sdk";
import {
  ArkadeSwaps,
  BoltzSwapProvider,
  InMemorySwapRepository,
  type Network,
} from "@arkade-os/boltz-swap";

interface Args {
  topic: string;
  amount: number;
  service: string;
  network: Network;
  arkServerUrl: string;
  boltzApiUrl: string;
  label?: string;
}

function parseArgs(argv: string[]): Args {
  const map = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a?.startsWith("--")) map.set(a.slice(2), argv[i + 1] ?? "");
  }
  const topic = map.get("topic");
  if (!topic) {
    console.error("Missing --topic <ntfy-topic>");
    process.exit(1);
  }
  return {
    topic,
    amount: Number(map.get("amount") ?? 1000),
    service: map.get("service") ?? "http://localhost:3000",
    network: (map.get("network") ?? process.env.NETWORK ?? "mutinynet") as Network,
    arkServerUrl: map.get("ark") ?? process.env.ARK_SERVER_URL ?? "https://mutinynet.arkade.sh",
    boltzApiUrl:
      map.get("boltz") ?? process.env.BOLTZ_API_URL ?? "https://api.boltz.mutinynet.arkade.sh",
    label: map.get("label"),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const privHex = process.env.ARKADE_PRIVATE_KEY ?? Buffer.from(randomBytes(32)).toString("hex");
  const wallet = await Wallet.create({
    identity: SingleKey.fromHex(privHex),
    arkServerUrl: args.arkServerUrl,
    storage: {
      walletRepository: new InMemoryWalletRepository(),
      contractRepository: new InMemoryContractRepository(),
    },
  });

  // SwapManager disabled here: the push service does the monitoring, not the demo wallet.
  const swaps = await ArkadeSwaps.create({
    wallet,
    swapProvider: new BoltzSwapProvider({ network: args.network, apiUrl: args.boltzApiUrl }),
    swapManager: false,
    swapRepository: new InMemorySwapRepository(),
  });

  console.log(`Creating a ${args.amount} sat Lightning invoice on ${args.network} ...`);
  const result = await swaps.createLightningInvoice({ amount: args.amount });
  console.log("\nSwap id:", result.pendingSwap.id);
  console.log("\nPay this Lightning invoice:\n");
  console.log(result.invoice, "\n");

  // Hand the pending swap to the push service. Redact the preimage — monitoring
  // never needs it, and it stays on the wallet that will actually claim.
  const swap = { ...result.pendingSwap, preimage: "" };

  console.log(`Registering swap ${swap.id} with ${args.service} ...`);
  const reg = await fetch(`${args.service.replace(/\/$/, "")}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ swap, topic: args.topic, label: args.label ?? `${args.amount} sats` }),
  });
  if (!reg.ok) {
    console.error(`Registration failed: ${reg.status} ${reg.statusText}`);
    console.error(await reg.text().catch(() => ""));
    process.exit(1);
  }
  console.log("Registered. Pay the invoice and watch for a push on ntfy topic:", args.topic);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
