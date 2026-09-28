import { supabase } from "@/lib/supabase";
import AsyncStorage from "@react-native-async-storage/async-storage";

export async function requireAuthenticatedUser(): Promise<{ id: string }> {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();
  if (error) throw error;
  if (!session?.user) throw new Error("No hay usuario autenticado");
  return { id: session.user.id };
}

export async function userScopedKey(base: string, userId?: string | null): Promise<string> {
  if (userId) return `${base}_${userId}`;
  try {
    const user = await requireAuthenticatedUser();
    return `${base}_${user.id}`;
  } catch {
    try {
      const last = await AsyncStorage.getItem("tacoplan_last_user_id");
      if (last) return `${base}_${last}`;
    } catch {}
    return `${base}_guest`;
  }
}
