import { describe, expect, it } from "vitest";
import { apiEndpointNameDisplayOf, showsEndpointNames } from "./endpoint-names";

// 撞名照 magpie provider.Labels 的 same（7597c132）：同一个选单里不分大小写读起来一样的才算。
describe("endpoint name in model lists", () => {
  const names = ["GPT-5.5", "gpt-5.5", "GLM-5"];

  it("always puts the endpoint's name after every model", () => {
    expect(showsEndpointNames({ display: "always", names })).toEqual([true, true, true]);
  });

  it("only when names clash puts it after the models another endpoint offers under the same name, ignoring case", () => {
    expect(showsEndpointNames({ display: "clash", names })).toEqual([true, true, false]);
  });

  it("never puts it after any model, clashing or not", () => {
    expect(showsEndpointNames({ display: "never", names })).toEqual([false, false, false]);
  });

  it("a way this side does not know (one added later) reads as always", () => {
    expect(apiEndpointNameDisplayOf("sometimes")).toBe("always");
    expect(apiEndpointNameDisplayOf("clash")).toBe("clash");
  });
});
