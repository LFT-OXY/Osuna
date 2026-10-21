import { describe, expect, it } from "vitest";
import { importLinkRefusalOf, importLinkServerId } from "./import-link";

const hosts = [{ serverId: "remote" }, { serverId: "local" }, { serverId: "other" }];

describe("importLinkServerId", () => {
  it("adds to the host the window is showing", () => {
    const base = { lastSelectedServerId: "other", localServerId: "local", hosts };
    expect(importLinkServerId({ ...base, pathname: "/h/remote/workspace/abc" })).toBe("remote");
    expect(importLinkServerId({ ...base, pathname: "/settings/hosts/remote/api-endpoints" })).toBe(
      "remote",
    );
  });

  it("off a host's page, takes the last workspace's host, then the local one, then the first", () => {
    expect(
      importLinkServerId({
        pathname: "/usage",
        lastSelectedServerId: "other",
        localServerId: "local",
        hosts,
      }),
    ).toBe("other");
    expect(
      importLinkServerId({
        pathname: "/usage",
        lastSelectedServerId: "gone",
        localServerId: "local",
        hosts,
      }),
    ).toBe("local");
    expect(
      importLinkServerId({
        pathname: "/usage",
        lastSelectedServerId: null,
        localServerId: null,
        hosts,
      }),
    ).toBe("remote");
    expect(
      importLinkServerId({
        pathname: "/h/unknown/x",
        lastSelectedServerId: null,
        localServerId: null,
        hosts: [],
      }),
    ).toBeNull();
  });
});

describe("importLinkRefusalOf", () => {
  it("knows the daemon's reasons and calls any other one unknown", () => {
    expect(
      importLinkRefusalOf({
        code: "import_link_refused",
        params: { reason: "vertex" },
        message: "",
      }),
    ).toBe("vertex");
    expect(
      importLinkRefusalOf({
        code: "import_link_refused",
        params: { reason: "brand_new" },
        message: "",
      }),
    ).toBe("unknown");
    expect(importLinkRefusalOf({ code: "endpoints_unparsable", message: "" })).toBeNull();
  });
});
