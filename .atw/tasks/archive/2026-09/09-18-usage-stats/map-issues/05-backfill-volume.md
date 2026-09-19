# 05 — 全量回填的耗时与内存量级

**Type:** research
**Blocked by:** None
**Status:** resolved

## Question

用一次性 node 脚本（放 scratch，不入库）对本机四个目录（合计约 1.45GB、约 1850 个 jsonl）做一遍只读扫描：逐行 JSON.parse 并按 (source, model, sessionId, cwd, UTC 小时桶) 分桶计数。测量：(1) 单线程全量解析耗时与峰值 RSS；(2) 产出的桶行数与去重后会话数；(3) 最大单文件体积与行数；(4) 若改为流式逐行读取而非整文件读入，内存差异。给出结论：回填是否需要 worker 线程、需不需要限速、内存聚合是否可承受一年量级。产出 `research/backfill-volume.md`，附脚本路径与原始数字。

## Answer

实测（2026-09-18，M3 Max，Node 24）：四目录 1,859 个 jsonl、1.39 GB、31 万行，单线程流式扫描 2.3 s，峰值 RSS 约 220 MB（扫描后堆 42 MB），产出 2,662 个 (source, model, sessionId, cwd, UTC 小时) 桶、1,708 个会话，数据跨 115 天。

- **不需要 worker 线程**：吞吐约 600 MB/s，一年量级约 7 s；用流式按 1 MB 块处理即可不阻塞事件循环。
- **需要让路而非限速**：每个文件之间 `await setImmediate()`，不加 sleep；IO 不是瓶颈。
- **内存聚合一年可承受**：桶数外推约 8,500，约 3 MB；十年仍在 30 MB 级。
- **流式 vs 整读**：最大文件 57 MB 整读峰值 286 MB、流式 122 MB；前 20 大文件（249 MB）整读 362 MB、流式 215 MB；堆上限 64 MB 时整读溢出、流式跑完。
- **批大小**：按文件处理，每 20 个文件或 500 ms 落盘一次游标与聚合行；进度按已读字节报。
- **坑**：Node `readline` 把 JSON 字符串内的裸 U+2028/U+2029 当换行，本机 13 个文件、56 行会被切碎丢弃，必须按 `\n` 字节自行切行（顺带快近一倍）。

原始数字表、最大文件与行、分布、脚本路径见 `research/backfill-volume.md`。
