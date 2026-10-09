import compare from "semver/functions/compare.js";
import parse from "semver/functions/parse.js";

// 1.0.0 的全量改名连同线上的消息类型名与字段一起改了，更早的 daemon 与 1.0.0 的客户端
// 互相认不出对方的消息。这是协议下限，不是特性门槛：低于它的主机一条请求都不该收到。
export const MINIMUM_HOST_VERSION = "1.0.0";

export function isSupportedHostVersion(version: string | null | undefined): boolean {
  const parsed = parse(version);
  if (!parsed) return false;
  // 去掉预发布段再比：1.0.0-beta.N 说的已经是 1.0.0 的协议。
  const core = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
  return compare(core, MINIMUM_HOST_VERSION) >= 0;
}
