export type NotificationVisibilityMode = "snapshot" | "persistent";

export type NotificationDispatchLike = {
  id: string;
  visibility_mode?: string | null;
  target_type?: string | null;
  target_user_id?: string | null;
};

export function resolveNotificationVisibilityMode(value: string | null | undefined): NotificationVisibilityMode {
  return value === "persistent" ? "persistent" : "snapshot";
}

export function canPersistentDispatchApplyToUser(
  dispatch: NotificationDispatchLike,
  userId: string,
): boolean {
  const mode = resolveNotificationVisibilityMode(dispatch.visibility_mode);
  if (mode !== "persistent") return false;
  const targetType = String(dispatch.target_type || "all");
  if (targetType === "all") return true;
  if (targetType === "user") return String(dispatch.target_user_id || "") === String(userId || "");
  return false;
}

export function selectMissingPersistentDispatchIds(
  dispatches: NotificationDispatchLike[],
  existingDispatchIds: Iterable<string>,
  userId: string,
): string[] {
  const existing = new Set(Array.from(existingDispatchIds, (id) => String(id || "")));
  const out: string[] = [];
  for (const dispatch of dispatches) {
    const dispatchId = String(dispatch.id || "");
    if (!dispatchId || existing.has(dispatchId)) continue;
    if (!canPersistentDispatchApplyToUser(dispatch, userId)) continue;
    out.push(dispatchId);
  }
  return out;
}
