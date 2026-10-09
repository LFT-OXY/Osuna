# 11 — Public docs 内容改写

**What to build:** 文档读者看到的安装方式只有桌面端、Docker、源码构建三种，所有链接都指向 Osuna 自己的仓库与域名，Docker 用户能照升级段手工搬目录；27 篇顶层文档与 `plugins/` 三篇保留英文、只做改名与内容订正（spec 决策 H）。

**Blocked by:** 04, 06
**Status:** ready-for-agent
**Impl:** done

- [ ] 首页安装段改为：桌面端（GitHub Releases `LFT-OXY/Osuna`）、Docker（`ghcr.io/lft-oxy/osuna`）、服务器 / 无头（克隆仓库 → `npm ci` → 构建 server 栈 → 运行 CLI）；web-ui、updates、docker 页的 npm 安装语句同改；不出现 `npm install -g`
- [x] 链接与命令：上游仓库链接改 `LFT-OXY/Osuna`（`plugin-examples/`、`skills/`、`docs/custom-providers.md`、`SECURITY.md`、releases、issues）；`npx skills add getpaseo/paseo` → `npx skills add LFT-OXY/Osuna`；4 个第三方社区插件仓库、`paseo.cafe`、`labels/plugins` 链接删除
- [x] docker 页新增升级段：卷挂 `/home/osuna`、环境变量改名、首启前在卷里 `mv .paseo .osuna`；与 daemon 迁移票的实际行为一致
- [x] 插件文档写明上游 Paseo 插件与 Osuna 不兼容；requirements 键为 `osuna`
- [x] 27 篇顶层与 `plugins/` 三篇无 Paseo 字样、无上游链接；导航分类名保留英文；`llms.txt` 前言改 Osuna
- [x] 官网 vitest 与 build 绿；守线检查绿
