export type Language =
  | "en"
  | "hi"
  | "hne"
  | "bn"
  | "mr"
  | "gu"
  | "pa"
  | "ta"
  | "te"
  | "kn"
  | "ml"
  | "or";
export type Tab = "home" | "alerts" | "community" | "profile";
export type ConnectionState = "connecting" | "live" | "offline";

export type Coordinate = { latitude: number; longitude: number };

export type Citizen = {
  id: string;
  name: string;
  phone: string;
  language: Language;
  device_id?: string;
  session_token?: string;
};

export type Weather = {
  temperature: number | string;
  wind_speed?: number;
  precipitation?: number;
  risk: string;
  source: string;
  observed_at?: string;
};

export type AlertItem = {
  id: string;
  title: string;
  body: string;
  severity: string;
  status: string;
  published_at?: string;
  expires_at?: string;
};

export type IncidentMarker = Coordinate & {
  id: string;
  title: string;
  approximate_area: string;
  severity: string;
  trust_state: "Unverified" | "Corroborated";
  report_count?: number;
};

export type Facility = Coordinate & {
  id: string;
  name: string;
  kind: "hospital" | "shelter" | string;
  capacity?: number;
  approximate_area?: string;
};

export type CommunityMessage = {
  id: string;
  sender_name: string;
  sender_role: string;
  body: string;
  official: boolean;
  created_at?: string;
};

export type Community = {
  id: string;
  name: string;
  radius_km: number;
  member_count: number;
  approved: boolean;
  messages: CommunityMessage[];
};

export type ContextPayload = {
  weather: Weather;
  facilities: Facility[];
  alerts: AlertItem[];
  unverified: IncidentMarker[];
  verified?: IncidentMarker[];
};

export type SosRequest = Coordinate & {
  id: string;
  status: string;
  note?: string;
  eta_minutes?: number;
};

export type MediaAttachment = {
  uri: string;
  name: string;
  mimeType: string;
  kind: "photo" | "video" | "audio";
};

export type ReportDraft = {
  hazard_type: string;
  severity: string;
  text: string;
  requested_help: string;
  coordinate: Coordinate;
  locationMode: "gps" | "manual";
  attachments: MediaAttachment[];
};

export type QueueItem =
  | {
      id: string;
      kind: "report";
      payload: ReportDraft & { citizen_id: string };
      createdAt: string;
      attempts: number;
    }
  | {
      id: string;
      kind: "sos";
      payload: Coordinate & { citizen_id: string; note: string };
      createdAt: string;
      attempts: number;
    }
  | {
      id: string;
      kind: "community";
      payload: { communityId: string; citizen_id: string; body: string };
      createdAt: string;
      attempts: number;
    };
