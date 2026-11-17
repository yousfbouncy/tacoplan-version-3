/** Build a safe Google Maps target for an optional location assigned by Tráfico. */
export function googleMapsDestination(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw || raw.length > 1000) return null;
  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      const host = url.hostname.toLowerCase();
      const allowed = host === "maps.app.goo.gl" || host === "maps.google.com" ||
        ((host === "google.com" || host === "www.google.com") && url.pathname.startsWith("/maps")) ||
        (host === "goo.gl" && url.pathname.startsWith("/maps/"));
      return url.protocol === "https:" && !url.username && !url.password && allowed ? url.toString() : null;
    } catch { return null; }
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return null;
  const coords = raw.match(/^([+-]?\d+(?:\.\d+)?)\s*[,;]\s*([+-]?\d+(?:\.\d+)?)$/);
  if (coords) {
    const lat = Number(coords[1]), lon = Number(coords[2]);
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(lat + "," + lon);
  }
  if (!/[\p{L}\p{N}]/u.test(raw)) return null;
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(raw);
}
