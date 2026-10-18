import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { afterEach, describe, expect, test } from "vitest";
import {
  codexProxiedMessage,
  codexProxyFix,
  codexProxyFor,
  codexProxyFrom,
  probeThroughProxy,
  reqwestNoProxy,
  systemBypassed,
  type CodexProxyForInput,
  type CodexProxySource,
} from "./codex-proxy.js";
import { NO_SYSTEM_PROXY, type SystemProxy } from "./system-proxy.js";

const BASE = "http://127.0.0.1:6769/api-endpoint-gateway";
const PROXY = "http://127.0.0.1:7890";

function routeFor(input: Partial<CodexProxyForInput>): ReturnType<typeof codexProxyFor> {
  return codexProxyFor({
    base: BASE,
    env: {},
    system: NO_SYSTEM_PROXY,
    platform: "darwin",
    respectsSystemProxy: false,
    ...input,
  });
}

function systemProxy(input: Partial<SystemProxy>): SystemProxy {
  return { ...NO_SYSTEM_PROXY, ...input };
}

describe("codexProxyFor: reqwest's default rules", () => {
  test("no proxy anywhere goes direct", () => {
    expect(routeFor({})).toBeNull();
  });

  test("HTTP_PROXY in either case, upper case first", () => {
    expect(routeFor({ env: { HTTP_PROXY: PROXY } })).toEqual({
      proxy: PROXY,
      source: { kind: "env", key: "HTTP_PROXY" },
    });
    expect(routeFor({ env: { http_proxy: ` ${PROXY} ` } })).toEqual({
      proxy: PROXY,
      source: { kind: "env", key: "HTTP_PROXY" },
    });
    expect(
      routeFor({ env: { HTTP_PROXY: "http://upper:1", http_proxy: "http://lower:2" } }),
    ).toEqual({ proxy: "http://upper:1", source: { kind: "env", key: "HTTP_PROXY" } });
  });

  test("an http:// gateway doesn't take HTTPS_PROXY; an https:// one does", () => {
    expect(routeFor({ env: { HTTPS_PROXY: PROXY } })).toBeNull();
    expect(routeFor({ base: "https://gateway.example/x", env: { https_proxy: PROXY } })).toEqual({
      proxy: PROXY,
      source: { kind: "env", key: "HTTPS_PROXY" },
    });
  });

  test("the system's HTTP proxy when the environment names none, then ALL_PROXY", () => {
    expect(routeFor({ system: systemProxy({ url: PROXY, http: PROXY }) })).toEqual({
      proxy: PROXY,
      source: { kind: "system" },
    });
    expect(
      routeFor({
        env: { HTTP_PROXY: "http://env:1" },
        system: systemProxy({ url: PROXY, http: PROXY }),
      }),
    ).toEqual({ proxy: "http://env:1", source: { kind: "env", key: "HTTP_PROXY" } });
    // macOS 只有安全网页代理（HTTPS）或 SOCKS 时，http:// 地址不经过它们。
    expect(routeFor({ system: systemProxy({ url: PROXY, socks: "socks5://s:1" }) })).toBeNull();
    expect(routeFor({ env: { all_proxy: "socks5://127.0.0.1:1080" } })).toEqual({
      proxy: "socks5://127.0.0.1:1080",
      source: { kind: "env", key: "ALL_PROXY" },
    });
  });

  test("NO_PROXY keeps 127.0.0.1 off the proxy only as an exact IP or a CIDR", () => {
    const env = (noProxy: string) => ({ HTTP_PROXY: PROXY, NO_PROXY: noProxy });
    for (const noProxy of ["127.0.0.1", "example.com, 127.0.0.1", "127.0.0.0/8", "0.0.0.0/0"]) {
      expect(routeFor({ env: env(noProxy) })).toBeNull();
    }
    for (const noProxy of [
      "localhost",
      "127.*",
      "*",
      ".0.0.1",
      "127.0.0.2",
      "127.0.0.0/33",
      "::1",
    ]) {
      expect(routeFor({ env: env(noProxy) })).toEqual({
        proxy: PROXY,
        source: { kind: "env", key: "HTTP_PROXY" },
      });
    }
    expect(routeFor({ env: { HTTP_PROXY: PROXY, no_proxy: "127.0.0.1" } })).toBeNull();
  });

  test("on Windows with no NO_PROXY, the system's bypass list counts, *. taken off", () => {
    const system = systemProxy({ url: PROXY, http: PROXY, bypass: ["*.corp", "127.0.0.1"] });
    expect(routeFor({ platform: "win32", system })).toBeNull();
    expect(routeFor({ platform: "darwin", system })).toEqual({
      proxy: PROXY,
      source: { kind: "system" },
    });
    const starred = systemProxy({ url: PROXY, http: PROXY, bypass: ["127.*", "<local>"] });
    expect(routeFor({ platform: "win32", system: starred })).toEqual({
      proxy: PROXY,
      source: { kind: "system" },
    });
    expect(routeFor({ platform: "win32", system, env: { NO_PROXY: "example.com" } })).toEqual({
      proxy: PROXY,
      source: { kind: "system" },
    });
  });
});

