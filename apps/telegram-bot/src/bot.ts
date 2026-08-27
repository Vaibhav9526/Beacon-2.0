import { isLanguage, LANGUAGE_OPTIONS, t } from "./i18n.js";
import type { BeaconPort, BotSession, ReportDraft, SessionStore, TelegramFile, TelegramMessage, TelegramPort, TelegramUpdate } from "./types.js";

const MAX_MEDIA = 4;
const MAX_MEDIA_BYTES = 10_000_000;
const commandKeyboard = {
  keyboard: [[{ text: "/report" }, { text: "/sos" }], [{ text: "/alerts" }, { text: "/facilities" }], [{ text: "/conditions" }, { text: "/status" }]],
  resize_keyboard: true,
};
const locationKeyboard = { keyboard: [[{ text: "Share location", request_location: true }], [{ text: "/cancel" }]], resize_keyboard: true, one_time_keyboard: true };
const phoneKeyboard = { keyboard: [[{ text: "Share phone number", request_contact: true }], [{ text: "/cancel" }]], resize_keyboard: true, one_time_keyboard: true };
const inline = (rows: Array<Array<{ text: string; callback_data: string }>>) => ({ inline_keyboard: rows });
const languageKeyboard = () => inline(Array.from({ length: Math.ceil(LANGUAGE_OPTIONS.length / 2) }, (_, index) =>
  LANGUAGE_OPTIONS.slice(index * 2, index * 2 + 2).map((language) => ({ text: language.label, callback_data: `lang:${language.code}` })),
));

function newSession(chatId: number, telegramUserId?: number): BotSession {
  return { chatId, telegramUserId, language: "en", step: "language" };
}

function normalizePhone(value: string) {
  const number = value.replace(/[^0-9]/g, "");
  return /^\d{10,15}$/.test(number) ? number : null;
}

function mediaFrom(message: TelegramMessage): TelegramFile | null {
  if (message.photo?.length) {
    const item = message.photo.at(-1)!;
    return { fileId: item.file_id, fileUniqueId: item.file_unique_id, fileName: `telegram-${item.file_unique_id}.jpg`, mimeType: "image/jpeg", bytes: item.file_size };
  }
  if (message.video) return { fileId: message.video.file_id, fileUniqueId: message.video.file_unique_id, fileName: message.video.file_name || `telegram-${message.video.file_unique_id}.mp4`, mimeType: message.video.mime_type || "video/mp4", bytes: message.video.file_size };
  if (message.audio) return { fileId: message.audio.file_id, fileUniqueId: message.audio.file_unique_id, fileName: message.audio.file_name || `telegram-${message.audio.file_unique_id}.mp3`, mimeType: message.audio.mime_type || "audio/mpeg", bytes: message.audio.file_size };
  if (message.voice) return { fileId: message.voice.file_id, fileUniqueId: message.voice.file_unique_id, fileName: `telegram-${message.voice.file_unique_id}.ogg`, mimeType: message.voice.mime_type || "audio/ogg", bytes: message.voice.file_size };
  if (message.document) return { fileId: message.document.file_id, fileUniqueId: message.document.file_unique_id, fileName: message.document.file_name || `telegram-${message.document.file_unique_id}`, mimeType: message.document.mime_type || "application/octet-stream", bytes: message.document.file_size };
  return null;
}

const titleCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
const formatDate = (value?: string) => value ? new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }) : "Not available";

export class BeaconTelegramBot {
  constructor(private readonly telegram: TelegramPort, private readonly beacon: BeaconPort, private readonly store: SessionStore) {}

  async handle(update: TelegramUpdate) {
    if (update.callback_query?.message && update.callback_query.data) {
      await this.handleCallback(update.callback_query.message.chat.id, update.callback_query.id, update.callback_query.data, update.callback_query.from.id);
      return;
    }
    const message = update.message || update.edited_message;
    if (message?.chat.type === "private") await this.handleMessage(message);
  }

