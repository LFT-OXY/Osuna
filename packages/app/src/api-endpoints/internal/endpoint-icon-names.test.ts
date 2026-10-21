import { describe, expect, it } from "vitest";
import {
  builtInIconOf,
  BUILT_IN_ICONS,
  PICKABLE_ENDPOINT_ICONS,
  TEMPLATE_ICONS,
} from "./endpoint-icon-names";

describe("endpoint icon names", () => {
  it("every template's icon is a built-in one, so no template falls back to its initial by mistake", () => {
    for (const [templateId, name] of Object.entries(TEMPLATE_ICONS)) {
      expect(BUILT_IN_ICONS[name], `${templateId} → ${name}`).toBeDefined();
    }
    expect(builtInIconOf({ icon: null, templateId: "tencent-cloud" })).toBe(
      BUILT_IN_ICONS["tencentcloud-color"],
    );
  });

  it("offers magpie's preset icons and MORE_ICONS but its own logo, sorted by name without -color", () => {
    expect(PICKABLE_ENDPOINT_ICONS).toHaveLength(134);
    expect(PICKABLE_ENDPOINT_ICONS).toContain("tencentcloud-color");
    expect(PICKABLE_ENDPOINT_ICONS).not.toContain("magpie");
    expect(PICKABLE_ENDPOINT_ICONS.slice(0, 3)).toEqual(["ai21", "ai302-color", "ai360-color"]);
  });

  it("an endpoint's own built-in icon comes before its template's", () => {
    expect(builtInIconOf({ icon: "openai", templateId: "deepseek" })).toBe(BUILT_IN_ICONS.openai);
  });
});
