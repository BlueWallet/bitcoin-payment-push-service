export interface NotifyTarget {
  /** ntfy topic, or preimage hash (hex) for GroundControl. */
  topic: string;
}

export interface NotifyPayload {
  title: string;
  body: string;
  /** Optional tags/emoji (ntfy supports these); ignored by providers that can't use them. */
  tags?: string[];
  priority?: "min" | "low" | "default" | "high" | "max";
  memo?: string;
  /** Empty when the wallet redacts the preimage at /register. */
  preimage?: string;
  amtPaidSat?: number;
}

/**
 * Pluggable push delivery. The sample ships NtfyNotifier; FCM / Expo / Web-Push
 * implementations can be added without touching the monitor.
 */
export interface Notifier {
  notify(target: NotifyTarget, payload: NotifyPayload): Promise<void>;
}