  private async session(chatId: number, userId?: number) {
    return await this.store.get(chatId) || newSession(chatId, userId);
  }

  private async save(session: BotSession) { await this.store.set(session); }

  private async requireRegistered(session: BotSession) {
    if (session.citizenId && session.token && session.name && session.phone) return true;
    await this.telegram.sendMessage(session.chatId, t(session.language, "needRegistration"));
    return false;
  }

  private async renew(session: BotSession) {
    if (!session.name || !session.phone) return session;
    const result = await this.beacon.register({ name: session.name, phone: session.phone, language: session.language, deviceId: `telegram:${session.chatId}` });
    session.citizenId = result.citizen.id;
    session.token = result.token;
    await this.save(session);
    return session;
  }

  private async start(session: BotSession) {
    if (session.name && session.phone) {
      await this.renew(session);
      session.step = "idle";
      await this.save(session);
      await this.telegram.sendMessage(session.chatId, `🛡️ ${t(session.language, "welcome")}`, { reply_markup: commandKeyboard });
      return;
    }
    session.step = "language";
    await this.save(session);
    await this.telegram.sendMessage(session.chatId, `🗼 BEACON\n\n${t(session.language, "chooseLanguage")}`, { reply_markup: languageKeyboard() });
  }

  private async handleMessage(message: TelegramMessage) {
    const session = await this.session(message.chat.id, message.from?.id);
    const text = (message.text || message.caption || "").trim();
    const command = text.startsWith("/") ? text.split(/\s+/)[0].split("@")[0].toLowerCase() : "";

    if (command === "/start") return this.start(session);
    if (command === "/cancel") {
      session.step = "idle"; session.report = undefined; session.pendingSos = undefined;
      await this.save(session);
      return this.telegram.sendMessage(session.chatId, t(session.language, "cancelled"), { reply_markup: commandKeyboard });
    }
    if (command === "/help") return this.help(session);
    if (command === "/language") {
      session.step = "language"; await this.save(session);
      return this.telegram.sendMessage(session.chatId, t(session.language, "chooseLanguage"), { reply_markup: languageKeyboard() });
    }

    if (session.step === "name" && text) {
      session.name = text.slice(0, 80); session.step = "phone"; await this.save(session);
      return this.telegram.sendMessage(session.chatId, t(session.language, "askPhone"), { reply_markup: phoneKeyboard });
    }
    if (session.step === "phone") {
      const phone = normalizePhone(message.contact?.phone_number || text);
      if (!phone) return this.telegram.sendMessage(session.chatId, t(session.language, "invalidPhone"), { reply_markup: phoneKeyboard });
      if (message.contact?.user_id && message.from?.id && message.contact.user_id !== message.from.id) return this.telegram.sendMessage(session.chatId, "For safety, share your own Telegram contact.");
      session.phone = phone;
      await this.renew(session); session.step = "idle"; await this.save(session);
      return this.telegram.sendMessage(session.chatId, `✅ ${t(session.language, "registered")}\n\n${t(session.language, "welcome")}`, { reply_markup: commandKeyboard });
    }

    if (!(await this.requireRegistered(session))) return;

    if (command === "/conditions") return this.conditions(session);
    if (command === "/alerts") return this.alerts(session);
    if (command === "/facilities") return this.facilities(session);
    if (command === "/report") return this.beginReport(session);
    if (command === "/submit") return this.submitReport(session);
    if (command === "/sos") return this.beginSos(session);
    if (command === "/status") return this.status(session);
    if (command === "/cancel_sos") return this.cancelSos(session);
    if (command === "/community") return this.communities(session);
    if (command === "/message") return this.communityMessage(session, text);

    if (message.location) return this.handleLocation(session, message.location);

    const media = mediaFrom(message);
    if (media) return this.handleMedia(session, media);

    if (session.step === "report_text" && text) {
      session.report!.text = text.slice(0, 4000); session.step = "report_help"; await this.save(session);
      return this.telegram.sendMessage(session.chatId, t(session.language, "askHelp"));
    }
    if (session.step === "report_help" && text) {
      session.report!.requestedHelp = text === "-" ? "" : text.slice(0, 500); session.step = "report_location"; await this.save(session);
      return this.telegram.sendMessage(session.chatId, t(session.language, "askLocation"), { reply_markup: locationKeyboard });
    }

    await this.telegram.sendMessage(session.chatId, t(session.language, "unsupported"), { reply_markup: commandKeyboard });
  }

