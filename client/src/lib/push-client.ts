import { apiFetch } from "./api";

let swRegistration: ServiceWorkerRegistration | null = null;

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) {
    console.log("[push] Service workers not supported");
    return null;
  }

  try {
    swRegistration = await navigator.serviceWorker.register("/sw.js");
    console.log("[push] Service worker registered");
    return swRegistration;
  } catch (err) {
    console.error("[push] Service worker registration failed:", err);
    return null;
  }
}

/** Check if push is supported and we can ask for permission */
export function isPushSupported(): boolean {
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** Check current notification permission state */
export function getPushPermission(): NotificationPermission | "unsupported" {
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission;
}

/**
 * Subscribe to push notifications.
 * If requestPermission is true, will prompt the user (must be called from user gesture).
 * If false, will only subscribe if permission is already granted.
 */
export async function subscribeToPush(
  serverId: string,
  serverUrl: string,
  deviceId: string,
  requestPermission = false,
): Promise<boolean> {
  if (!swRegistration) {
    console.log("[push] No service worker registration");
    return false;
  }

  if (!("PushManager" in window)) {
    console.log("[push] Push not supported");
    return false;
  }

  try {
    // Check permission state
    if (Notification.permission === "denied") {
      console.log("[push] Notification permission denied");
      return false;
    }

    if (Notification.permission !== "granted") {
      if (!requestPermission) {
        console.log(
          "[push] Permission not granted yet, waiting for user gesture",
        );
        return false;
      }
      // This must be called from a user gesture on iOS
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        console.log("[push] Notification permission denied by user");
        return false;
      }
    }

    // Get VAPID public key from server
    const vapidRes = await apiFetch("/api/push/vapid", { serverId, serverUrl });
    if (!vapidRes.ok) {
      console.error("[push] Failed to get VAPID key:", vapidRes.status);
      return false;
    }
    const { publicKey } = await vapidRes.json();

    // Convert VAPID key from base64url to Uint8Array
    const applicationServerKey = urlBase64ToUint8Array(publicKey);

    // Check for existing subscription
    let subscription = await swRegistration.pushManager.getSubscription();

    if (!subscription) {
      subscription = await swRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey.buffer as ArrayBuffer,
      });
    }

    // Send subscription to server
    const res = await apiFetch("/api/push/subscribe", {
      serverId,
      serverUrl,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: subscription.toJSON(), deviceId }),
    });

    if (!res.ok) {
      console.error("[push] Failed to save subscription:", res.status);
      return false;
    }

    console.log("[push] Push subscription active");
    return true;
  } catch (err) {
    console.error("[push] Subscribe failed:", err);
    return false;
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
