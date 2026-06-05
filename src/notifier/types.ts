export interface NotifyTarget {
  /** ntfy topic. For other providers this would carry a device token instead. */
  topic: string;
}

export interface NotifyPayload {
  title: string;
  body: string;
  /** Optional tags/emoji (ntfy supports these); ignored by providers that can't use them. */
  tags?: string[];
  priority?: "min" | "low" | "default" | "high" | "max";
}

/**
 * Pluggable push delivery. The sample ships NtfyNotifier; FCM / Expo / Web-Push
 * implementations can be added without touching the monitor.
 */
export interface Notifier {
  notify(target: NotifyTarget, payload: NotifyPayload): Promise<void>;
}