  private async handleCallback(chatId: number, callbackId: string, data: string, userId: number) {
    const session = await this.session(chatId, userId);
    await this.telegram.answerCallbackQuery(callbackId);
    if (data.startsWith("lang:")) {
      const language = data.slice(5);
      if (!isLanguage(language)) return;
      session.language = language;
      if (session.citizenId && session.name && session.phone) {
        await this.renew(session); session.step = "idle"; await this.save(session);
        return this.telegram.sendMessage(chatId, `✅ ${t(language, "welcome")}`, { reply_markup: commandKeyboard });
      }
      session.step = "name"; await this.save(session);
      return this.telegram.sendMessage(chatId, t(language, "askName"), { reply_markup: { remove_keyboard: true } });
    }
    if (!(await this.requireRegistered(session))) return;
    if (data.startsWith("hazard:") && session.report) {
      session.report.hazardType = data.slice(7); session.step = "report_severity"; await this.save(session);
      return this.telegram.sendMessage(chatId, t(session.language, "chooseSeverity"), { reply_markup: inline([[{ text: "Low", callback_data: "severity:low" }, { text: "Moderate", callback_data: "severity:moderate" }], [{ text: "High", callback_data: "severity:high" }, { text: "Critical", callback_data: "severity:critical" }]]) });
    }
    if (data.startsWith("severity:") && session.report) {
      session.report.severity = data.slice(9); session.step = "report_text"; await this.save(session);
      return this.telegram.sendMessage(chatId, t(session.language, "askReport"));
    }
    if (data === "report:submit") return this.submitReport(session);
    if (data === "report:cancel") {
      session.report = undefined; session.step = "idle"; await this.save(session);
      return this.telegram.sendMessage(chatId, t(session.language, "cancelled"), { reply_markup: commandKeyboard });
    }
    if (data === "sos:confirm") return this.confirmSos(session);
    if (data === "sos:cancel") {
      session.pendingSos = undefined; session.step = "idle"; await this.save(session);
      return this.telegram.sendMessage(chatId, t(session.language, "cancelled"), { reply_markup: commandKeyboard });
    }
    if (data.startsWith("community:")) return this.showCommunity(session, data.slice(10));
  }

  private help(session: BotSession) {
    const help = [
      "🗼 BEACON commands",
      "/conditions — weather and local risk",
      "/alerts — verified official alerts",
      "/facilities — hospitals and shelters",
      "/report — report an incident with media/location",
      "/sos — emergency SOS with confirmation",
      "/status — responder/dispatch progress",
      "/cancel_sos — cancel an accidental active SOS",
      "/community — approved local groups",
      "/message <community-id> <text> — community message",
      "/language — 12 Indian languages",
      "/cancel — cancel the current form",
      "\nOnly authority-verified information is labelled OFFICIAL.",
    ].join("\n");
    return this.telegram.sendMessage(session.chatId, help, { reply_markup: commandKeyboard });
  }

  private async conditions(session: BotSession) {
    const context = await this.beacon.context(session.lastLocation);
    const w = context.weather;
    await this.telegram.sendMessage(session.chatId, `🌦️ CURRENT CONDITIONS\nRisk: ${w.risk}\nTemperature: ${w.temperature ?? "—"}°C\nRain: ${w.precipitation ?? "—"} mm\nWind: ${w.wind_speed ?? "—"} km/h\nSource: ${w.source}\nObserved: ${formatDate(w.observed_at)}`);
  }

