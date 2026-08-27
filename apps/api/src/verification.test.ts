import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

describe("external claim verification", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("GOOGLE_FACT_CHECK_API_KEY", "test-fact-check-key");
    vi.stubEnv("VERIFICATION_TIMEOUT_MS", "1000");
    vi.stubEnv("VERIFICATION_MAX_SOURCES", "8");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("marks a claim contradicted from a published fact-check and retains clickable provenance", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.hostname === "factchecktools.googleapis.com") {
        expect(url.searchParams.get("query")).toBe("Dam gates have collapsed near Raipur");
        expect(url.searchParams.get("key")).toBe("test-fact-check-key");
        return jsonResponse({
          claims: [{
            text: "Dam gates have collapsed near Raipur",
            claimReview: [{
              title: "Old flood video is being shared with a false caption",
              url: "https://fact.example/review/old-video",
              textualRating: "False",
              reviewDate: "2026-08-20T10:00:00Z",
              publisher: { name: "Example Fact Check" },
            }],
          }],
        });
      }
      if (url.hostname === "api.gdeltproject.org") {
        expect(url.searchParams.get("mode")).toBe("artlist");
        return jsonResponse({ articles: [{
          title: "Officials reject dam collapse rumour",
          url: "https://news.example/raipur-dam",
          domain: "news.example",
          seendate: "20260820T120000Z",
        }] });
      }
      throw new Error(`Unexpected URL: ${url}`);
    }));

    const { verifyClaim } = await import("./verification.js");
    const result = await verifyClaim("Dam gates have collapsed near Raipur");

    expect(result.verdict).toBe("Contradicted");
    expect(result.status).toBe("complete");
    expect(result.human_review_required).toBe(true);
    expect(result.summary).toContain("1 published fact-check");
    expect(result.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "fact-check",
        url: "https://fact.example/review/old-video",
        publisher: "Example Fact Check",
        rating: "False",
      }),
      expect.objectContaining({ kind: "news", url: "https://news.example/raipur-dam" }),
    ]));
    expect(result.providers).toEqual(["Google Fact Check Tools", "GDELT DOC 2.0"]);
  });

  it("describes multi-publisher news as corroborating coverage, never proof", async () => {
    vi.stubEnv("GOOGLE_FACT_CHECK_API_KEY", "");
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ articles: [
      { title: "Coverage A", url: "https://one.example/a", domain: "one.example" },
      { title: "Coverage B", url: "https://two.example/b", domain: "two.example" },
    ] })));

    const { verifyClaim } = await import("./verification.js");
    const result = await verifyClaim("River level has crossed the warning mark");

    expect(result.verdict).toBe("Corroborating coverage");
    expect(result.summary).toContain("corroboration, not proof");
    expect(result.human_review_required).toBe(true);
    expect(result.providers).toContain("google-fact-check:not-configured");
  });

  it("fails safely with an unavailable advisory when every configured provider fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("provider offline"); }));

    const { verifyClaim } = await import("./verification.js");
    const result = await verifyClaim("Unconfirmed emergency report");

    expect(result.status).toBe("unavailable");
    expect(result.verdict).toBe("Insufficient external evidence");
    expect(result.sources).toEqual([]);
    expect(result.errors).toHaveLength(2);
    expect(result.human_review_required).toBe(true);
  });
});
