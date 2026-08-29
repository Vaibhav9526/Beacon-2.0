import { describe, expect, it, vi } from "vitest";
import { analyzeReport, redactPII } from "./ai.js";

describe("BEACON AI safety gateway", () => {
  it("removes known names, Indian phone numbers, email, and exact coordinate pairs", () => {
    const result = redactPII("Test Citizen at 9876543210 citizen@example.com 21.25140, 81.62960 reports flood water", ["Test Citizen"]);
    expect(result.text).not.toContain("Test Citizen");
    expect(result.text).not.toContain("9876543210");
    expect(result.text).not.toContain("citizen@example.com");
    expect(result.text).not.toContain("21.25140");
    expect(result.redactions.sort()).toEqual(["coordinates", "email", "name", "phone"]);
  });

  it("uses validated deterministic fallback and selects only an approved static protocol", async () => {
    const provider = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("provider unavailable in deterministic fallback test"));
    const run = await analyzeReport({ text: "Flood water is rising, please help", hazardType: "flood", severity: "high", duplicate: { nearbyCount: 1, textSimilarity: .8, mediaHashMatch: false } });
    provider.mockRestore();
    expect(run.meta.provider).toMatch(/^local-deterministic/);
    expect(run.result.analysis_available).toBe(true);
    expect(run.result.protocol?.id).toBe("flood_water");
    expect(run.result.protocol?.source).toBe("BEACON approved static protocol");
    expect(run.result.specialist_outputs.radar.provenance).toBe("postgis/time-distance");
    expect(run.meta.fallback_path).toContain("local:success");
  });
});
