import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

const CHANNEL_ID = "beacon-authority";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function prepareNotificationBar() {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: "Authority safety updates",
      description: "Verified alerts and safety instructions from BEACON authorities.",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 150, 250],
      lightColor: "#2439C9",
    });
  }
  const current = await Notifications.getPermissionsAsync();
  const permission = current.granted ? current : await Notifications.requestPermissionsAsync();
  return permission.granted;
}

export async function showAuthorityNotification(input: {
  id?: string;
  title?: string;
  body?: string;
  incident_id?: string;
}) {
  if (!(await prepareNotificationBar())) return false;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: String(input.title || "BEACON authority update").slice(0, 80),
      body: String(input.body || "Open BEACON for verified safety guidance.").slice(0, 500),
      data: { notification_id: input.id || "", incident_id: input.incident_id || "" },
    },
    trigger: Platform.OS === "android" ? { channelId: CHANNEL_ID } : null,
  });
  return true;
}
