import Colors from "./colors";
/** Driver screens use one dark palette; legacy standalone dialogs keep their own theme. */
export const driverPalette = {
  ...Colors.light,
  text: "#F0F6FF", textSecondary: "#A7B8CF",
  background: "#071426", surface: "rgba(17,36,59,0.94)",
  tint: "#70B7FF", primary: "#0867CA", accent: "#F4B84A", accentLight: "#352B19",
  success: "#4BDF9B", warning: "#F4B84A", danger: "#FF7885",
  border: "#293D56", tabIconDefault: "#A7B8CF", tabIconSelected: "#409CFF",
  cardShadow: "rgba(0,0,0,0.3)", infraccion: "#FF7885",
  descansoReducido: "#F4B84A", descansoCompleto: "#4BDF9B",
  descansoSemanal: "#69ACFF", nacional: "#69ACFF", internacional: "#F4B84A",
};
// Compatibility adapter for existing screen styles; calculations do not depend on this palette.
export default { light: driverPalette };
