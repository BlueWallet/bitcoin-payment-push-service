import { config } from "./config.js";
import { logger } from "./logger.js";
import { NtfyNotifier } from "./notifier/ntfyNotifier.js";
import type { Notifier } from "./notifier/types.js";

/**
 * Selects the push provider. Only ntfy ships in this sample; add cases here for
 * FCM / Expo / Web-Push and they slot in behind the same Notifier interface.
 */
export function createNotifier(): Notifier {
  return new NtfyNotifier(config.NTFY_BASE_URL, logger);
}
