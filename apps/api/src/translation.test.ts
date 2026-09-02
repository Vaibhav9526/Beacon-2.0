import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("BHASHINI translation adapter", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("BHASHINI_COMPUTE_URL", "https://bhashini.example/compute");
    vi.stubEnv("BHASHINI_COMPUTE_AUTH_NAME", "Authorization");
    vi.stubEnv("BHASHINI_COMPUTE_AUTH_VALUE", "test-token");
    vi.stubEnv("BHASHINI_NMT_SERVICE_ID", "test-nmt-service");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("returns same-language content locally without contacting a provider", async () => {
    const provider = vi.fn();
    vi.stubGlobal("fetch", provider);
    const { translateText } = await import("./translation.js");

    const result = await translateText("Keep this original", "en", "en");

    expect(result).toMatchObject({ text: "Keep this original", provider: "original", available: true });
    expect(provider).not.toHaveBeenCalled();
  });

  it("maps Chhattisgarhi to the configured Hindi-compatible provider code", async () => {
    const provider = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ Authorization: "test-token" });
      const body = JSON.parse(String(init?.body));
      expect(body.pipelineTasks[0]).toMatchObject({
        taskType: "translation",
        config: {
          language: { sourceLanguage: "hi", targetLanguage: "en" },
          serviceId: "test-nmt-service",
        },
      });
      expect(body.inputData.input[0].source).toBe("मदद चाही");
      return new Response(JSON.stringify({ pipelineResponse: [{ output: [{ target: "Help is needed" }] }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", provider);
    const { translateText } = await import("./translation.js");

    const result = await translateText("मदद चाही", "hne", "en");

    expect(result).toMatchObject({
      text: "Help is needed",
      source_language: "hne",
      target_language: "en",
      provider: "BHASHINI/test-nmt-service",
      available: true,
    });
    expect(provider).toHaveBeenCalledOnce();
  });

  it("retains original-language safety content when BHASHINI fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 503 })));
    const { translateText } = await import("./translation.js");

    const result = await translateText("बाढ़ का पानी बढ़ रहा है", "hi", "en");

    expect(result.text).toBe("बाढ़ का पानी बढ़ रहा है");
    expect(result.available).toBe(false);
    expect(result.provider).toBe("original-retained/BHASHINI-failed");
    expect(result.error).toBe("HTTP 503");
  });

  it("uses a language-aware fallback instead of labeling Hindi as Chhattisgarhi", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    vi.stubEnv("GROQ_API_KEY", "");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");
    const provider = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toContain("generativelanguage.googleapis.com");
      const body = JSON.parse(String(init?.body));
      expect(body.contents[0].parts[0].text).toContain("Chhattisgarhi (hne)");
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ translated_text: "\u092a\u093e\u0938 \u0915\u0947 \u0938\u0941\u0930\u0915\u094d\u0937\u093f\u0924 \u091c\u0917\u0939 \u092e\u0902 \u091c\u093e\u0935" }) }] } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", provider);
    const { translateText } = await import("./translation.js");

    const result = await translateText("Move to the nearest safe place", "en", "hne", { aiFallback: true });

    expect(result).toMatchObject({ target_language: "hne", provider: "gemini/gemini-3.5-flash-lite", available: true });
    expect(result.text).not.toBe("Move to the nearest safe place");
    expect(provider).toHaveBeenCalledOnce();
  });
});
