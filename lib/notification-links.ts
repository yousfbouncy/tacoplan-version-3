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