describe("codexProxyFor: [features] respect_system_proxy", () => {
  test("the system alone: none set goes direct even with HTTP_PROXY", () => {
    expect(routeFor({ respectsSystemProxy: true, env: { HTTP_PROXY: PROXY } })).toBeNull();
  });

  test("the system's bypass list matches with wildcards and <local>", () => {
    for (const bypass of [["127.*"], ["127.0.0.1"], ["*"], ["http://127.0.0.1"]]) {
      const system = systemProxy({ url: PROXY, http: PROXY, bypass });
      expect(routeFor({ respectsSystemProxy: true, system })).toBeNull();
    }
    const system = systemProxy({ url: PROXY, http: PROXY, bypass: ["<local>", "*.local"] });
    expect(routeFor({ respectsSystemProxy: true, system })).toEqual({
      proxy: PROXY,
      source: { kind: "system" },
    });
  });

  test("macOS: the HTTP entry; with a SOCKS one alone, the environment's", () => {
    const http = systemProxy({ url: "http://secure:1", http: PROXY });
    expect(routeFor({ respectsSystemProxy: true, system: http })).toEqual({
      proxy: PROXY,
      source: { kind: "system" },
    });
    const secureOnly = systemProxy({ url: "http://secure:1" });
    expect(routeFor({ respectsSystemProxy: true, system: secureOnly })).toBeNull();
    const socks = systemProxy({ url: "socks5://s:1", socks: "socks5://s:1" });
    expect(routeFor({ respectsSystemProxy: true, system: socks })).toBeNull();
    expect(
      routeFor({ respectsSystemProxy: true, system: socks, env: { ALL_PROXY: PROXY } }),
    ).toEqual({ proxy: PROXY, source: { kind: "env", key: "ALL_PROXY" } });
    expect(
      routeFor({
        respectsSystemProxy: true,
        system: socks,
        env: { HTTP_PROXY: PROXY, NO_PROXY: "127.0.0.1" },
      }),
    ).toBeNull();
  });

  test("Windows and elsewhere: the system's one proxy", () => {
    const system = systemProxy({ url: "http://secure:1" });
    expect(routeFor({ respectsSystemProxy: true, platform: "win32", system })).toEqual({
      proxy: "http://secure:1",
      source: { kind: "system" },
    });
  });
});

describe("NO_PROXY and bypass matching", () => {
  test("names match themselves and the domains they're under; * every name", () => {
    expect(reqwestNoProxy({ host: "api.example.com", list: "example.com" })).toBe(true);
    expect(reqwestNoProxy({ host: "example.com", list: ".example.com" })).toBe(true);
    expect(reqwestNoProxy({ host: "notexample.com", list: "example.com" })).toBe(false);
    expect(reqwestNoProxy({ host: "localhost", list: "*" })).toBe(true);
    expect(reqwestNoProxy({ host: "[::1]", list: "::1" })).toBe(true);
    expect(reqwestNoProxy({ host: "::1", list: "::/0" })).toBe(true);
  });

  test("the system's list: leading dots, wildcards, exact hosts", () => {
    expect(systemBypassed({ host: "a.corp", bypass: [".corp"] })).toBe(true);
    expect(systemBypassed({ host: "127.0.0.1", bypass: ["127.?.0.*"] })).toBe(true);
    // 不带 * 的照原样比（? 只在带 * 的项里算通配）。
    expect(systemBypassed({ host: "127.0.0.1", bypass: ["127.0.0.?"] })).toBe(false);
    expect(systemBypassed({ host: "127.0.0.1", bypass: ["127.0.0.[0-9]*"] })).toBe(true);
    expect(systemBypassed({ host: "127.0.0.1", bypass: ["", "10.*"] })).toBe(false);
  });
});