  private async alerts(session: BotSession) {
    const context = await this.beacon.context(session.lastLocation);
    if (!context.alerts?.length) return this.telegram.sendMessage(session.chatId, "🛡️ No active official alerts in your area.");
    const body = context.alerts.slice(0, 8).map((a: any) => `🛡️ OFFICIAL · ${String(a.severity).toUpperCase()}\n${a.title}\n${a.body}\nPublished: ${formatDate(a.published_at)}`).join("\n\n");
    await this.telegram.sendMessage(session.chatId, body);
  }

  private async facilities(session: BotSession) {
    const context = await this.beacon.context(session.lastLocation);
    if (!context.facilities?.length) return this.telegram.sendMessage(session.chatId, "No verified facilities are currently listed.");
    const body = context.facilities.slice(0, 10).map((f: any) => `✅ ${f.name} · ${titleCase(f.kind)}${f.capacity ? ` · capacity ${f.capacity}` : ""}\nhttps://maps.google.com/?q=${f.latitude},${f.longitude}`).join("\n\n");
    await this.telegram.sendMessage(session.chatId, `🏥 VERIFIED FACILITIES\n\n${body}`);
  }

  private async beginReport(session: BotSession) {
    session.report = { media: [] }; session.step = "report_hazard"; await this.save(session);
    await this.telegram.sendMessage(session.chatId, t(session.language, "chooseHazard"), { reply_markup: inline([[{ text: "🌊 Flood", callback_data: "hazard:flood" }, { text: "🔥 Fire", callback_data: "hazard:fire" }], [{ text: "🚗 Accident", callback_data: "hazard:accident" }, { text: "🩺 Medical", callback_data: "hazard:medical" }], [{ text: "🏚 Infrastructure", callback_data: "hazard:infrastructure" }, { text: "Other", callback_data: "hazard:other" }]]) });
  }

  private async handleLocation(session: BotSession, location: { latitude: number; longitude: number }) {
    session.lastLocation = location;
    if (session.step === "report_location" && session.report) {
      Object.assign(session.report, location); session.step = "report_attachments"; await this.save(session);
      return this.telegram.sendMessage(session.chatId, t(session.language, "askEvidence"), { reply_markup: inline([[{ text: "✅ Submit report", callback_data: "report:submit" }, { text: "Cancel", callback_data: "report:cancel" }]]) });
    }
    if (session.step === "sos_location") {
      session.pendingSos = location; session.step = "sos_confirm"; await this.save(session);
      return this.telegram.sendMessage(session.chatId, `🚨 ${t(session.language, "sosConfirm")}`, { reply_markup: inline([[{ text: "🚨 Confirm SOS", callback_data: "sos:confirm" }], [{ text: "Cancel", callback_data: "sos:cancel" }]]) });
    }
    const active = await this.withRenew(session, () => this.beacon.activeSos(session.token!));
    if (active.sos) {
      await this.withRenew(session, () => this.beacon.updateSos(session.token!, active.sos.id, location));
      await this.save(session);
      return this.telegram.sendMessage(session.chatId, t(session.language, "locationUpdated"));
    }
    await this.save(session);
    return this.telegram.sendMessage(session.chatId, "Location saved. Use /conditions, /facilities, /report or /sos.", { reply_markup: commandKeyboard });
  }

