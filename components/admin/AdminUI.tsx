import React from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  useWindowDimensions,
  View,
  ViewStyle,
} from "react-native";
import { ChevronRight, type LucideIcon } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";

type NavItem = {
  key: string;
  label: string;
  icon: LucideIcon;
};

type ButtonProps = {
  label: string;
  onPress: () => void;
  icon?: LucideIcon;
  disabled?: boolean;
  loading?: boolean;
  tone?: "primary" | "secondary" | "danger" | "ghost";
  style?: StyleProp<ViewStyle>;
};

type BadgeProps = {
  label: string;
  tone?: "default" | "info" | "success" | "warning" | "danger";
};

export function AdminShell({
  title,
  subtitle,
  navItems,
  activeKey,
  onSelect,
  headerActions,
  children,
}: {
  title: string;
  subtitle?: string;
  navItems: NavItem[];
  activeKey: string;
  onSelect: (key: string) => void;
  headerActions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isDesktop = width >= 1024;
  const isTablet = width >= 768;

  const Nav = (
    <View style={[styles.navCard, isDesktop ? styles.navDesktop : styles.navMobile]}>
      <Text style={styles.brandEyebrow}>Tacoplan</Text>
      <Text style={styles.brandTitle}>Panel Admin</Text>
      <Text style={styles.brandCopy}>Control de usuarios, envíos, automatizaciones y versiones desde una sola vista.</Text>
      <View style={styles.navList}>
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = activeKey === item.key;
          return (
            <Pressable
              key={item.key}
              onPress={() => onSelect(item.key)}
              style={({ pressed }) => [
                styles.navItem,
                active && styles.navItemActive,
                pressed && { opacity: 0.92 },
                !isDesktop && styles.navItemMobile,
              ]}
            >
              <Icon size={18} color={active ? "#0B1020" : Colors.light.textSecondary} />
              <Text style={[styles.navLabel, active && styles.navLabelActive]} numberOfLines={1}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  if (isDesktop) {
    return (
      <View style={[styles.root, styles.rootDesktop]}>
        <View style={styles.desktopRail}>{Nav}</View>
        <View style={styles.desktopMain}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.pageTitle}>{title}</Text>
              {subtitle ? <Text style={styles.pageSubtitle}>{subtitle}</Text> : null}
            </View>
            <View style={styles.headerActions}>{headerActions}</View>
          </View>
          <ScrollView contentContainerStyle={[styles.scrollContent, isTablet && { paddingBottom: 32 }]} showsVerticalScrollIndicator={false}>
            {children}
          </ScrollView>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={[styles.headerMobile, { paddingTop: insets.top + 10 }]}>
        <View style={styles.headerCopy}>
          <Text style={styles.pageTitle}>{title}</Text>
          {subtitle ? <Text style={styles.pageSubtitle}>{subtitle}</Text> : null}
        </View>
        <View style={styles.headerActions}>{headerActions}</View>
      </View>
      <ScrollView contentContainerStyle={[styles.scrollContent, styles.scrollContentMobile, { paddingBottom: Math.max(insets.bottom + 24, 32) }]} showsVerticalScrollIndicator={false}>
        {children}
      </ScrollView>
    </View>
  );
}

export function SurfaceCard({
  title,
  description,
  right,
  children,
  style,
}: {
  title?: string;
  description?: string;
  right?: React.ReactNode;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.card, style]}>
      {(title || description || right) ? (
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderCopy}>
            {title ? <Text style={styles.cardTitle}>{title}</Text> : null}
            {description ? <Text style={styles.cardDescription}>{description}</Text> : null}
          </View>
          {right ? <View style={styles.cardHeaderRight}>{right}</View> : null}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export function MetricCard({
  icon: Icon,
  label,
  value,
  hint,
  style,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  hint?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.metricCard, style]}>
      <View style={styles.metricIcon}>
        <Icon size={18} color="#2563EB" />
      </View>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
      {hint ? <Text style={styles.metricHint}>{hint}</Text> : null}
    </View>
  );
}

export function ActionTile({
  label,
  description,
  onPress,
  icon: Icon,
  active,
  style,
}: {
  label: string;
  description?: string;
  onPress: () => void;
  icon: LucideIcon;
  active?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionTile,
        active && styles.actionTileActive,
        pressed && { opacity: 0.94 },
        style,
      ]}
    >
      <View style={[styles.actionTileIcon, active && styles.actionTileIconActive]}>
        <Icon size={22} color={active ? "#1D4ED8" : "#2563EB"} />
      </View>
      <Text style={styles.actionTileLabel}>{label}</Text>
      {description ? <Text style={styles.actionTileDescription}>{description}</Text> : null}
    </Pressable>
  );
}

