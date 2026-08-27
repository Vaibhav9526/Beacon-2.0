import { ColorSchemeName } from "react-native";

export const light = {
  primary: "#F26F4C",
  onPrimary: "#FFFFFF",
  secondary: "#087F73",
  onSecondary: "#FFFFFF",
  secondaryContainer: "#DFF2ED",
  onSecondaryContainer: "#07594F",
  background: "#F6F5EF",
  surface: "#FFFEFA",
  surfaceVariant: "#EEF1EC",
  onSurface: "#102B42",
  onSurfaceVariant: "#63727B",
  outline: "#C8D0CB",
  amber: "#C97817",
  amberContainer: "#FFF0D8",
  error: "#D9474C",
  errorContainer: "#FBE4E0",
  onErrorContainer: "#772D2B",
  trustNavy: "#0B2B42",
  peach: "#F8B89E",
  peachSoft: "#FFF0E9",
  scrim: "rgba(5,24,37,.58)",
};

export const dark = {
  ...light,
  primary: "#FFAB91",
  onPrimary: "#5B1908",
  secondary: "#65D7C4",
  onSecondary: "#073B35",
  secondaryContainer: "#174D47",
  onSecondaryContainer: "#C5F4EA",
  background: "#0C1C27",
  surface: "#132934",
  surfaceVariant: "#1A323D",
  onSurface: "#EDF3F1",
  onSurfaceVariant: "#B6C3C6",
  outline: "#3D5158",
  amber: "#F2B75D",
  amberContainer: "#513A18",
  error: "#FFB4AD",
  errorContainer: "#6D2927",
  onErrorContainer: "#FFDAD6",
  trustNavy: "#B9D9E5",
  peach: "#7A3828",
  peachSoft: "#38251F",
  scrim: "rgba(0,0,0,.68)",
};

export type Theme = typeof light;
export const themeFor = (scheme: ColorSchemeName): Theme => scheme === "dark" ? dark : light;

export const type = {
  displayLarge: { fontSize: 40, lineHeight: 44, fontWeight: "700" as const, letterSpacing: -1 },
  headlineLarge: { fontSize: 30, lineHeight: 36, fontWeight: "700" as const, letterSpacing: -.4 },
  headlineSmall: { fontSize: 24, lineHeight: 30, fontWeight: "700" as const },
  titleLarge: { fontSize: 20, lineHeight: 26, fontWeight: "700" as const },
  titleMedium: { fontSize: 16, lineHeight: 22, fontWeight: "700" as const },
  bodyLarge: { fontSize: 16, lineHeight: 24, fontWeight: "400" as const },
  bodyMedium: { fontSize: 14, lineHeight: 20, fontWeight: "400" as const },
  bodySmall: { fontSize: 12, lineHeight: 17, fontWeight: "400" as const },
  labelLarge: { fontSize: 14, lineHeight: 20, fontWeight: "700" as const },
  labelMedium: { fontSize: 12, lineHeight: 16, fontWeight: "700" as const },
  labelSmall: { fontSize: 11, lineHeight: 16, fontWeight: "700" as const },
};
