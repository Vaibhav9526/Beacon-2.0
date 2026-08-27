export type Language = "en" | "hi" | "hne" | "bn" | "mr" | "gu" | "pa" | "ta" | "te" | "kn" | "ml" | "or";

export type TelegramFile = {
  fileId: string;
  fileUniqueId: string;
  fileName: string;
  mimeType: string;
  bytes?: number;
};

export type ReportDraft = {
  hazardType?: string;
  severity?: string;
  text?: string;
  requestedHelp?: string;
  latitude?: number;
  longitude?: number;
  media: TelegramFile[];
};

export type BotStep =
  | "idle"
  | "language"
  | "name"
  | "phone"
  | "report_hazard"
  | "report_severity"
  | "report_text"
  | "report_help"
  | "report_location"
  | "report_attachments"
  | "sos_location"
  | "sos_confirm";

export type BotSession = {
  chatId: number;
  telegramUserId?: number;
  language: Language;
  step: BotStep;
  name?: string;
  phone?: string;
  citizenId?: string;
  token?: string;
  lastLocation?: { latitude: number; longitude: number };
  report?: ReportDraft;
  pendingSos?: { latitude: number; longitude: number };
};

export type TelegramMessage = {
  message_id: number;
  chat: { id: number; type: string };
  from?: { id: number; first_name: string; last_name?: string; username?: string };
  text?: string;
  caption?: string;
  contact?: { phone_number: string; first_name: string; user_id?: number };
  location?: { latitude: number; longitude: number; live_period?: number };
  photo?: Array<{ file_id: string; file_unique_id: string; file_size?: number; width: number; height: number }>;
  video?: { file_id: string; file_unique_id: string; file_name?: string; mime_type?: string; file_size?: number };
  audio?: { file_id: string; file_unique_id: string; file_name?: string; mime_type?: string; file_size?: number };
  voice?: { file_id: string; file_unique_id: string; mime_type?: string; file_size?: number };
  document?: { file_id: string; file_unique_id: string; file_name?: string; mime_type?: string; file_size?: number };
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: {
    id: string;
    from: { id: number; first_name: string };
    data?: string;
    message?: TelegramMessage;
  };
};

export interface SessionStore {
  get(chatId: number): Promise<BotSession | null>;
  set(session: BotSession): Promise<void>;
  delete(chatId: number): Promise<void>;
  all(): Promise<BotSession[]>;
}

export interface TelegramPort {
  sendMessage(chatId: number, text: string, options?: Record<string, unknown>): Promise<unknown>;
  answerCallbackQuery(id: string, text?: string): Promise<unknown>;
  getFile(fileId: string): Promise<{ bytes: Uint8Array; filePath: string }>;
}

export interface BeaconPort {
  register(input: { name: string; phone: string; language: Language; deviceId: string }): Promise<any>;
  context(location?: { latitude: number; longitude: number }): Promise<any>;
  submitReport(session: BotSession, draft: ReportDraft, files: Array<{ bytes: Uint8Array; name: string; mime: string }>): Promise<any>;
  activeSos(token: string): Promise<any>;
  createSos(session: BotSession, location: { latitude: number; longitude: number }): Promise<any>;
  updateSos(token: string, sosId: string, location: { latitude: number; longitude: number }): Promise<any>;
  cancelSos(token: string, sosId: string): Promise<any>;
  communities(): Promise<any[]>;
  sendCommunityMessage(token: string, communityId: string, body: string): Promise<any>;
  translate(text: string, sourceLanguage: Language, targetLanguage: Language): Promise<{ text: string; available: boolean; provider: string }>;
}
