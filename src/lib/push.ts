import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import webpush from "web-push";

const CONFIG_DIR = join(homedir(), ".config", "claude-remote");
const VAPID_PATH = join(CONFIG_DIR, "vapid.json");
const SUBSCRIPTIONS_PATH = join(CONFIG_DIR, "push-subscriptions.json");

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

interface StoredSubscription {
  deviceId: string;
  subscription: webpush.PushSubscription;
  createdAt: string;
}

let vapidKeys: VapidKeys | null = null;

function ensureConfigDir() {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function initVapid(): VapidKeys {
  ensureConfigDir();

  // Load existing keys
  if (existsSync(VAPID_PATH)) {
    try {
      vapidKeys = JSON.parse(readFileSync(VAPID_PATH, "utf8"));
      if (vapidKeys) {
        webpush.setVapidDetails(
          process.env.CLIENT_URL || "https://localhost",
          vapidKeys.publicKey,
          vapidKeys.privateKey,
        );
        console.log("[push] VAPID keys loaded");
        return vapidKeys;
      }
    } catch (err) {
      console.error("[push] Failed to load VAPID keys, regenerating:", err);
    }
  }

  // Generate new keys
  const keys = webpush.generateVAPIDKeys();
  vapidKeys = { publicKey: keys.publicKey, privateKey: keys.privateKey };
  writeFileSync(VAPID_PATH, JSON.stringify(vapidKeys, null, 2));
  webpush.setVapidDetails(
    process.env.CLIENT_URL || "https://localhost",
    vapidKeys.publicKey,
    vapidKeys.privateKey,
  );
  console.log("[push] VAPID keys generated and saved");
  return vapidKeys;
}

export function getVapidPublicKey(): string | null {
  return vapidKeys?.publicKey || null;
}

function loadSubscriptions(): StoredSubscription[] {
  try {
    if (!existsSync(SUBSCRIPTIONS_PATH)) return [];
    return JSON.parse(readFileSync(SUBSCRIPTIONS_PATH, "utf8"));
  } catch {
    return [];
  }
}

function saveSubscriptions(subs: StoredSubscription[]): void {
  ensureConfigDir();
  writeFileSync(SUBSCRIPTIONS_PATH, JSON.stringify(subs, null, 2));
}

export function addSubscription(
  deviceId: string,
  subscription: webpush.PushSubscription,
): void {
  const subs = loadSubscriptions();
  // Remove existing subscription for this device (replace)
  const filtered = subs.filter((s) => s.deviceId !== deviceId);
  filtered.push({
    deviceId,
    subscription,
    createdAt: new Date().toISOString(),
  });
  saveSubscriptions(filtered);
  console.log(`[push] Subscription saved for device ${deviceId}`);
}

export function removeSubscription(deviceId: string): void {
  const subs = loadSubscriptions();
  const filtered = subs.filter((s) => s.deviceId !== deviceId);
  saveSubscriptions(filtered);
  console.log(`[push] Subscription removed for device ${deviceId}`);
}

export async function sendPushToAll(
  title: string,
  body: string,
  url?: string,
): Promise<void> {
  const subs = loadSubscriptions();
  if (subs.length === 0) return;

  const payload = JSON.stringify({ title, body, url: url || "/" });
  const stale: string[] = [];

  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub.subscription, payload);
      console.log(`[push] Notification sent to device ${sub.deviceId}`);
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 410 || statusCode === 404) {
        // Subscription expired or invalid — remove it
        stale.push(sub.deviceId);
        console.log(
          `[push] Subscription expired for device ${sub.deviceId}, removing`,
        );
      } else {
        console.error(`[push] Failed to send to device ${sub.deviceId}:`, err);
      }
    }
  }

  // Clean up stale subscriptions
  if (stale.length > 0) {
    const remaining = loadSubscriptions().filter(
      (s) => !stale.includes(s.deviceId),
    );
    saveSubscriptions(remaining);
  }
}
