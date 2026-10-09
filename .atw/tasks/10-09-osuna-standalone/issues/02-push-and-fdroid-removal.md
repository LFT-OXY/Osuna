# 02 — 推送通知与 F-Droid 档移除

**What to build:** 安卓用户首次连主机不再被问"允许通知"，APK 不再打包 Firebase Messaging；Osuna 只剩一个安卓构建档（相机保留用于扫码配对，无推送）。daemon 侧推送接收端原样保留，零令牌时是空操作（地图 11 号票）。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** ready

- [ ] App 不再依赖 `expo-notifications`，对应 config plugin、原生订阅实现、原生通知处理器、通知图标删除；原生入口与 web 一样为空操作；通知点击路由只保留桌面 / 网页端
- [ ] F-Droid 构建档删除：对应环境变量、autolinking 插件、相机与通知桩、`extra.fdroidBuild`；应用配置只剩一个安卓档且相机权限保留
- [ ] daemon push 服务、`register_push_token` / `push.unregister.*` 协议消息、`features.pushTokenRevocation`、push token 存储保持不变
- [ ] `docs/data-model.md` Push Token Store 一节注明当前没有客户端注册令牌；`docs/android.md` 删 F-Droid 节（EAS 节的改写留给安卓构建票）
- [ ] `npm run typecheck`、`npm run lint`、app 现有测试全绿；桌面通知与应用内提醒的现有测试不受影响