describe("where the proxy is set and which fix", () => {
  test("an environment variable, Windows' settings, the system's elsewhere", () => {
    const env: CodexProxySource = { kind: "env", key: "ALL_PROXY" };
    const system: CodexProxySource = { kind: "system" };
    expect(codexProxyFrom({ source: env, platform: "win32" })).toBe("ALL_PROXY");
    expect(codexProxyFix({ source: env, platform: "win32" })).toBe("environment");
    expect(codexProxyFrom({ source: system, platform: "win32" })).toBe("windows_settings");
    expect(codexProxyFix({ source: system, platform: "win32" })).toBe("windows");
    expect(codexProxyFrom({ source: system, platform: "darwin" })).toBe("system_settings");
    expect(codexProxyFix({ source: system, platform: "darwin" })).toBe("other");
  });

  test("the English message follows magpie's three ways", () => {
    expect(
      codexProxiedMessage({
        host: "127.0.0.1:6769",
        proxy: PROXY,
        from: "HTTP_PROXY",
        fix: "environment",
      }),
    ).toBe(
      "Codex sends its requests for Osuna (127.0.0.1:6769) through the proxy at http://127.0.0.1:7890, set in HTTP_PROXY, " +
        "and that proxy doesn't pass them on to Osuna: every turn fails, with 502 Bad Gateway, whichever model it is on. " +
        "Have the proxy send 127.0.0.1 direct (a DIRECT rule for 127.0.0.0/8, or rule mode rather than global), " +
        "or add 127.0.0.1 to NO_PROXY where HTTP_PROXY is set (your shell profile, such as ~/.zshrc, if it's there), " +
        "then quit and reopen Codex. Until then, Switch to official puts Codex's config back as it was.",
    );
    expect(
      codexProxiedMessage({ host: "h", proxy: PROXY, from: "windows_settings", fix: "windows" }),
    ).toContain(
      `set in Windows' proxy settings, and that proxy doesn't pass them on to Osuna: every turn fails, with 502 Bad Gateway, whichever model it is on. Have the proxy send 127.0.0.1 direct (a DIRECT rule for 127.0.0.0/8, or rule mode rather than global), or add 127.0.0.1 to "Don't use the proxy server for addresses beginning with" in Windows' proxy settings (127.* there is not enough for Codex), then quit`,
    );
    expect(
      codexProxiedMessage({ host: "h", proxy: PROXY, from: "system_settings", fix: "other" }),
    ).toContain(
      "set in the system's proxy settings, and that proxy doesn't pass them on to Osuna: every turn fails, with 502 Bad Gateway, whichever model it is on. Have the proxy send 127.0.0.1 direct (a DIRECT rule for 127.0.0.0/8, or rule mode rather than global), or add export NO_PROXY=127.0.0.1 to your shell profile (~/.zshrc): Codex in a terminal and the ChatGPT app's Codex both read it, then quit",
    );
  });
});

describe("probeThroughProxy (a fake proxy on loopback)", () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))),
    );
  });

  async function listen(server: Server): Promise<string> {
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("No port");
    return `http://127.0.0.1:${address.port}`;
  }

  /** 假中转站：根路径答自我介绍。 */
  async function fakeGateway(): Promise<string> {
    const gateway = createServer((req, res) => {
      if (req.url === "/api-endpoint-gateway/") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ name: "osuna" }));
        return;
      }
      res.writeHead(404).end();
    });
    return `${await listen(gateway)}/api-endpoint-gateway`;
  }

  test("a proxy that answers 502 doesn't pass the request on", async () => {
    const seen: Array<{ url: string | undefined; userAgent: string | undefined }> = [];
    const proxy = await listen(
      createServer((req, res) => {
        seen.push({ url: req.url, userAgent: req.headers["user-agent"] });
        res.writeHead(502).end("Bad Gateway");
      }),
    );
    const base = await fakeGateway();
    expect(await probeThroughProxy({ base, proxy, userAgent: "Osuna/1.2.3" })).toBe(false);
    expect(seen).toEqual([{ url: `${base}/`, userAgent: "Osuna/1.2.3" }]);
  });

  test("a proxy that passes it on reaches the gateway, with the proxy's account", async () => {
    const seen: Array<string | undefined> = [];
    const proxy = await listen(
      createServer((req, res) => {
        seen.push(req.headers["proxy-authorization"]);
        passOn(req, res);
      }),
    );
    const base = await fakeGateway();
    const withAccount = proxy.replace("http://", "http://me:pw@");
    expect(await probeThroughProxy({ base, proxy: withAccount, userAgent: "Osuna/1" })).toBe(true);
    expect(seen).toEqual([`Basic ${Buffer.from("me:pw").toString("base64")}`]);
  });

  test("nothing listening at the proxy, or something that isn't the gateway, is not reached", async () => {
    const closed = await listen(createServer());
    await new Promise((resolve) => servers.pop()?.close(resolve));
    const base = await fakeGateway();
    expect(await probeThroughProxy({ base, proxy: closed, userAgent: "Osuna/1" })).toBe(false);
    const other = await listen(
      createServer((_req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ name: "magpie" }));
      }),
    );
    expect(await probeThroughProxy({ base, proxy: other, userAgent: "Osuna/1" })).toBe(false);
  });
});

/** 转发的假代理：把 absolute-form 的请求原样发给目标，再把回答交回去。 */
function passOn(request: IncomingMessage, response: ServerResponse): void {
  const forwarded = httpRequest(request.url ?? "", { method: request.method }, (reply) => {
    response.writeHead(reply.statusCode ?? 502, reply.headers);
    reply.pipe(response);
  });
  forwarded.end();
}