export function IconButton({
  icon: Icon,
  onPress,
  tone = "secondary",
  disabled,
}: {
  icon: LucideIcon;
  onPress: () => void;
  tone?: "primary" | "secondary" | "danger" | "ghost";
  disabled?: boolean;
}) {
  const styleByTone = buttonTone[tone];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.iconButton,
        styleByTone.container,
        disabled && styles.buttonDisabled,
        pressed && { opacity: 0.9 },
      ]}
    >
      <Icon size={18} color={styleByTone.text.color as string} />
    </Pressable>
  );
}

export function ListRow({
  label,
  icon: Icon,
  onPress,
  right,
}: {
  label: string;
  icon?: LucideIcon;
  onPress: () => void;
  right?: React.ReactNode;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.listRow, pressed && { opacity: 0.94 }]}>
      <View style={styles.listRowLeft}>
        {Icon ? (
          <View style={styles.listRowIcon}>
            <Icon size={17} color="#2563EB" />
          </View>
        ) : null}
        <Text style={styles.listRowLabel}>{label}</Text>
      </View>
      {right ?? <ChevronRight size={18} color="#94A3B8" />}
    </Pressable>
  );
}

export function Badge({ label, tone = "default" }: BadgeProps) {
  return (
    <View style={[styles.badge, badgeTone[tone]]}>
      <Text style={[styles.badgeLabel, badgeLabelTone[tone]]}>{label}</Text>
    </View>
  );
}

export function InlineButton({
  label,
  onPress,
  icon: Icon,
  disabled,
  loading,
  tone = "secondary",
  style,
}: ButtonProps) {
  const styleByTone = buttonTone[tone];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        styleByTone.container,
        (disabled || loading) && styles.buttonDisabled,
        pressed && { opacity: 0.92 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={styleByTone.text.color as string} /> : Icon ? <Icon size={16} color={styleByTone.text.color as string} /> : null}
      <Text style={[styles.buttonLabel, styleByTone.text]}>{label}</Text>
    </Pressable>
  );
}

export function FilterPill({
  label,
  active,
  onPress,
  icon: Icon,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
  icon?: LucideIcon;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        active && styles.pillActive,
        pressed && { opacity: 0.9 },
      ]}
    >
      {Icon ? <Icon size={14} color={active ? "#EFF6FF" : Colors.light.textSecondary} /> : null}
      <Text style={[styles.pillLabel, active && styles.pillLabelActive]}>{label}</Text>
    </Pressable>
  );
}

export function EmptyCard({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <SurfaceCard style={styles.emptyCard}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
      {action ? <View style={{ marginTop: 14 }}>{action}</View> : null}
    </SurfaceCard>
  );
}

export function SkeletonBlock({ height = 88, style }: { height?: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.skeleton, { height }, style]} />;
}

export function ToastBanner({
  tone,
  message,
}: {
  tone: "success" | "danger" | "info";
  message: string;
}) {
  return (
    <View style={[styles.toast, toastTone[tone]]}>
      <Text style={styles.toastText}>{message}</Text>
    </View>
  );
}

