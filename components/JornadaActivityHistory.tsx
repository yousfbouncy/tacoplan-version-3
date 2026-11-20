import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { getDriverActivityTotals, loadDriverActivities, loadActivityCorrections, mergeActivityCorrections, type ActivityLog, type DriverActivity } from "@/lib/driver-activities";
import { useAuth } from "@/lib/auth-context";

const labels: Record<DriverActivity, { name: string; emoji: string }> = {
  DRIVING: { name: "Conducción", emoji: "🚛" },
  REST: { name: "Pausas", emoji: "☕" },
  AVAILABLE: { name: "Disponibilidad", emoji: "🕒" },
  WORK: { name: "Otros trabajos", emoji: "🛠️" },
};
const order: DriverActivity[] = ["DRIVING", "AVAILABLE", "WORK", "REST"];

export function formatActivityMinutes(milliseconds: number): string {
  const min = Math.floor(Math.max(0, milliseconds) / 60000);
  return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}min`;
}

function clock(value: string | null | undefined): string {
  if (!value) return "En curso";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : "--:--";
}

/**
 * One lazy read when the journey card is expanded, from local storage first,
 * then Supabase if the device does not have the segments. No network polling.
 * This is a timeline of ALL observed pauses, not just EU break credit.
 */
export default function JornadaActivityHistory({
  shiftId, endAt,
}: { shiftId: string; endAt: string | null }) {
  const { user } = useAuth();
  const [log, setLog] = useState<ActivityLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let alive = true;
    if (!user?.id) {
      setLoading(false);
      setLog(null);
      return;
    }
    setLoading(true);
    void Promise.all([
      loadDriverActivities(user.id, shiftId),
      loadActivityCorrections(user.id, shiftId),
    ]).then(([result, corrections]) => {
      if (alive) setLog(mergeActivityCorrections(result, corrections));
    }).catch(() => {
      if (alive) setLog(null);
    }).finally(() => {
      if (alive) setLoading(false);
    });
    return () => { alive = false; };
  }, [user?.id, shiftId]);

  useEffect(() => {
    if (endAt || !log?.segments.some(segment => segment.endedAt === null)) return;
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, [endAt, log]);

  const snapshotMs = endAt && Number.isFinite(Date.parse(endAt)) ? Date.parse(endAt) : now;
  const totals = useMemo(() =>
    getDriverActivityTotals(log ?? { shiftId, segments: [] }, new Date(snapshotMs)),
  [log, shiftId, snapshotMs]);

  if (loading) return <View style={{ paddingVertical: 12 }}><ActivityIndicator size="small" /></View>;
  if (!log?.segments.length) return null;

  return (
    <View style={{
      marginTop: 10, padding: 12, borderRadius: 12,
      borderWidth: 1, borderColor: "#335575", backgroundColor: "#10273F", gap: 8,
    }}>
      <Text style={{ color: "#FFFFFF", fontSize: 13, fontWeight: "700" }}>
        Actividades registradas de esta jornada
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {order.map(type => (
          <View key={type} style={{
            width: "48%", backgroundColor: "#173551",
            borderRadius: 10, padding: 9,
          }}>
            <Text style={{ color: "#BED5EB", fontSize: 11 }}>
              {labels[type].emoji} {labels[type].name}
            </Text>
            <Text style={{ color: "#FFFFFF", fontSize: 14, fontWeight: "700", marginTop: 4 }}>
              {formatActivityMinutes(totals.totals[type])}
            </Text>
          </View>
        ))}
      </View>
      <Text style={{ color: "#98C8F4", fontSize: 11 }}>
        Pausas totales: se suman todos los minutos registrados, aunque no computen como pausa reglamentaria de conducción.
      </Text>
      <View style={{ borderTopWidth: 1, borderTopColor: "#30506D", paddingTop: 9, gap: 6 }}>
        <Text style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "700" }}>Desglose por tramos</Text>
        {log.segments.map((segment, index) => {
          const start = Date.parse(segment.startedAt);
          const end = segment.endedAt ? Date.parse(segment.endedAt) : snapshotMs;
          const duration = Number.isFinite(start) && Number.isFinite(end)
            ? Math.max(0, Math.min(end, snapshotMs) - start) : 0;
          return (
            <View key={`${segment.startedAt}-${index}`}
              style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
              <Text style={{ color: "#C7D7E7", fontSize: 12, flexShrink: 1 }}>
                {labels[segment.type].emoji} {labels[segment.type].name} · {clock(segment.startedAt)} – {clock(segment.endedAt ?? endAt)}
              </Text>
              <Text style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "600" }}>
                {formatActivityMinutes(duration)}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}
