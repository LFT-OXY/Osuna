import { describe, expect, it } from "vitest";
import {
  askedModelDisabledBy,
  cleanDisabledModels,
  endpointModelDisabledBy,
} from "./disabled-models";

// 用例照 magpie internal/provider/disabled_test.go 的说法（7597c132）：完整 id 或 glob，不分大小写。
describe("disabled models", () => {
  it("matches an endpoint's model by its id, slug/id and last segment, ignoring case", () => {
    const patterns = ["*-PREVIEW"];
    expect(endpointModelDisabledBy({ patterns, slug: "relay", model: "gemini-3-preview" })).toBe(
      "*-PREVIEW",
    );
    expect(endpointModelDisabledBy({ patterns, slug: "relay", model: "gemini-3" })).toBeNull();
    // * 跨过斜杠：openrouter 的 anthropic/claude-fable-5 也被 *fable* 命中。
    expect(
      endpointModelDisabledBy({
        patterns: ["*fable*"],
        slug: "or",
        model: "anthropic/claude-fable-5",
      }),
    ).toBe("*fable*");
    // 最后一段：claude-fable-5 命中带厂商前缀的 id。
    expect(
      endpointModelDisabledBy({
        patterns: ["claude-fable-5"],
        slug: "or",
        model: "anthropic/claude-fable-5",
      }),
    ).toBe("claude-fable-5");
    // slug/模型 只禁这一家的。
    expect(
      endpointModelDisabledBy({ patterns: ["relay/glm-5"], slug: "relay", model: "glm-5" }),
    ).toBe("relay/glm-5");
    expect(
      endpointModelDisabledBy({ patterns: ["relay/glm-5"], slug: "other", model: "glm-5" }),
    ).toBeNull();
  });

  it("reads ? as any one character and everything else as itself", () => {
    const disabledBy = (pattern: string, model: string) =>
      endpointModelDisabledBy({ patterns: [pattern], slug: "x", model });
    expect(disabledBy("gpt-5.?", "gpt-5.5")).toBe("gpt-5.?");
    expect(disabledBy("gpt-5.?", "gpt-5.55")).toBeNull();
    expect(disabledBy("gpt-5.5", "gpt-5x5")).toBeNull();
    expect(disabledBy("(a)+", "(a)+")).toBe("(a)+");
    expect(disabledBy("gpt", "gpt-5")).toBeNull();
  });

  it("matches a model as asked by its whole name, its last segment and the name after the slug", () => {
    expect(askedModelDisabledBy({ patterns: ["glm-5"], model: "relay/glm-5" })).toBe("glm-5");
    expect(askedModelDisabledBy({ patterns: ["relay/glm-5"], model: "relay/glm-5" })).toBe(
      "relay/glm-5",
    );
    expect(
      askedModelDisabledBy({ patterns: ["moonshotai/kimi-k2"], model: "or/moonshotai/kimi-k2" }),
    ).toBe("moonshotai/kimi-k2");
    expect(askedModelDisabledBy({ patterns: ["glm-5"], model: "glm-4.6" })).toBeNull();
    expect(askedModelDisabledBy({ patterns: [], model: "glm-5" })).toBeNull();
  });

  it("keeps the list as typed, trimmed, without empties or repeats in another case", () => {
    expect(cleanDisabledModels([" *fable* ", "", "GPT-5", "gpt-5", "*FABLE*", "o3"])).toEqual([
      "*fable*",
      "GPT-5",
      "o3",
    ]);
  });

  it("answers in linear time where a backtracking glob hangs", () => {
    const started = performance.now();
    const pattern = `${"*a".repeat(20)}*b`;
    expect(
      endpointModelDisabledBy({ patterns: [pattern], slug: "x", model: "a".repeat(60) }),
    ).toBeNull();
    expect(performance.now() - started).toBeLessThan(100);
  });
});