  private async handleMedia(session: BotSession, media: TelegramFile) {
    if (session.step !== "report_attachments" || !session.report) return this.telegram.sendMessage(session.chatId, "Start /report before sending evidence.");
    if (session.report.media.length >= MAX_MEDIA) return this.telegram.sendMessage(session.chatId, `Maximum ${MAX_MEDIA} evidence files reached. Use /submit.`);
    if (media.bytes && media.bytes > MAX_MEDIA_BYTES) return this.telegram.sendMessage(session.chatId, "That file exceeds BEACON's 10 MB evidence limit.");
    if (!["image/jpeg", "image/png", "image/webp", "audio/mpeg", "audio/mp4", "audio/wav", "audio/x-m4a", "audio/ogg", "video/mp4", "video/quicktime", "video/webm"].includes(media.mimeType)) return this.telegram.sendMessage(session.chatId, "Unsupported evidence format. Send a photo, MP4/WebM video, MP3/M4A/WAV audio or compatible voice note.");
    if (!session.report.media.some((item) => item.fileUniqueId === media.fileUniqueId)) session.report.media.push(media);
    await this.save(session);
    await this.telegram.sendMessage(session.chatId, `📎 ${t(session.language, "evidenceAdded")} (${session.report.media.length}/${MAX_MEDIA}).`, { reply_markup: inline([[{ text: "✅ Submit report", callback_data: "report:submit" }, { text: "Cancel", callback_data: "report:cancel" }]]) });
  }

