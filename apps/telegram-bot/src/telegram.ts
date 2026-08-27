import type { TelegramPort, TelegramUpdate } from "./types.js";

type TelegramResponse<T> = { ok: boolean; result?: T; description?: string };

export class TelegramClient implements TelegramPort {
  constructor(private readonly token: string) {}

  private async call<T>(method: string, body: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
    const response = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    const json = await response.json() as TelegramResponse<T>;
    if (!response.ok || !json.ok) throw new Error(`Telegram ${method} failed: ${json.description || response.status}`);
    return json.result as T;
  }

  sendMessage(chatId: number, text: string, options: Record<string, unknown> = {}) {
    return this.call("sendMessage", { chat_id: chatId, text: text.slice(0, 4096), ...options });
  }

  answerCallbackQuery(id: string, text?: string) {
    return this.call("answerCallbackQuery", { callback_query_id: id, ...(text ? { text } : {}) });
  }

  getUpdates(offset: number, signal?: AbortSignal) {
    return this.call<TelegramUpdate[]>("getUpdates", {
      offset,
      timeout: 25,
      allowed_updates: ["message", "edited_message", "callback_query"],
    }, signal);
  }

  setCommands(commands: Array<{ command: string; description: string }>) {
    return this.call<boolean>("setMyCommands", { commands });
  }

  deleteWebhook() {
    return this.call<boolean>("deleteWebhook", { drop_pending_updates: false });
  }

  getMe() {
    return this.call<{ id: number; username: string; first_name: string }>("getMe");
  }

  async getFile(fileId: string) {
    const file = await this.call<{ file_path: string }>("getFile", { file_id: fileId });
    const response = await fetch(`https://api.telegram.org/file/bot${this.token}/${file.file_path}`, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`Telegram file download failed: HTTP ${response.status}`);
    return { bytes: new Uint8Array(await response.arrayBuffer()), filePath: file.file_path };
  }
}
