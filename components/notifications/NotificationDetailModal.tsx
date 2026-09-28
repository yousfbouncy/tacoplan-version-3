import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";
import NotificationActionButton from "@/components/notifications/NotificationActionButton";
import { openNotificationUrl } from "@/lib/notification-links";

type Props = {
  visible: boolean;
  title: string;
  body: string;
  buttonText?: string | null;
  buttonUrl?: string | null;
  onClose: () => void;
};

export default function NotificationDetailModal({
  visible,
  title,
  body,
  buttonText,
  buttonUrl,
  onClose,
}: Props) {
  const hasAction = !!buttonText && !!buttonUrl;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>{title || "Notificación"}</Text>
          <Text style={styles.body}>{body || ""}</Text>

          <View style={styles.actions}>
            <Pressable style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.9 }]} onPress={onClose}>
              <Text style={styles.secondaryBtnText}>Cerrar</Text>
            </Pressable>
            {hasAction ? (
              <NotificationActionButton
                label={buttonText!}
                onPress={async () => {
                  const opened = await openNotificationUrl(buttonUrl);
                  if (opened) onClose();
                }}
              />
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 24,
    width: "100%",
    maxWidth: 420,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  title: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    color: Colors.light.text,
    marginBottom: 10,
  },
  body: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: "#374151",
    lineHeight: 20,
    marginBottom: 18,
  },
  actions: {
    gap: 10,
  },
  secondaryBtn: {
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  secondaryBtnText: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
    color: Colors.light.textSecondary,
  },
});
