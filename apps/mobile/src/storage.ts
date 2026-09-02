import AsyncStorage from "@react-native-async-storage/async-storage";
import { Citizen, ContextPayload, QueueItem } from "./types";

const KEYS = { citizen: "beacon.citizen.v2", device: "beacon.device.v1", context: "beacon.context.v2", queue: "beacon.outbox.v2", lastReport: "beacon.last-report.v1" };

export type StoredReportReceipt = {
  status: "sent" | "queued";
  reportId?: string;
  updatedAt: string;
};

export async function readCitizen() {
  const value = await AsyncStorage.getItem(KEYS.citizen);
  return value ? JSON.parse(value) as Citizen : null;
}
export async function writeCitizen(value: Citizen | null) {
  if (value) await AsyncStorage.setItem(KEYS.citizen, JSON.stringify(value));
  else await AsyncStorage.removeItem(KEYS.citizen);
}
export async function getDeviceId() {
  const saved = await AsyncStorage.getItem(KEYS.device);
  if (saved) return saved;
  const value = `android-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  await AsyncStorage.setItem(KEYS.device, value);
  return value;
}
export async function readContext() {
  const value = await AsyncStorage.getItem(KEYS.context);
  return value ? JSON.parse(value) as ContextPayload : null;
}
export async function writeContext(value: ContextPayload) { await AsyncStorage.setItem(KEYS.context, JSON.stringify(value)); }
export async function readQueue() {
  const value = await AsyncStorage.getItem(KEYS.queue);
  return value ? JSON.parse(value) as QueueItem[] : [];
}
export async function writeQueue(value: QueueItem[]) { await AsyncStorage.setItem(KEYS.queue, JSON.stringify(value)); }
export async function enqueue(item: QueueItem) {
  const queue = await readQueue();
  queue.push(item);
  await writeQueue(queue);
  return queue.length;
}
export async function readLastReport() {
  const value = await AsyncStorage.getItem(KEYS.lastReport);
  return value ? JSON.parse(value) as StoredReportReceipt : null;
}
export async function writeLastReport(value: StoredReportReceipt | null) {
  if (value) await AsyncStorage.setItem(KEYS.lastReport, JSON.stringify(value));
  else await AsyncStorage.removeItem(KEYS.lastReport);
}
