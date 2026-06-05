import "dotenv/config";
import { z } from "zod";

/**
 * SDK network literals accepted by @arkade-os/sdk (its `NetworkName` type).
 * Verify against the installed package's Network type if it changes.
 */
const networkSchema = z.enum([
  "bitcoin",
  "testnet",
  "signet",
  "mutinynet",
  "regtest",
]);

const envSchema = z.object({
  NETWORK: networkSchema.default("mutinynet"),
  // Boltz REST base. The boltz-swap SwapManager derives its websocket URL from this.
  BOLTZ_API_URL: z.string().url().default("https://api.boltz.mutinynet.arkade.sh"),
  ARK_SERVER_URL: z.string().url().default("https://mutinynet.arkade.sh"),
  ESPLORA_URL: z.string().url().default("https://mutinynet.com/api"),
  PORT: z.coerce.number().int().positive().default(3000),
  POLL_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
  NTFY_BASE_URL: z.string().url().default("https://ntfy.sh"),
  DATA_FILE: z.string().default("./data/registrations.json"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
});

export type Network = z.infer<typeof networkSchema>;
export type Config = z.infer<typeof envSchema>;

function load(): Config {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const config = load();
