# 11 — 安卓包的推送通知去留

**Type:** interview
**Blocked by:** None
**Status:** resolved

## Question

01 号票查明：Paseo 的推送链是 App 向 Expo 推送服务申请 `ExponentPushToken`，daemon 再 POST `exp.host/--/api/v2/push/send`（`packages/app/src/push-notifications/internal/subscriptions.ts`、`packages/server/src/server/push/push-service.ts`）。这条链要求一个 Expo 项目（projectId）加上在该项目上配置的 FCM V1 凭据（Firebase 项目 + `google-services.json`）。选定的 B 路径没有 Expo 项目，推送天然不可用；App 侧缺 projectId 只 `console.warn`，不会崩。

要定：

1. **1.0.0 安卓包不支持推送**（设置页隐藏推送开关、发布说明注明），还是**另开一票接 Firebase**（注册 Expo 账号只为推送 + 自建 Firebase 项目，或完全绕开 Expo 直连 FCM）？推荐前者：远程主路径是网页端，APK 是补充；推送不影响核心的监控与控制。
2. 若不支持：daemon 侧 push-service 是保留（等以后接）还是随 Hub 一起清理？推荐保留但不暴露 UI。
3. 网页端是否需要 Web Push 替代？推荐范围外，记入 Out of scope。

## Answer

访谈两轮、7 问，全部按推荐。结论：**Osuna 任何端都不提供推送通知；daemon 侧接收端原样保留；App 侧推送代码与 F-Droid 构建档整删。**

核对到的前提（代码为准，票面上的"设置页隐藏推送开关"不成立）：

- App 没有推送开关，推送是连上主机后自动注册的（`packages/app/src/contexts/session-context.tsx:264`）。
- 权限弹窗在 projectId 检查之前（`packages/app/src/push-notifications/internal/subscriptions.ts` `resolveToken`），删掉 projectId 后首次连主机仍会弹"允许通知？"，答应了也收不到。
- 三条通知通道彼此独立：推送（Expo→FCM，App 未运行）、桌面通知（Electron / 浏览器 Notification，App 运行未聚焦）、应用内提醒（WebSocket 直推）。后两条与推送无关，桌面端与网页端保留。
- daemon 侧 `packages/server/src/server/push/` 与 Hub 无关；零令牌时 `send` 直接返回。

决定：

1. **1.0.0 安卓包不支持推送。** 不注册 Expo 账号、不建 Firebase 项目、不另开票。
2. **daemon 侧 push-service 原样保留。** `packages/server/src/server/push/`、协议 `register_push_token` / `push.unregister.*` / `features.pushTokenRevocation`、`push-tokens.json` 只随改名，不加 COMPAT，不删。理由：删要动协议三处、ws-server 两处发送点、五个测试；留着是空操作、无外呼。
3. **App 侧推送代码整删。** `expo-notifications` 依赖与 config plugin、`subscriptions.ts` 原生实现、`_layout.tsx` 原生通知处理器、通知图标全删；`index.native.ts` 与 web 一样空操作；`PushNotificationRouter` 只留桌面/网页端点击路由。理由：权限弹窗消失、APK 不再打包永远不用的 Firebase Messaging 原生库、无门控分支。与第 2 条的不对称是有意的：daemon 侧删的代价是协议，App 侧留的代价是原生依赖和权限弹窗。
4. **F-Droid 构建档删除。** `PASEO_FDROID_BUILD`、`with-fdroid-autolinking.js`、`src/fdroid/` 相机与通知桩、`extra.fdroidBuild`、`docs/android.md` F-Droid 节全删。Osuna 只剩一个安卓档：相机保留（QR 配对）、无推送。`android-apk-release.yml` 重写时不再有 F-Droid 分支。
5. **网页端不做 Web Push。** 记入 Out of scope；标签页开着时已有浏览器桌面通知。
6. **术语表已补三条**：`docs/glossary.md` 的 **Push notification / Desktop notification / In-app attention**，按界面实际文案核过（"Attention / 需要注意"、设置页"Notifications"节、"桌面通知"）。不写 ADR：可逆、不意外。
7. **文档与发布说明不另开票**，并入地图"文档体系改写范围"雾区：`docs/android.md` 改写、`docs/data-model.md` Push Token Store 一节加"当前没有客户端注册令牌"、1.0.0 发布说明升级段加"安卓包无推送通知，需要被动提醒请用桌面端或网页端"。
