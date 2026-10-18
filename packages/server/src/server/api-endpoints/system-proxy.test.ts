import { describe, expect, test } from "vitest";
import {
  createSystemProxyReader,
  NO_SYSTEM_PROXY,
  parseInternetSettings,
  parseScutil,
  parseWindowsProxy,
  redactProxy,
  type SystemProxy,
} from "./system-proxy.js";

const SCUTIL = `<dictionary> {
  ExceptionsList : <array> {
    0 : *.local
    1 : 169.254/16
  }
  FTPPassive : 1
  HTTPEnable : 1
  HTTPPort : 7890
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 1
  HTTPSPort : 7891
  HTTPSProxy : 127.0.0.1
  SOCKSEnable : 0
  SOCKSPort : 7892
  SOCKSProxy : 127.0.0.1
}`;

describe("parseScutil", () => {
  test("HTTPS wins for the one address; HTTP and SOCKS are each entry alone", () => {
    expect(parseScutil(SCUTIL)).toEqual({
      url: "http://127.0.0.1:7891",
      http: "http://127.0.0.1:7890",
      socks: null,
      bypass: ["*.local", "169.254/16"],
    });
  });

  test("a SOCKS entry alone, and none set", () => {
    const socksOnly = `<dictionary> {
  SOCKSEnable : 1
  SOCKSPort : 1080
  SOCKSProxy : proxy.lan
}`;
    expect(parseScutil(socksOnly)).toEqual({
      url: "socks5://proxy.lan:1080",
      http: null,
      socks: "socks5://proxy.lan:1080",
      bypass: [],
    });
    expect(parseScutil("<dictionary> {\n  HTTPEnable : 0\n}")).toEqual(NO_SYSTEM_PROXY);
  });
});

describe("Windows' Internet Options", () => {
  test("one proxy for every protocol is the HTTP one too", () => {
    expect(
      parseWindowsProxy({ server: "127.0.0.1:7890", override: "localhost;127.*;<local>" }),
    ).toEqual({
      url: "http://127.0.0.1:7890",
      http: "http://127.0.0.1:7890",
      socks: null,
      bypass: ["localhost", "127.*", "<local>"],
    });
  });

  test("a list per protocol has no HTTP one (reqwest can't read it)", () => {
    expect(parseWindowsProxy({ server: "http=h:1;https=h:2;socks=h:3", override: "" })).toEqual({
      url: "http://h:2",
      http: null,
      socks: "socks5://h:3",
      bypass: [""],
    });
    expect(parseWindowsProxy({ server: " ", override: "" })).toEqual(NO_SYSTEM_PROXY);
  });

  test("reg query's output: read only while ProxyEnable isn't 0", () => {
    const output = `
HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings
    ProxyEnable    REG_DWORD    0x1
    ProxyServer    REG_SZ    127.0.0.1:7890
    ProxyOverride    REG_SZ    127.0.0.1;<local>
`;
    expect(parseInternetSettings(output)).toEqual({
      url: "http://127.0.0.1:7890",
      http: "http://127.0.0.1:7890",
      socks: null,
      bypass: ["127.0.0.1", "<local>"],
    });
    expect(parseInternetSettings(output.replace("0x1", "0x0"))).toEqual(NO_SYSTEM_PROXY);
    expect(parseInternetSettings("    ProxyEnable    REG_DWORD    0x1\n")).toEqual(NO_SYSTEM_PROXY);
  });
});

describe("createSystemProxyReader", () => {
  test("a set proxy is kept 15 seconds, none only 2", async () => {
    let now = 0;
    let answer: SystemProxy = NO_SYSTEM_PROXY;
    let reads = 0;
    const read = createSystemProxyReader({
      read: async () => {
        reads += 1;
        return answer;
      },
      now: () => now,
    });
    expect(await read()).toEqual(NO_SYSTEM_PROXY);
    const set = parseWindowsProxy({ server: "p:1", override: "" });
    answer = set;
    now = 2_000;
    expect(await read()).toEqual(NO_SYSTEM_PROXY);
    now = 2_001;
    expect(await read()).toEqual(set);
    answer = NO_SYSTEM_PROXY;
    now = 17_001;
    expect(await read()).toEqual(set);
    now = 17_002;
    expect(await read()).toEqual(NO_SYSTEM_PROXY);
    expect(reads).toBe(3);
  });
});

describe("redactProxy", () => {
  test("takes the account out, keeping how it was written", () => {
    expect(redactProxy("http://me:pw@127.0.0.1:7890")).toBe("http://127.0.0.1:7890");
    expect(redactProxy("me:pw@127.0.0.1:7890")).toBe("127.0.0.1:7890");
    expect(redactProxy("socks5://127.0.0.1:1080")).toBe("socks5://127.0.0.1:1080");
  });
});
