import { describe, expect, it } from "vitest";
import { buildDocsNavTree, getDocs } from "./docs";

describe("plugin documentation", () => {
  it("lists one unversioned set of pages in the Plugins navigation", () => {
    const plugins = buildDocsNavTree(getDocs()).find(
      (node) => node.type === "category" && node.label === "Plugins",
    );

    expect(plugins).toMatchObject({
      type: "category",
      children: [
        { type: "page", label: "Quickstart", href: "/docs/plugins" },
        { type: "page", label: "Provider plugins", href: "/docs/plugins/providers" },
        { type: "page", label: "Reference", href: "/docs/plugins/reference" },
      ],
    });
  });
});
