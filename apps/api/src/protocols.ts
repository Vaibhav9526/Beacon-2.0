export type ProtocolId = keyof typeof FIRST_AID_PROTOCOLS;

export const FIRST_AID_PROTOCOLS = {
  bleeding: {
    title: "Severe bleeding safety steps",
    triggers: ["bleeding", "blood", "cut", "घाव", "खून"],
    steps: ["Call emergency help.", "Apply firm, continuous pressure with clean cloth.", "Keep the person still and warm while help is coming."],
  },
  fire_smoke: {
    title: "Fire and smoke safety steps",
    triggers: ["fire", "smoke", "burn", "आग", "धुआं"],
    steps: ["Move away from smoke and flames using the safest clear route.", "Stay low beneath smoke.", "Cool a minor burn with clean running water; do not apply creams."],
  },
  flood_water: {
    title: "Flood-water safety steps",
    triggers: ["flood", "water", "बाढ़", "पानी"],
    steps: ["Move to higher ground without entering moving water.", "Keep away from electrical lines and flooded equipment.", "Follow verified evacuation directions."],
  },
  unconscious: {
    title: "Unresponsive person safety steps",
    triggers: ["unconscious", "unresponsive", "not breathing", "बेहोश"],
    steps: ["Call emergency help and check for normal breathing.", "If trained and the person is not breathing normally, begin CPR.", "Do not give food or drink."],
  },
} as const;

export function selectProtocol(text: string, suggested?: string | null) {
  const normalized = text.toLowerCase();
  const selected = suggested && suggested in FIRST_AID_PROTOCOLS
    ? suggested as ProtocolId
    : (Object.entries(FIRST_AID_PROTOCOLS).find(([, protocol]) => protocol.triggers.some((trigger) => normalized.includes(trigger)))?.[0] as ProtocolId | undefined);
  if (!selected) return null;
  const protocol = FIRST_AID_PROTOCOLS[selected];
  return { id: selected, title: protocol.title, steps: [...protocol.steps], source: "BEACON approved static protocol" };
}
