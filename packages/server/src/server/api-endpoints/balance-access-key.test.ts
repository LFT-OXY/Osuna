import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
  accessKeyPlanOf,
  tencentStopped,
  readVolcPlan,
  tc3Sign,
  tencentPlanWindow,
  volcSign,
  withTencentDetail,
  type TencentPlan,
} from "./balance-access-key.js";

describe("volcSign", () => {
  // 火山官方 SDK（volc-sdk-golang 06f9ef66 的 base.GetSignRequest）对 open.volcengineapi.com/ 的 POST 签出的值：
  // 查询串带 Action 与 Version，正文 {}，Content-Type application/json，服务 ark，时刻 2026-10-09T08:30:15Z（magpie 的
  // TestVolcSignMatchesSDK 记下的向量）。
  const at = Date.parse("2026-10-09T08:30:15Z");

  test.each([
    {
      region: "cn-beijing",
      action: "GetCodingPlanUsage",
      signature: "deb80c0cd8bd77768ca40f6d47c7204621c0994428f6ab77e23b76e15dc4c047",
    },
    {
      region: "cn-shanghai",
      action: "GetAFPUsage",
      signature: "8a241be0996c93de4dfcd9e8b1db37494bf63170804fcaebe8380ff7dca2bb23",
    },
  ])("signs $action in $region as the official SDK does", ({ region, action, signature }) => {
    const signed = volcSign({
      accessKeyId: "AKLTexample",
      secretAccessKey: "c2VjcmV0LWV4YW1wbGU=",
      region,
      host: "open.volcengineapi.com",
      query: { Action: action, Version: "2024-01-01" },
      body: "{}",
      now: at,
    });
    expect(signed).toEqual({
      authorization:
        `HMAC-SHA256 Credential=AKLTexample/20261009/${region}/ark/request, ` +
        `SignedHeaders=content-type;host;x-content-sha256;x-date, Signature=${signature}`,
      xDate: "20261009T083015Z",
      contentSha256: "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
    });
  });
});

describe("tc3Sign", () => {
  // 腾讯云签名文档（api/213/30654）里一步步算出的例子：cvm.tencentcloudapi.com 的 DescribeInstances，时间戳 1551113065，
  // 正文一字不差（名字写成 JSON 转义，不是 UTF-8）。
  const payload =
    '{"Limit": 1, "Filters": [{"Values": ["\\u672a\\u547d\\u540d"], "Name": "instance-name"}]}';

  test("the doc's payload hashes to the doc's value", () => {
    expect(createHash("sha256").update(payload).digest("hex")).toBe(
      "35e9c5b0e3ae67532d3c9f17ead6c90222632e5b1ff7f6e89887f1398934f064",
    );
  });

  test("signs the doc's example to the doc's signature", () => {
    const secretId = `AKID${"*".repeat(32)}`;
    expect(
      tc3Sign({
        secretId,
        secretKey: "*".repeat(32),
        service: "cvm",
        host: "cvm.tencentcloudapi.com",
        action: "DescribeInstances",
        contentType: "application/json; charset=utf-8",
        body: payload,
        timestamp: 1551113065,
      }),
    ).toBe(
      `TC3-HMAC-SHA256 Credential=${secretId}/2019-02-25/cvm/tc3_request, ` +
        "SignedHeaders=content-type;host;x-tc-action, " +
        "Signature=10b1a37a7301a02ca19a647ad722d5e43b4b3cff309d421d85b46093f6ab6c4f",
    );
  });
});

function chatAt(url: string) {
  return [{ format: "openai_chat", url }];
}

