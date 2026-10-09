import { describe, expect, it } from "vitest";
import { getCanonicalRedirect } from "./canonical-url";

describe("getCanonicalRedirect", () => {
  it("does not redirect development requests addressed through the local network", () => {
    const url = new URL("http://192.168.1.71:8082/inspector/device");

    expect(getCanonicalRedirect(url, "development")).toBeNull();
  });

  it("upgrades plain HTTP production requests to the canonical origin", () => {
    const url = new URL("http://osuna.chinhae.cc/download");

    expect(getCanonicalRedirect(url, "production")).toBe("https://osuna.chinhae.cc/download");
  });

  it("redirects production requests on another host to the canonical origin", () => {
    const url = new URL("https://osuna-website.example.workers.dev/download?channel=beta");

    expect(getCanonicalRedirect(url, "production")).toBe(
      "https://osuna.chinhae.cc/download?channel=beta",
    );
  });

  it("serves production requests already on the canonical origin", () => {
    const url = new URL("https://osuna.chinhae.cc/download");

    expect(getCanonicalRedirect(url, "production")).toBeNull();
  });
});
