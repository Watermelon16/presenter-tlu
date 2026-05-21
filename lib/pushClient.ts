// Client-side Web Push helpers — register SW + subscribe to push manager.
// Public VAPID key set qua env NEXT_PUBLIC_VAPID_PUBLIC_KEY.

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; i++) {
    view[i] = rawData.charCodeAt(i);
  }
  return buffer;
}

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function getNotificationPermission(): NotificationPermission | null {
  if (!isPushSupported()) return null;
  return Notification.permission;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isPushSupported()) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js");
  } catch (e) {
    console.warn("[push] SW register failed", e);
    return null;
  }
}

export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return await reg.pushManager.getSubscription();
}

export type SerializedSubscription = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

function serializeSubscription(sub: PushSubscription): SerializedSubscription | null {
  const p256dhBuf = sub.getKey("p256dh");
  const authBuf = sub.getKey("auth");
  if (!p256dhBuf || !authBuf) return null;

  const toBase64 = (buf: ArrayBuffer) => {
    const bytes = new Uint8Array(buf);
    let str = "";
    for (const b of bytes) str += String.fromCharCode(b);
    return btoa(str);
  };

  return {
    endpoint: sub.endpoint,
    p256dh: toBase64(p256dhBuf),
    auth: toBase64(authBuf),
  };
}

/**
 * Subscribe to push notifications. Returns serialized subscription or null nếu fail.
 * Sẽ throw nếu user denied permission.
 */
export async function subscribeToPush(): Promise<SerializedSubscription | null> {
  if (!isPushSupported()) return null;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!publicKey) {
    console.warn("[push] NEXT_PUBLIC_VAPID_PUBLIC_KEY chưa cấu hình");
    return null;
  }

  const reg = (await registerServiceWorker()) ?? (await navigator.serviceWorker.ready);
  if (!reg) return null;

  let permission = Notification.permission;
  if (permission === "default") {
    permission = await Notification.requestPermission();
  }
  if (permission !== "granted") {
    throw new Error("Bạn đã từ chối nhận thông báo");
  }

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }

  return serializeSubscription(sub);
}

/**
 * Hủy subscription hiện tại (nếu có). Trả về endpoint của subscription đã huỷ.
 */
export async function unsubscribeFromPush(): Promise<string | null> {
  const sub = await getExistingSubscription();
  if (!sub) return null;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  return endpoint;
}
