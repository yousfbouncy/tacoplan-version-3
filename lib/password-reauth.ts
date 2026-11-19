/**
 * Supabase's Secure password change requires a one-time reauthentication
 * code when a session is not recent. The signed-in user receives the code
 * from Supabase; no sign-out, password reset or admin bypass is involved.
 */
export function isPasswordReauthenticationRequired(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; message?: unknown };
  return value.code === "reauthentication_needed" ||
    (typeof value.message === "string" &&
     /password update requires reauthentication|reauthentication required/i.test(value.message));
}
