/** Validación común para todos los pasos del alta y configuración inicial. */
export function isValidAccountEmail(value: string): boolean {
  const email = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