describe("accessKeyPlanOf", () => {
  test.each([
    ["https://ark.cn-beijing.volces.com/api/coding/v3", "GetCodingPlanUsage", "cn-beijing"],
    ["https://ark.cn-shanghai.volces.com/api/plan/v3", "GetAFPUsage", "cn-shanghai"],
    ["https://ark.ap-southeast.volces.com/api/plan", "GetAFPUsage", "ap-southeast"],
  ])("Volcengine Ark's %s is read with %s in %s", (url, action, region) => {
    expect(accessKeyPlanOf(chatAt(url))).toEqual({ vendor: "volcengine", action, region });
  });

  test("the Anthropic address of a Coding Plan counts too", () => {
    expect(
      accessKeyPlanOf([
        { format: "anthropic_messages", url: "https://ark.cn-beijing.volces.com/api/coding" },
      ]),
    ).toEqual({ vendor: "volcengine", action: "GetCodingPlanUsage", region: "cn-beijing" });
  });

  test.each([
    ["https://tokenhub.tencentmaas.com/plan/v3", "ap-guangzhou"],
    ["https://TokenHub-Intl.tencentmaas.com/plan/anthropic/", "ap-singapore"],
  ])("Tencent Cloud's Token Plan Enterprise at %s is in %s", (url, region) => {
    expect(accessKeyPlanOf(chatAt(url))).toEqual({ vendor: "tencent", region });
  });

  test.each([
    "https://ark.cn-beijing.volces.com/api/v3",
    "https://relay.example.com/api/coding/v3",
    "https://tokenhub.tencentmaas.com/v1",
    "https://tokenhub.tencentmaas.com/planx/v3",
    "https://api.lkeap.cloud.tencent.com/plan/v3",
  ])("pay as you go and other vendors have no such plan: %s", (url) => {
    expect(accessKeyPlanOf(chatAt(url))).toBeNull();
  });
});

describe("readVolcPlan", () => {
  test("GetCodingPlanUsage gives the used share of each known level, resets in seconds", () => {
    const { windows } = readVolcPlan({
      action: "GetCodingPlanUsage",
      body: {
        Result: {
          QuotaUsage: [
            { Level: "session", Percent: 10.5, ResetTimestamp: 1758100000 },
            { Level: "weekly", Percent: 20.25, ResetTimestamp: 1758200000 },
            { Level: "monthly", Percent: "30.75", ResetTimestamp: 1758300000 },
            { Level: "daily", Percent: 1 },
          ],
        },
      },
    });
    expect(windows.map((w) => [w.id, w.usedPct, w.resetsAt])).toEqual([
      ["5h", 10.5, "2025-09-17T09:06:40.000Z"],
      ["7d", 20.25, "2025-09-18T12:53:20.000Z"],
      ["month", 30.75, "2025-09-19T16:40:00.000Z"],
    ]);
  });

  test("GetAFPUsage reads Used of Quota with a reset in ms; a bucket with no quota is not on the plan", () => {
    const { windows, tier } = readVolcPlan({
      action: "GetAFPUsage",
      body: {
        Result: {
          AFPFiveHour: { Quota: 100, Used: 42, ResetTime: 1790000000000 },
          AFPDaily: { Quota: 500, Used: 400 },
          AFPWeekly: { Quota: 0, Used: 5 },
          AFPMonthly: { Quota: 200, Used: 50 },
        },
      },
    });
    expect(windows).toEqual([
      expect.objectContaining({
        id: "5h",
        usedPct: 42,
        used: 42,
        limit: 100,
        resetsAt: "2026-09-21T14:13:20.000Z",
      }),
      expect.objectContaining({ id: "month", usedPct: 25, resetsAt: null }),
    ]);
    expect(tier).toBeNull();
  });

  test("GetAFPUsage also reads Percent, Used of Total with an RFC 3339 reset, and the plan's tier", () => {
    const { windows, tier } = readVolcPlan({
      action: "GetAFPUsage",
      body: {
        Result: {
          Tier: " Pro ",
          AFPFiveHour: { Percent: 12.5, ResetTimestamp: 1790000000 },
          AFPWeekly: { Used: "30", Total: "120", ResetTime: "2026-10-12T00:00:00Z" },
        },
      },
    });
    expect(windows.map((w) => [w.id, w.usedPct, w.resetsAt])).toEqual([
      ["5h", 12.5, "2026-09-21T14:13:20.000Z"],
      ["7d", 25, "2026-10-12T00:00:00.000Z"],
    ]);
    expect(tier).toBe("Pro");
  });
});

