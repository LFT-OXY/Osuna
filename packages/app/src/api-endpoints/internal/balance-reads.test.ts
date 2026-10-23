import { beforeEach, describe, expect, it } from "vitest";
import { balanceReadFlags, resetBalanceReadsForTests } from "./balance-reads";

const T0 = 1_000_000;

describe("balanceReadFlags", () => {
  beforeEach(() => resetBalanceReadsForTests());

  it("opening a page asks; opening it again within 30 seconds doesn't, after that it does", () => {
    const read = (now: number) =>
      balanceReadFlags({ serverId: "s", endpointIds: ["a"], kind: "open", now });
    expect(read(T0)).toEqual({ asked: true, force: false });
    expect(read(T0 + 29_999)).toEqual({ asked: false, force: false });
    expect(read(T0 + 30_000)).toEqual({ asked: true, force: false });
  });

  it("a page with an endpoint not asked lately asks for all of them", () => {
    balanceReadFlags({ serverId: "s", endpointIds: ["a"], kind: "open", now: T0 });
    expect(
      balanceReadFlags({ serverId: "s", endpointIds: ["a", "b"], kind: "open", now: T0 + 1 }),
    ).toEqual({ asked: true, force: false });
  });

  it("the timed read is never asked, and Refresh always is and forces", () => {
    expect(balanceReadFlags({ serverId: "s", endpointIds: ["a"], kind: "timed", now: T0 })).toEqual(
      { asked: false, force: false },
    );
    expect(balanceReadFlags({ serverId: "s", endpointIds: ["a"], kind: "force", now: T0 })).toEqual(
      { asked: true, force: true },
    );
    // 刷新也记下时刻：紧接着打开页面不再算要求。
    expect(
      balanceReadFlags({ serverId: "s", endpointIds: ["a"], kind: "open", now: T0 + 1 }),
    ).toEqual({ asked: false, force: false });
  });

  it("each host keeps its own times", () => {
    balanceReadFlags({ serverId: "s", endpointIds: ["a"], kind: "open", now: T0 });
    expect(
      balanceReadFlags({ serverId: "other", endpointIds: ["a"], kind: "open", now: T0 + 1 }),
    ).toEqual({ asked: true, force: false });
  });
});
