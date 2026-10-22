# 05 — 自定义余额与「查询余额」

**What to build:** 任何接口（含用模板加的）的编辑窗口「高级」区多出余额查询地址、方法（GET / POST）、取值写法三栏；填了就按填的查，不再按地址认。「查询余额」用表单里还没保存的值当场查一次，结果显示在按钮旁。地址填成 credit grants 时显示 OpenAI 旧式额度。不填取值写法时按地址结尾给 new-api、sub2api、credit grants 的默认写法，占位里写出来。

**Blocked by:** 01
**Status:** ready-for-agent
**Impl:** ready

- [ ] 接口新字段「余额设置」（地址、方法、取值写法），可选，存在接口自己的存储里；保存请求可写可清；旧客户端保存不清掉它。
- [ ] 请求照 magpie：POST 不带正文；key 的 Bearer 头 + 接口请求头 + `Accept: application/json` + Osuna User-Agent；地址与请求头里的 `{key}` 一类占位换成 key（地址里先转义）；回复最多读 1 MB。
- [ ] 取值表达式在 daemon 里重写成纯函数，语法全照 magpie（路径与下标、四则运算与括号、前缀符号、`%` 后缀带比例、`*` 展开、`[k=v]` / `[k!=v]` 过滤、`sum` `max` `min` `count`、`;` 多项与标签、缺失显示「—」、单条路径的字符串原样显示）；单元测试覆盖 magpie 注释与命令行帮助里的示例和各条报错。
- [ ] 默认写法：new-api `/api/usage/token`、`/api/user/self`，sub2api `/v1/usage`、`/api/v1/user/profile`，`/dashboard/billing/credit_grants`。
- [ ] 新 RPC「查询余额」接受未保存的表单值（同测试连接），只读一次，不写缓存与上次读数。
- [ ] 端到端测试：GET / POST、占位替换、接口请求头带上、默认写法、credit grants、取不到值的失败、填了地址就不按主机名认。
- [ ] `docs/usage.md` 读余额一节写进自定义地址与「查询余额」（按下才发）。`docs/glossary.md` 收「余额查询地址」「查询余额」。
- [ ] 9 种语言的新文字齐全。
- [ ] 浏览器测试：查询余额的成功与失败。
- [ ] UI：编辑窗口高级区 / 空表单、查询成功、查询失败 / 1280 与 390 — 三栏、默认写法占位、结果就地显示，保存按钮不被遮住。
- [ ] UI：详情分区 / 认不出时的「填写余额查询地址」 / 1280 — 点了打开编辑窗口并定位到这几栏。

参考：prd 第 2、3、17、20 条，用户故事 23–32、64。

实现时凡本工单没写明的细节，先查 magpie `7597c132` 的做法并照做（出处见 `research/decisions.md`）；比 magpie 少做或更严一律不行，除非 prd 写明。
