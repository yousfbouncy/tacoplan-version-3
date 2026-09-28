import { Pressable, StyleSheet, Text } from "react-native";
import Colors from "@/constants/colors";

type Props = {
  label: string;
  onPress: () => void;
};

export default function NotificationActionButton({ label, onPress }: Props) {
  return (
    <Pressable style={({ pressed }) => [styles.button, pressed && { opacity: 0.9 }]} onPress={onPress}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: Colors.light.tint,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  buttonText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: "#FFFFFF",
  },
});
