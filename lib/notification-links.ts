import { Linking } from "react-native";

export type NotificationLinkFields = {
  type?: string | null;
  button_text?: string | null;
  button_url?: string | null;
  data?: any;
};

export function getNotificationAction(input: NotificationLinkFields | null | undefined): {
  buttonText: string | null;
  buttonUrl: string | null;
} {
  const directText = typeof input?.button_text === "string" ? input.button_text.trim() : "";
  const directUrl = typeof input?.button_url === "string" ? input.button_url.trim() : "";
  const dataText = typeof input?.data?.button_text === "string" ? String(input.data.button_text).trim() : "";
  const dataUrl = typeof input?.data?.button_url === "string" ? String(input.data.button_url).trim() : "";
  const updateUrl =
    typeof input?.data?.apk_url === "string" && input.data.apk_url.trim()
      ? String(input.data.apk_url).trim()
      : typeof input?.data?.app_store_url === "string" && input.data.app_store_url.trim()
        ? String(input.data.app_store_url).trim()
        : "";
  const updateText = updateUrl ? "Actualizar" : "";

  const buttonText = directText || dataText || updateText || null;
  const buttonUrl = directUrl || dataUrl || updateUrl || null;

  if (!buttonText || !buttonUrl) {
    return { buttonText: null, buttonUrl: null };
  }

  return { buttonText, buttonUrl };
}


export type NotificationAction = { label: string; url: string };

export function getNotificationActions(input: NotificationLinkFields | null | undefined): NotificationAction[] {
  const actions = input?.data?.actions;
  if (Array.isArray(actions) && actions.length > 0) {
    return actions.slice(0, 4).filter((item: any) =>
      item && typeof item.label === "string" && typeof item.url === "string" &&
      item.label.trim() && ["https://", "http://", "tacoplan://"].some(prefix => item.url.trim().toLowerCase().startsWith(prefix))
    ).map((item: any) => ({ label: item.label.trim(), url: item.url.trim() }));
  }
  const legacy = getNotificationAction(input);
  return legacy.buttonText && legacy.buttonUrl ? [{ label: legacy.buttonText, url: legacy.buttonUrl }] : [];
}

export async function openNotificationUrl(url: string | null | undefined) {
  if (!url) return false;
  try {
    const supported = await Linking.canOpenURL(url);
    if (!supported) return false;
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}
