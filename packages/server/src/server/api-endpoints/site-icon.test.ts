import { describe, expect, it } from "vitest";
import { isPublicAddress, publicAddresses, siteIconSites } from "./site-icon.js";

describe("where an icon is looked for", () => {
  it("the API's host with its port, without it, then each domain above it down to two labels", () => {
    expect(siteIconSites("https://api.eu.relay.example:8443/v1")).toEqual([
      "https://api.eu.relay.example:8443",
      "https://api.eu.relay.example",
      "https://eu.relay.example",
      "https://relay.example",
    ]);
    expect(siteIconSites("https://203.0.114.7/v1")).toEqual(["https://203.0.114.7"]);
  });
});

describe("only public addresses are dialed (as magpie publicDial)", () => {
  it("refuses loopback, private, link-local, carrier NAT and documentation ranges, and lets fake-ip 198.18/15 through", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.20.0.1",
      "192.168.1.1",
      "169.254.1.1",
      "100.64.0.1",
      "192.0.2.1",
      "198.51.100.1",
      "203.0.113.1",
      "0.0.0.0",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "2002::1",
    ]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    for (const ip of ["1.1.1.1", "198.18.0.5", "2606:4700::1111"]) {
      expect(isPublicAddress(ip), ip).toBe(true);
    }
  });

  it("a name with any private answer is refused whole; Loon's AAAA paired with its public A record is dropped", () => {
    expect(() =>
      publicAddresses("rebind.example", [
        { address: "1.1.1.1", family: 4 },
        { address: "10.0.0.1", family: 4 },
      ]),
    ).toThrow(/not public/);
    expect(
      publicAddresses("loon.example", [
        { address: "1.2.3.4", family: 4 },
        { address: "fd27:712::102:304", family: 6 },
      ]),
    ).toEqual([{ address: "1.2.3.4", family: 4 }]);
    expect(() =>
      publicAddresses("loon.example", [{ address: "fd27:712::102:304", family: 6 }]),
    ).toThrow(/not public/);
  });
});
