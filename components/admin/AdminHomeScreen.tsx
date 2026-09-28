import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ArrowUpCircle,
  Bell,
  Bot,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  LoaderCircle,
  Settings,
  Users,
} from "lucide-react-native";
import Colors from "@/constants/colors";
import { useAuth } from "@/lib/auth-context";

const MENU_ITEMS = [
  { label: "Resumen", icon: LayoutDashboard, href: "/admin/summary" },
  { label: "Usuarios", icon: Users, href: "/admin/users" },
  { label: "Notificaciones", icon: Bell, href: "/admin/notifications" },
  { label: "Programadas", icon: CalendarClock, href: "/admin/scheduled" },
  { label: "Automáticas", icon: Bot, href: "/admin/automations" },
  { label: "Actualizaciones", icon: ArrowUpCircle, href: "/admin/updates" },
  { label: "Ajustes", icon: Settings, href: "/admin/settings" },
] as const;

export default function AdminHomeScreen() {
  const { isAdmin, isAdminLoading } = useAuth();
  const insets = useSafeAreaInsets();
  const items = useMemo(() => MENU_ITEMS, []);

  if (isAdminLoading) {
    return (
      <View style={styles.center}>
        <LoaderCircle size={26} color={Colors.light.tint} />
      </View>
    );
  }

  if (!isAdmin) {
    return (
      <View style={styles.center}>
        <View style={styles.card}>
          <Text style={styles.title}>Acceso restringido</Text>
          <Text style={styles.helperText}>Este panel solo está disponible para usuarios presentes en `public.admin_users`.</Text>
          <Pressable style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.9 }]} onPress={() => router.back()}>
            <ChevronLeft size={18} color="#2563EB" />
            <Text style={styles.backButtonLabel}>Volver</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Text style={styles.pageTitle}>Panel Admin</Text>
        <Pressable style={({ pressed }) => [styles.iconButton, pressed && { opacity: 0.9 }]} onPress={() => router.back()}>
          <ChevronLeft size={18} color="#2563EB" />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom + 24, 32) }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.card}>
          {items.map((item, index) => {
            const Icon = item.icon;
            return (
              <Pressable
                key={item.href}
                onPress={() => router.push(item.href as any)}
                style={({ pressed }) => [
                  styles.row,
                  index === items.length - 1 && styles.rowLast,
                  pressed && { opacity: 0.94 },
                ]}
              >
                <View style={styles.rowLeft}>
                  <View style={styles.rowIcon}>
                    <Icon size={17} color="#2563EB" />
                  </View>
                  <Text style={styles.rowLabel}>{item.label}</Text>
                </View>
                <ChevronRight size={18} color="#94A3B8" />
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#F6F8FC",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F6F8FC",
    padding: 20,
  },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  pageTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 28,
    color: "#0F172A",
  },
  content: {
    paddingHorizontal: 16,
    gap: 16,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#E5EAF4",
    paddingHorizontal: 18,
    paddingVertical: 8,
    shadowColor: "#0F172A",
    shadowOpacity: 0.04,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 1,
    width: "100%",
    maxWidth: 720,
  },
  title: {
    fontFamily: "Inter_700Bold",
    fontSize: 18,
    color: "#0F172A",
  },
  helperText: {
    marginTop: 10,
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    lineHeight: 21,
    color: "#64748B",
  },
  backButton: {
    marginTop: 16,
    minHeight: 44,
    borderRadius: 14,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: "#D7E2F2",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  backButtonLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: "#2563EB",
  },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#D7E2F2",
  },
  row: {
    minHeight: 56,
    borderBottomWidth: 1,
    borderBottomColor: "#EEF2F7",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  rowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EFF6FF",
  },
  rowLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 16,
    color: "#0F172A",
  },
});