  private async submitReport(session: BotSession) {
    const draft = session.report;
    if (!draft || !draft.hazardType || !draft.severity || !draft.text || draft.latitude == null || draft.longitude == null) return this.telegram.sendMessage(session.chatId, "Report is incomplete. Use /report to start again.");
    try {
      const files: Array<{ bytes: Uint8Array; name: string; mime: string }> = [];
      for (const media of draft.media) {
        const downloaded = await this.telegram.getFile(media.fileId);
        if (downloaded.bytes.byteLength > MAX_MEDIA_BYTES) throw new Error(`${media.fileName} exceeds 10 MB`);
        files.push({ bytes: downloaded.bytes, name: media.fileName, mime: media.mimeType });
      }
      const result = await this.withRenew(session, () => this.beacon.submitReport(session, draft, files));
      session.report = undefined; session.step = "idle"; await this.save(session);
      await this.telegram.sendMessage(session.chatId, `✅ ${t(session.language, "reportSent")}\nIncident: ${result.incident.id}\nTrust: ${result.incident.trust_state}\nAI: ${result.analysis_meta.provider}\nSummary: ${result.analysis.summary}`, { reply_markup: commandKeyboard });
    } catch (error) {
      await this.telegram.sendMessage(session.chatId, `⚠️ ${t(session.language, "reportFailed")}\n${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  private async beginSos(session: BotSession) {
    session.step = "sos_location"; session.pendingSos = undefined; await this.save(session);
    await this.telegram.sendMessage(session.chatId, `🚨 ${t(session.language, "sosLocation")}`, { reply_markup: locationKeyboard });
  }

  private async confirmSos(session: BotSession) {
    if (!session.pendingSos) return this.telegram.sendMessage(session.chatId, t(session.language, "sosLocation"), { reply_markup: locationKeyboard });
    const sos = await this.withRenew(session, () => this.beacon.createSos(session, session.pendingSos!));
    session.pendingSos = undefined; session.step = "idle"; await this.save(session);
    await this.telegram.sendMessage(session.chatId, `🚨 ${t(session.language, "sosSent")}\nRequest: ${sos.id}\nStatus: ${sos.status}`, { reply_markup: commandKeyboard });
  }

  private async status(session: BotSession) {
    const active = await this.withRenew(session, () => this.beacon.activeSos(session.token!));
    if (!active.sos) return this.telegram.sendMessage(session.chatId, t(session.language, "noSos"));
    const assignment = active.assignment;
    await this.telegram.sendMessage(session.chatId, `🚨 SOS ${active.sos.id}\nStatus: ${assignment?.status || active.sos.status}\nETA: ${assignment?.eta_minutes ? `${assignment.eta_minutes} minutes` : "Awaiting assignment"}\nResponder note: ${assignment?.operational_note || "Control room reviewing request"}`);
  }

  private async cancelSos(session: BotSession) {
    const active = await this.withRenew(session, () => this.beacon.activeSos(session.token!));
    if (!active.sos) return this.telegram.sendMessage(session.chatId, t(session.language, "noSos"));
    await this.withRenew(session, () => this.beacon.cancelSos(session.token!, active.sos.id));
    await this.telegram.sendMessage(session.chatId, t(session.language, "sosCancelled"), { reply_markup: commandKeyboard });
  }

  private async communities(session: BotSession) {
    const communities = await this.beacon.communities();
    if (!communities.length) return this.telegram.sendMessage(session.chatId, "No approved incident communities are currently open.");
    await this.telegram.sendMessage(session.chatId, "👥 APPROVED COMMUNITIES", { reply_markup: inline(communities.slice(0, 8).map((community: any) => [{ text: `${community.name} (${community.member_count || 0})`, callback_data: `community:${community.id}` }])) });
  }

  private async showCommunity(session: BotSession, communityId: string) {
    const communities = await this.beacon.communities();
    const community = communities.find((item: any) => item.id === communityId);
    if (!community) return this.telegram.sendMessage(session.chatId, "That community is no longer available.");
    const messages = (community.messages || []).slice(-8).map((message: any) => `${message.official ? "🛡️ OFFICIAL" : message.sender_name}: ${message.body}`).join("\n\n") || "No messages yet.";
    await this.telegram.sendMessage(session.chatId, `👥 ${community.name}\n\n${messages}\n\nSend: /message ${community.id} your message`);
  }

  private async communityMessage(session: BotSession, text: string) {
    const match = text.match(/^\/message(?:@\w+)?\s+(\S+)\s+([\s\S]{1,1000})$/);
    if (!match) return this.telegram.sendMessage(session.chatId, "Usage: /message <community-id> <message>");
    await this.withRenew(session, () => this.beacon.sendCommunityMessage(session.token!, match[1], match[2]));
    await this.telegram.sendMessage(session.chatId, "✅ Community message sent for the approved group.");
  }

  private async withRenew<T>(session: BotSession, action: () => Promise<T>): Promise<T> {
    try { return await action(); }
    catch (error: any) {
      if (error?.status !== 401) throw error;
      await this.renew(session);
      return action();
    }
  }

  async handleEvent(raw: string) {
    let event: any;
    try { event = JSON.parse(raw); } catch { return; }
    const sessions = (await this.store.all()).filter((session) => session.citizenId && session.token);
    const audience = event.audience || {};
    const targets = audience.kind === "citizen" ? sessions.filter((session) => session.citizenId === audience.citizenId) : audience.kind === "authenticated" ? sessions : [];
    if (!targets.length) return;
    let text: string | null = null;
    if (event.event === "alert.published") text = `🛡️ OFFICIAL ALERT · ${String(event.payload.severity || "").toUpperCase()}\n${event.payload.title}\n${event.payload.body}`;
    if (event.event === "alert.corrected") text = `⚠️ OFFICIAL CORRECTION\n${event.payload.replacement?.title}\n${event.payload.replacement?.body}\nReason: ${event.payload.correction?.reason}`;
    if (event.event === "alert.expired") text = `ℹ️ Official alert expired: ${event.payload.title}`;
    if (event.event === "dispatch.updated") text = `🚑 RESPONDER UPDATE\nStatus: ${event.payload.status}\nETA: ${event.payload.eta_minutes || "—"} minutes\n${event.payload.operational_note || ""}`;
    if (event.event === "sos.updated") text = `🚨 SOS status: ${event.payload.status}`;
    if (event.event === "community.message" && event.payload.official) text = `🛡️ OFFICIAL COMMUNITY MESSAGE\n${event.payload.sender_name}: ${event.payload.body}`;
    if (!text) return;
    await Promise.allSettled(targets.map(async (session) => {
      let delivery = text!;
      if (session.language !== "en") {
        try {
          const translated = await this.beacon.translate(delivery, "en", session.language);
          if (translated.available && translated.text.trim()) delivery = translated.text;
        } catch {
          // Safety messages must still arrive when the translation service is unavailable.
        }
      }
      await this.telegram.sendMessage(session.chatId, delivery);
    }));
  }
}
