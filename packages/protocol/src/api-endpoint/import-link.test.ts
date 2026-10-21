import { describe, expect, it } from "vitest";
import { isApiEndpointImportLink } from "./import-link.js";

describe("isApiEndpointImportLink", () => {
  it("knows paseo://import in the forms magpie takes", () => {
    for (const link of [
      "paseo://import?preset=deepseek",
      "paseo:import?preset=deepseek",
      "paseo:///import?preset=deepseek",
      "PASEO://import/?preset=deepseek",
      "  paseo://import?name=X&chat=https://relay.example/v1  ",
    ]) {
      expect(isApiEndpointImportLink(link), link).toBe(true);
    }
  });

  it("leaves Agent links, other actions and other schemes alone", () => {
    for (const link of [
      "paseo://h/server-1/agent/agent-2",
      "paseo://app/settings",
      "paseo://delete?id=deepseek",
      "magpie://import?preset=deepseek",
      "https://example.com/import?preset=deepseek",
      "/Users/me/project",
      "not a url",
    ]) {
      expect(isApiEndpointImportLink(link), link).toBe(false);
    }
  });
});
