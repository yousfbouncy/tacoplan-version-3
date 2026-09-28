export function normalizeNotificationActionFields(input: {
  button_text?: unknown;
  button_url?: unknown;
} | null | undefined): {
  buttonText: string | null;
  buttonUrl: string | null;
  hasPartial: boolean;
} {
  const buttonText = typeof input?.button_text === "string" ? input.button_text.trim() : "";
  const buttonUrl = typeof input?.button_url === "string" ? input.button_url.trim() : "";
  return {
    buttonText: buttonText || null,
    buttonUrl: buttonUrl || null,
    hasPartial: (!!buttonText && !buttonUrl) || (!buttonText && !!buttonUrl),
  };
}

export function notificationActionValidationError(input: {
  button_text?: unknown;
  button_url?: unknown;
} | null | undefined): string | null {
  const { hasPartial } = normalizeNotificationActionFields(input);
  return hasPartial ? "Completa el nombre del botón y el enlace antes de enviar la notificación." : null;
}

export function withNotificationActionData(data: unknown, action: {
  buttonText?: string | null;
  buttonUrl?: string | null;
}) {
  const next = data && typeof data === "object" && !Array.isArray(data) ? { ...(data as Record<string, unknown>) } : {};
  if (action.buttonText && action.buttonUrl) {
    next.button_text = action.buttonText;
    next.button_url = action.buttonUrl;
  }
  return next;
}