export function Label({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.label, style]}>{children}</Text>;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#F6F8FC",
  },
  rootDesktop: {
    flexDirection: "row",
    alignItems: "stretch",
  },
  desktopRail: {
    width: 288,
    padding: 18,
    paddingRight: 0,
  },
  desktopMain: {
    flex: 1,
    paddingHorizontal: 20,
    minHeight: "100%",
  },
  navCard: {
    backgroundColor: "rgba(255,255,255,0.92)",
    borderWidth: 1,
    borderColor: "#E5EAF4",
    borderRadius: 24,
    padding: 18,
    shadowColor: "#0F172A",
    shadowOpacity: 0.05,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 12 },
    elevation: 1,
  },
  navDesktop: {
    flex: 1,
  },
  navMobile: {
    minWidth: 760,
    marginHorizontal: 16,
  },
  brandEyebrow: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
    color: "#2563EB",
    marginBottom: 6,
  },
  brandTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 22,
    color: "#0F172A",
  },
  brandCopy: {
    marginTop: 8,
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    lineHeight: 20,
    color: Colors.light.textSecondary,
  },
  navList: {
    marginTop: 22,
    gap: 10,
  },
  navItem: {
    minHeight: 46,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E5EAF4",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  navItemMobile: {
    flex: 1,
  },
  navItemActive: {
    backgroundColor: "#DBEAFE",
    borderColor: "#BFDBFE",
  },
  navLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: "#334155",
  },
  navLabelActive: {
    color: "#0B1020",
  },
  header: {
    paddingTop: 20,
    paddingBottom: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 16,
    alignItems: "center",
  },
  headerMobile: {
    paddingTop: 56,
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 12,
  },
  headerCopy: {
    flex: 1,
  },
  pageTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 28,
    color: "#0F172A",
  },
  pageSubtitle: {
    marginTop: 6,
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    lineHeight: 20,
    color: "#64748B",
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 110,
    gap: 16,
  },
  scrollContentMobile: {
    paddingBottom: 24,
  },
  card: {
    backgroundColor: "rgba(255,255,255,0.96)",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#E5EAF4",
    padding: 18,
    shadowColor: "#0F172A",
    shadowOpacity: 0.04,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 1,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 16,
  },
  cardHeaderCopy: {
    flex: 1,
    gap: 6,
  },
  cardHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  cardTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 18,
    color: "#0F172A",
  },
  cardDescription: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    lineHeight: 19,
    color: "#64748B",
  },
  metricCard: {
    flex: 1,
    minWidth: 150,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#E5EAF4",
    backgroundColor: "#F8FBFF",
    padding: 16,
    gap: 8,
  },
  metricIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#DBEAFE",
  },
  metricLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    color: "#64748B",
  },
  metricValue: {
    fontFamily: "Inter_700Bold",
    fontSize: 24,
    color: "#0F172A",
  },
  metricHint: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: "#64748B",
  },
  actionTile: {
    minHeight: 132,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#E5EAF4",
    backgroundColor: "#FFFFFF",
    padding: 16,
    gap: 10,
    justifyContent: "space-between",
  },
  actionTileActive: {
    borderColor: "#BFDBFE",
    backgroundColor: "#EFF6FF",
  },
  actionTileIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#DBEAFE",
  },
  actionTileIconActive: {
    backgroundColor: "#DBEAFE",
  },
  actionTileLabel: {
    fontFamily: "Inter_700Bold",
    fontSize: 15,
    color: "#0F172A",
  },
  actionTileDescription: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    lineHeight: 18,
    color: "#64748B",
  },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  listRow: {
    minHeight: 56,
    borderBottomWidth: 1,
    borderBottomColor: "#EEF2F7",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 4,
  },
  listRowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  listRowIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EFF6FF",
  },
  listRowLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 16,
    color: "#0F172A",
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignSelf: "flex-start",
  },
  badgeLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
  },
  button: {
    minHeight: 46,
    paddingHorizontal: 16,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  buttonLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },
  pill: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: "#E5EAF4",
    backgroundColor: "#FFFFFF",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  pillActive: {
    backgroundColor: "#2563EB",
    borderColor: "#2563EB",
  },
  pillLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    color: "#475569",
  },
  pillLabelActive: {
    color: "#EFF6FF",
  },
  emptyCard: {
    alignItems: "flex-start",
  },
  emptyTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 16,
    color: "#0F172A",
  },
  emptyBody: {
    marginTop: 8,
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    lineHeight: 21,
    color: "#64748B",
  },
  skeleton: {
    borderRadius: 18,
    backgroundColor: "#E9EEF8",
  },
  toast: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    shadowColor: "#0F172A",
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  toastText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    color: "#0F172A",
  },
  label: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
    color: "#475569",
    marginBottom: 8,
  },
});

const buttonTone = {
  primary: StyleSheet.create({
    container: {
      backgroundColor: "#2563EB",
      borderWidth: 1,
      borderColor: "#2563EB",
    },
    text: {
      color: "#FFFFFF",
    },
  }),
  secondary: StyleSheet.create({
    container: {
      backgroundColor: "#FFFFFF",
      borderWidth: 1,
      borderColor: "#D7E2F2",
    },
    text: {
      color: "#2563EB",
    },
  }),
  danger: StyleSheet.create({
    container: {
      backgroundColor: "#FFFFFF",
      borderWidth: 1,
      borderColor: "#FECACA",
    },
    text: {
      color: "#DC2626",
    },
  }),
  ghost: StyleSheet.create({
    container: {
      backgroundColor: "#EFF6FF",
      borderWidth: 1,
      borderColor: "#DBEAFE",
    },
    text: {
      color: "#1D4ED8",
    },
  }),
};

const badgeTone = StyleSheet.create({
  default: { backgroundColor: "#F1F5F9" },
  info: { backgroundColor: "#DBEAFE" },
  success: { backgroundColor: "#DCFCE7" },
  warning: { backgroundColor: "#FEF3C7" },
  danger: { backgroundColor: "#FEE2E2" },
});

const badgeLabelTone = StyleSheet.create({
  default: { color: "#475569" },
  info: { color: "#1D4ED8" },
  success: { color: "#15803D" },
  warning: { color: "#B45309" },
  danger: { color: "#B91C1C" },
});

const toastTone = StyleSheet.create({
  success: { backgroundColor: "#DCFCE7" },
  danger: { backgroundColor: "#FEE2E2" },
  info: { backgroundColor: "#DBEAFE" },
});
