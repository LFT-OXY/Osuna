import type { LogicMapEdge, LogicMapNode, LogicMapSkeleton } from "@getpaseo/protocol/messages";

function node(
  id: string,
  kind: LogicMapNode["kind"],
  title: string,
  extra: Partial<LogicMapNode> = {},
): LogicMapNode {
  return {
    id,
    kind,
    title,
    parentId: null,
    doc: { kind: "own", file: `${id}.md`, pendingLink: false },
    ...extra,
  };
}

function edge(from: string, to: string, condition: string | null = null): LogicMapEdge {
  return { from, to, condition };
}

/**
 * 原型里那张"用户登录"图：顶层 13 个节点，两个判断各两条分支、一条失败的路、一个 4 个节点的子图节点、
 * 一个还没指向正式文档的节点。排版测试、面板浏览器测试和截图共用。
 */
export function buildLoginLogicMap(): LogicMapSkeleton {
  return {
    title: "用户登录",
    specFramework: { kind: "none" },
    nodes: [
      node("submit", "start", "提交账号和密码"),
      node("account", "decision", "账户状态"),
      node("locked-notice", "step", "提示账户已锁定", { failure: true }),
      node("password", "decision", "校验密码"),
      node("reset-count", "step", "清零失败次数"),
      node("second-factor", "subgraph", "二次验证"),
      node("sms", "start", "发送验证码", { parentId: "second-factor" }),
      node("sms-check", "decision", "验证码是否正确", { parentId: "second-factor" }),
      node("sms-ok", "end", "验证通过", { parentId: "second-factor" }),
      node("sms-fail", "end", "验证失败", { parentId: "second-factor", failure: true }),
      node("session", "step", "签发登录会话", {
        doc: { kind: "own", file: "session.md", pendingLink: true },
      }),
      node("home", "end", "进入首页"),
      node("count-failure", "step", "失败次数 +1", { failure: true }),
      node("limit", "decision", "满 5 次？"),
      node("wrong-password", "step", "提示密码错误", { failure: true }),
      node("lock", "step", "锁定账户 30 分钟", { failure: true }),
      node("stay", "end", "留在登录页"),
    ],
    edges: [
      edge("submit", "account"),
      edge("account", "password", "正常"),
      edge("account", "locked-notice", "已锁定"),
      edge("password", "reset-count", "正确"),
      edge("password", "count-failure", "错误"),
      edge("reset-count", "second-factor"),
      edge("second-factor", "session"),
      edge("session", "home"),
      edge("count-failure", "limit"),
      edge("limit", "wrong-password", "未满"),
      edge("limit", "lock", "已满"),
      edge("wrong-password", "stay"),
      edge("lock", "stay"),
      edge("locked-notice", "stay"),
      edge("sms", "sms-check"),
      edge("sms-check", "sms-ok", "正确"),
      edge("sms-check", "sms-fail", "错误"),
    ],
  };
}

/** daemon 新建、Agent 还没写入的空图。 */
export function buildEmptyLogicMap(): LogicMapSkeleton {
  return { title: null, specFramework: null, nodes: [], edges: [] };
}
