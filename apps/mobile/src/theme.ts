import { ColorSchemeName, Platform } from "react-native";

export const light = {
  primary: "#07133F",
  weatherBand: "#07133F",
  onPrimary: "#FFFFFF",
  action: "#2439C9",
  actionContainer: "#E2E8FF",
  secondary: "#526FDE",
  onSecondary: "#FFFFFF",
  secondaryContainer: "#E8EEFF",
  onSecondaryContainer: "#11266F",
  background: "#F6F8FC",
  surface: "#FFFFFF",
  surfaceVariant: "#EDF2F9",
  onSurface: "#07133F",
  onSurfaceVariant: "#60708F",
  outline: "#D6DFED",
  amber: "#9A6700",
  amberContainer: "#FFF1C9",
  error: "#C52E42",
  errorContainer: "#FCE4E8",
  onErrorContainer: "#711727",
  trustNavy: "#07133F",
  peachSoft: "#DDEBFA",
  scrim: "rgba(5,12,38,.72)",
};

export const dark = {
  ...light,
  primary: "#A6C9EE",
  weatherBand: "#101E50",
  onPrimary: "#FFFFFF",
  action: "#728EED",
  actionContainer: "#17245E",
  secondary: "#8FAAF6",
  onSecondary: "#07133F",
  secondaryContainer: "#152456",
  onSecondaryContainer: "#DDE8FF",
  background: "#050A1F",
  surface: "#0B1538",
  surfaceVariant: "#121F49",
  onSurface: "#F5F8FF",
  onSurfaceVariant: "#B6C3DE",
  outline: "#2A3967",
  amber: "#F0C34B",
  amberContainer: "#493B16",
  error: "#FFB4AD",
  errorContainer: "#6D2927",
  onErrorContainer: "#FFDAD6",
  trustNavy: "#DDE8FF",
  peachSoft: "#152456",
  scrim: "rgba(0,0,0,.68)",
};

export type Theme = typeof light;
export const themeFor = (scheme: ColorSchemeName): Theme => scheme === "dark" ? dark : light;

const arial = Platform.select({ ios: "Arial", android: "sans-serif", default: "Arial" });
const face = { fontFamily: arial };

export const type = {
  displayLarge: { ...face, fontSize: 32, lineHeight: 37, fontWeight: "700" as const, letterSpacing: -.7 },
  headlineLarge: { ...face, fontSize: 25, lineHeight: 30, fontWeight: "700" as const, letterSpacing: -.3 },
  headlineSmall: { ...face, fontSize: 21, lineHeight: 26, fontWeight: "700" as const },
  titleLarge: { ...face, fontSize: 18, lineHeight: 23, fontWeight: "700" as const },
  titleMedium: { ...face, fontSize: 15, lineHeight: 20, fontWeight: "700" as const },
  bodyLarge: { ...face, fontSize: 15, lineHeight: 22, fontWeight: "400" as const },
  bodyMedium: { ...face, fontSize: 13, lineHeight: 19, fontWeight: "400" as const },
  bodySmall: { ...face, fontSize: 11, lineHeight: 16, fontWeight: "400" as const },
  labelLarge: { ...face, fontSize: 13, lineHeight: 18, fontWeight: "700" as const },
  labelMedium: { ...face, fontSize: 11, lineHeight: 15, fontWeight: "700" as const },
  labelSmall: { ...face, fontSize: 10, lineHeight: 14, fontWeight: "700" as const },
};