describe("tencentPlanWindow", () => {
  // 文档里 DescribeTokenPlan 的样子：数是字符串，周期起止按北京时间。
  const docPlan: TencentPlan = withTencentDetail(
    {
      teamId: "team-a1b2c3d4",
      name: "",
      productType: "",
      status: "",
      stopReason: "",
      packageInfo: null,
      tokenSummary: null,
    },
    {
      Response: {
        TeamId: "team-a1b2c3d4",
        ProductType: "enterprise",
        PackageInfo: {
          TotalQuota: "1000000",
          TotalUsed: "100000",
          CycleUnit: "month",
          StartTime: "2026-04-01T00:00:00Z",
          ExpireTime: "2027-04-01T00:00:00Z",
          CycleQuota: "1000000",
          CurrentCycle: 1,
        },
        TokenSummary: {
          CycleStartTime: "2026-04-01T00:00:00+08:00",
          CycleEndTime: "2026-05-01T00:00:00+08:00",
        },
      },
    },
  );
  const april10 = Date.parse("2026-04-10T00:00:00Z");

  test("used of the cycle's quota in credits, resetting at the cycle's end", () => {
    expect(tencentPlanWindow({ plan: docPlan, now: april10 })).toMatchObject({
      id: "month",
      usedPct: 10,
      used: 100000,
      limit: 1000000,
      unit: "credits",
      resetsAt: "2026-04-30T16:00:00.000Z",
      span: 30 * 24 * 3_600_000,
    });
  });

  test("the light plan (enterprise-auto) counts tokens", () => {
    const plan = { ...docPlan, productType: "enterprise-auto" };
    expect(tencentPlanWindow({ plan, now: april10 })?.unit).toBe("tokens");
  });

  test("with no cycle summary the cycle counts months from the package's start, never past expiry", () => {
    const plan = { ...docPlan, tokenSummary: null };
    expect(tencentPlanWindow({ plan, now: april10 })?.resetsAt).toBe("2026-05-01T00:00:00.000Z");
    const july15 = Date.parse("2026-07-15T00:00:00Z");
    expect(tencentPlanWindow({ plan, now: july15 })?.resetsAt).toBe("2026-08-01T00:00:00.000Z");
    const expiring = {
      ...plan,
      packageInfo: { ...plan.packageInfo, ExpireTime: "2026-07-20T00:00:00Z" },
    };
    expect(tencentPlanWindow({ plan: expiring, now: july15 })?.resetsAt).toBe(
      "2026-07-20T00:00:00.000Z",
    );
  });

  test("no cycle quota falls back to the total; used past it shows full", () => {
    const plan = {
      ...docPlan,
      packageInfo: { ...docPlan.packageInfo, CycleQuota: null, TotalUsed: 2000000 },
    };
    expect(tencentPlanWindow({ plan, now: april10 })).toMatchObject({
      limit: 1000000,
      usedPct: 100,
    });
  });

  test.each([{}, { TotalQuota: "0", TotalUsed: "1" }, { TotalQuota: "10" }])(
    "no quota told is no window: %j",
    (packageInfo) => {
      expect(tencentPlanWindow({ plan: { ...docPlan, packageInfo }, now: april10 })).toBeNull();
    },
  );
});

describe("tencentStopped", () => {
  const plan: TencentPlan = {
    teamId: "t",
    name: "",
    productType: "",
    status: "enable",
    stopReason: "",
    packageInfo: null,
    tokenSummary: null,
  };

  test("an enabled plan, or one with no status, is not stopped", () => {
    expect(tencentStopped(plan)).toBeNull();
    expect(tencentStopped({ ...plan, status: "" })).toBeNull();
  });

  test("another status is stopped, with its reason unless the reason says none", () => {
    expect(tencentStopped({ ...plan, status: "isolated", stopReason: "ARREARS" })).toEqual({
      status: "isolated",
      reason: "ARREARS",
    });
    expect(tencentStopped({ ...plan, status: "exhausted", stopReason: "NORMAL" })).toEqual({
      status: "exhausted",
      reason: null,
    });
  });

  test("the plan's own reply tells the status over the list's", () => {
    const told = withTencentDetail(plan, {
      Response: { Status: "frozen", StopReason: "MANUAL" },
    });
    expect(tencentStopped(told)).toEqual({ status: "frozen", reason: "MANUAL" });
  });
});
