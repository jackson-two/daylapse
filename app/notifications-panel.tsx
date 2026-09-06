"use client";

import { useEffect, useState, type FormEvent } from "react";
import { DEFAULT_NOTIFICATION_SETTINGS, notificationSettingsSchema, type NotificationSettings } from "@/lib/notification-schema";

async function notificationRequest(path: string, method: string, body: unknown) {
  const response = await fetch(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
  const result = await response.json() as { error?: string };
  if (!response.ok) throw new Error(result.error || "Notification settings could not be saved. Please try again.");
  return result;
}

async function persistSubscription(subscription: PushSubscription, settings: NotificationSettings, timeZone: string) {
  await notificationRequest("/api/notifications", "PUT", { subscription: subscription.toJSON(), settings, timeZone });
}

function publicKeyBytes(key: string) {
  return Uint8Array.from(atob(key.replaceAll("-", "+").replaceAll("_", "/")), (char) => char.charCodeAt(0));
}

export default function NotificationsPanel() {
  const [settings, setSettings] = useState(DEFAULT_NOTIFICATION_SETTINGS);
  const [subscribed, setSubscribed] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const [timeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const stored = window.localStorage.getItem("daylapse.notifications");
        if (stored) {
          try {
            const raw = JSON.parse(stored);
            const parsed = notificationSettingsSchema.safeParse({ ...raw, dueToday: raw.dueToday ?? raw.dueAndOverdue ?? true });
            if (parsed.success && active) setSettings(parsed.data);
          } catch { /* Keep defaults when old device preferences are malformed. */ }
        }
        if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
          if (active) { setPermission("unsupported"); setMessage("On iPhone or iPad, add Daylapse to your Home Screen and open it there to enable notifications."); }
          return;
        }
        if (active) setPermission(Notification.permission);
        const response = await fetch("/api/notifications", { cache: "no-store", signal: AbortSignal.timeout(20_000) });
        if (!response.ok) throw new Error("Could not check notification setup. Reopen this screen to try again.");
        const config = await response.json() as { configured: boolean; publicKey: string | null };
        if (!active) return;
        setConfigured(config.configured);
        setPublicKey(config.publicKey);
        if (!config.configured) { setMessage("Notifications need to be configured on the server first."); return; }
        const registration = await navigator.serviceWorker.getRegistration();
        const subscription = await registration?.pushManager.getSubscription();
        if (!subscription || Notification.permission !== "granted") return;
        const status = await notificationRequest("/api/notifications/status", "POST", { endpoint: subscription.endpoint }) as {
          subscribed: boolean; settings?: NotificationSettings; timeZone?: string;
        };
        if (!active) return;
        if (status.subscribed && status.settings) {
          const saved = notificationSettingsSchema.parse(status.settings);
          if (status.timeZone !== timeZone) await persistSubscription(subscription, saved, timeZone);
          if (!active) return;
          setSettings(saved);
          setSubscribed(true);
        } else setMessage("Enable notifications to reconnect this device.");
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : "Could not load notification settings.");
      } finally { if (active) setBusy(false); }
    }
    void load();
    return () => { active = false; };
  }, [timeZone]);

  async function enable() {
    if (!publicKey || busy) return;
    setBusy(true);
    setMessage("");
    try {
      // Request permission directly from the click, before any network requests.
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== "granted") { setMessage("Allow notifications in this device’s settings to receive due-today alerts."); return; }
      await navigator.serviceWorker.register("/sw.js");
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      const key = publicKeyBytes(publicKey);
      const existingKey = subscription?.options.applicationServerKey;
      if (subscription && (!existingKey || !publicKeyBytes(publicKey).every((value, index) => new Uint8Array(existingKey)[index] === value))) {
        await subscription.unsubscribe();
        subscription = null;
      }
      subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      const saved = notificationSettingsSchema.parse(settings);
      await persistSubscription(subscription, saved, timeZone);
      window.localStorage.setItem("daylapse.notifications", JSON.stringify(saved));
      setSubscribed(true);
      setMessage("This device is connected. Due-today alerts use the time below.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not enable notifications. Please try again.");
    } finally { setBusy(false); }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const saved = notificationSettingsSchema.parse(settings);
      if (subscribed) {
        const registration = await navigator.serviceWorker.getRegistration();
        const subscription = await registration?.pushManager.getSubscription();
        if (!subscription) { setSubscribed(false); throw new Error("Enable notifications again to connect this device."); }
        await persistSubscription(subscription, saved, timeZone);
      }
      window.localStorage.setItem("daylapse.notifications", JSON.stringify(saved));
      setMessage(subscribed ? "Notification preferences saved." : "Preferences saved. Enable notifications to receive alerts.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save notification preferences."); }
    finally { setBusy(false); }
  }

  async function disable() {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await notificationRequest("/api/notifications", "DELETE", { endpoint: subscription.endpoint });
        await subscription.unsubscribe();
      }
      setSubscribed(false);
      setMessage("Notifications are disconnected on this device.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not disconnect notifications."); }
    finally { setBusy(false); }
  }

  async function test() {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (!subscription) { setSubscribed(false); throw new Error("Enable notifications again on this device."); }
      await notificationRequest("/api/notifications/test", "POST", { endpoint: subscription.endpoint });
      setMessage("The test was accepted by the push service. Check this device for a notification.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not send a test."); }
    finally { setBusy(false); }
  }

  return <>
    <section className="overview overview--screen notification-overview" id="top">
      <div><p className="section-kicker">This device</p><h1>Notifications</h1><p className="overview__lede">Get a daily reminder for items due today.</p></div>
      <div className={`notification-status notification-status--${permission}`}><span className="status-dot" aria-hidden="true" /><div><small>Notification status</small><strong>{busy ? "Checking…" : subscribed ? "Connected" : permission === "denied" ? "Off in device settings" : permission === "unsupported" ? "Unavailable here" : "Not connected"}</strong></div></div>
    </section>
    <section className="notification-settings" aria-labelledby="notification-settings-heading">
      <div className="settings-heading"><div><h2 id="notification-settings-heading">Due-today notifications</h2></div>
        {subscribed ? <button className="secondary-action" disabled={busy} onClick={() => void test()}>Send a test</button> : <button className="primary-action" disabled={busy || !configured || permission === "unsupported"} onClick={() => void enable()}>Enable notifications</button>}
      </div>
      {message && <p className="settings-message" role="status">{message}</p>}
      <form onSubmit={save}>
        <fieldset disabled={busy} className="notification-fields"><legend className="sr-only">Notification preferences</legend><div className="settings-list">
          <label className="settings-row"><span><strong>Items due today</strong><small>Include recurring tasks, important dates, and celebrations; skip archived items</small></span><input type="checkbox" checked={settings.dueToday} onChange={(event) => setSettings({ ...settings, dueToday: event.target.checked })} /></label>
          <label className="settings-row settings-row--time"><span><strong>Daily delivery time</strong><small>{timeZone}</small></span><input type="time" required value={settings.deliveryTime} onChange={(event) => setSettings({ ...settings, deliveryTime: event.target.value })} aria-label="Preferred notification time" /></label>
        </div><button className="secondary-action" type="submit">Save preferences</button></fieldset>
      </form>
      <p className="settings-footnote">We check every five minutes after your chosen time. No items due means no alert. Your device may delay delivery based on connectivity, Focus, or notification settings.</p>
      <p className="settings-note">On iPhone or iPad, use the app added to your Home Screen.</p>
      {subscribed && <button className="secondary-action" disabled={busy} onClick={() => void disable()}>Disconnect this device</button>}
    </section>
  </>;
}
