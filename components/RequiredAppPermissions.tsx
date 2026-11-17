import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Linking, Platform, Pressable, ScrollView, Text, View } from "react-native";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import { registerPushToken, useAuth } from "@/lib/auth-context";
import WebBrowserTripAlerts from "@/components/WebBrowserTripAlerts";

type Permission = { granted: boolean; canAskAgain: boolean };
type State = { location: Permission; notifications: Permission };
const background = "#08182D";
const ink = "#EEF4FF";
const muted = "#A8BDD8";

async function readState(): Promise<State> {
  const [location, notifications] = await Promise.all([
    Location.getForegroundPermissionsAsync(),
    Notifications.getPermissionsAsync(),
  ]);
  const notificationsAllowed = notifications.granted ||
    (Platform.OS === "ios" && notifications.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL);
  return {
    location: { granted: location.granted, canAskAgain: location.canAskAgain },
    notifications: { granted: notificationsAllowed, canAskAgain: notifications.canAskAgain },
  };
}

export default function RequiredAppPermissions({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State | null>(null);
  const [working, setWorking] = useState<"location" | "notifications" | null>(null);
  const [problem, setProblem] = useState("");
  const { user } = useAuth();
  const tokenRegistration = useRef<{ userId:string | null; lastAttempt:number; inFlight:boolean; succeeded:boolean }>({
    userId:null,lastAttempt:0,inFlight:false,succeeded:false,
  });

  // A granted OS permission is not sufficient: the server needs this specific
  // device's Expo token. If registration failed at boot (e.g. offline) retry
  // on foreground, not on a background timer or on each render.
  useEffect(() => {
    if (Platform.OS === "web" || !state?.notifications.granted || !user?.id) return;
    const userId=user.id;
    const register = () => {
      const status=tokenRegistration.current;
      if(status.userId!==userId) {
        Object.assign(status,{userId,lastAttempt:0,inFlight:false,succeeded:false});
      }
      if(status.inFlight || status.succeeded || Date.now()-status.lastAttempt<60_000) return;
      status.inFlight=true;
      status.lastAttempt=Date.now();
      void registerPushToken().then(result => {
        if (result.ok) status.succeeded=true;
        else console.warn("[PUSH] Device registration needs retry:",result.message);
      }).catch(error => {
        console.warn("[PUSH] Device registration unavailable:",
          error instanceof Error ? error.message : "unknown");
      }).finally(()=>{status.inFlight=false});
    };
    register();
    const subscription=AppState.addEventListener("change",state=>{
      if(state==="active")register();
    });
    return ()=>subscription.remove();
  }, [state?.notifications.granted,user?.id]);


  const refresh = useCallback(async () => {
    if (Platform.OS === "web") return;
    try {
      const next = await readState();
      setState(next);
      setProblem("");
    } catch {
      setProblem("No se han podido comprobar los permisos. Vuelve a intentarlo.");
    }
  }, []);

  useEffect(() => {
    if (Platform.OS === "web") return;
    void refresh();
    const sub = AppState.addEventListener("change", next => {
      if (next === "active") void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const requestPermission = async (kind: "location" | "notifications") => {
    if (working) return;
    setWorking(kind);
    setProblem("");
    try {
      const current = await readState();
      const permission = current[kind];
      if (!permission.granted) {
        if (!permission.canAskAgain) {
          await Linking.openSettings();
        } else if (kind === "location") {
          await Location.requestForegroundPermissionsAsync();
        } else {
          await Notifications.requestPermissionsAsync();
        }
      }
      await refresh();
    } catch {
      setProblem("No se pudo solicitar el permiso. Puedes habilitarlo desde los ajustes del teléfono.");
    } finally {
      setWorking(null);
    }
  };

  if (Platform.OS === "web") return <>{children}<WebBrowserTripAlerts /></>;
  if (!state && !problem) return <View style={{ flex: 1, backgroundColor: background, justifyContent: "center", alignItems: "center" }}><ActivityIndicator color="#5FAFFF" size="large" /></View>;
  if (state?.location.granted && state.notifications.granted) return <>{children}</>;

  const Row = ({ kind, title, description }: { kind: "location" | "notifications"; title: string; description: string }) => {
    const permission = state?.[kind];
    return <View style={{ backgroundColor: "#112742", borderColor: "#294360", borderWidth: 1, borderRadius: 18, padding: 16, marginBottom: 14 }}>
      <Text style={{ color: ink, fontSize: 17, fontWeight: "700" }}>{title}</Text>
      <Text style={{ color: muted, fontSize: 13, lineHeight: 20, marginTop: 6 }}>{description}</Text>
      <Text style={{ color: permission?.granted ? "#75D5AB" : "#FFC67A", fontWeight: "600", marginTop: 9 }}>{permission?.granted ? "Permiso concedido" : "Pendiente de autorización"}</Text>
      {!permission?.granted && <Pressable accessibilityRole="button" disabled={working !== null} onPress={() => void requestPermission(kind)}
        style={{ alignItems: "center", backgroundColor: "#2178E4", paddingVertical: 13, borderRadius: 12, marginTop: 12, opacity: working ? 0.6 : 1 }}>
        <Text style={{ color: "#FFFFFF", fontWeight: "700" }}>{working === kind ? "Comprobando…" : permission?.canAskAgain === false ? "Abrir ajustes del teléfono" : "Permitir desde Tacoplan"}</Text>
      </Pressable>}
    </View>;
  };

  return <View style={{ flex: 1, backgroundColor: background }}>
    <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", paddingHorizontal: 22, paddingVertical: 46 }}>
      <Text style={{ color: "#71B9FF", fontWeight: "700", fontSize: 13 }}>CONFIGURACIÓN INICIAL</Text>
      <Text style={{ color: ink, fontWeight: "800", fontSize: 26, marginTop: 10 }}>Permisos necesarios de Tacoplan</Text>
      <Text style={{ color: muted, lineHeight: 21, marginTop: 12, marginBottom: 26 }}>Para continuar, autoriza la ubicación mientras utilizas la aplicación y las notificaciones. Cada botón abre la solicitud del sistema directamente aquí, sin buscarla en Ajustes.</Text>
      <Row kind="location" title="Ubicación · Mientras se usa" description="Tacoplan utiliza la ubicación mientras usas la aplicación para detectar el lugar de inicio y, especialmente, el lugar de fin de jornada. Conceder este permiso no activa un seguimiento continuo de tu posición. Para proteger tus datos, compartir tu ubicación puntual con Tráfico requiere una autorización independiente y voluntaria. Otras funciones opcionales, como AutoStart, pueden utilizar la ubicación si las activas. No es obligatorio permitir la ubicación en segundo plano." />
      <Row kind="notifications" title="Notificaciones" description="Para avisos de jornada, límites y viajes asignados por Tráfico." />
      {problem ? <Text style={{ color: "#FFB2AA", marginBottom: 12 }}>{problem}</Text> : null}
      <Pressable accessibilityRole="button" onPress={() => void refresh()} style={{ alignItems: "center", padding: 12 }}><Text style={{ color: "#88C7FF", fontWeight: "600" }}>Volver a comprobar permisos</Text></Pressable>
      <Text style={{ color: muted, fontSize: 12, lineHeight: 18, marginTop: 12 }}>Si Android o iOS ya han bloqueado nuevas solicitudes, el botón abrirá los ajustes del teléfono. El permiso de compartir ubicaciones con Tráfico sigue siendo independiente y voluntario.</Text>
    </ScrollView>
  </View>;
}
