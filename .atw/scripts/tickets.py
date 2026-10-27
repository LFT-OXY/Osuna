#!/usr/bin/env python3
"""票解析器 —— 安装到 .atw/scripts/tickets.py。

    list                 列出所有票 + Impl 状态
    frontier             算出「Impl: ready + Blocked by 全部 done」的票
    frontier --agent-only  同上，但 Status: ready-for-human 的票不进可开工列表，
                         另起一段列出；缺 Status 行按 ready-for-agent 算
    claim <NN>           校验在 frontier 里 → Impl: doing
                         → 记 implementation_base_sha
                         → 把该票路径写进 <task>/check.jsonl
    claim <NN> --parallel  并行批次认领（/atw-implement-spec 用）：允许多张票同时
                         doing，不写 check.jsonl 的当前票行，meta.ticket_mode = parallel
    done <NN>            标记 Impl: done，并撤掉 check.jsonl 里的那行
    revert <NN>          撤回这张票这次尝试的提交：串行时给 implementation_base_sha
                         之后的每个提交加反向提交（重试时上一次已撤过的那几个不再撤），
                         原提交留在历史里；只撤任务目录以外的改动；工单状态不变
    revert <NN> --with-uncommitted  只用于串行：先把任务目录以外没提交的改动（改过、
                         暂存、新建且没被忽略的）记成说明是这张票失败尝试的提交（暂存区
                         与工作区不一致时两个版本各记一个），再和认领以来的提交一起撤；工作区、暂存区回到认领时，被忽略的
                         文件、任务目录不动；和 --merge 同给是用法错误
    revert <NN> --merge <sha>  并行批次：撤回调用方指定的合入提交（按第一个父提交，
                         同 `git revert -m 1`）
    skip <NN> --reason <原因> --log-time <日志行时间>
                         标跳过、要人做：Impl → ready，Status → ready-for-human，
                         ## Comments 追加原因与决定日志那一行的时间；串行时撤掉
                         check.jsonl 的当前票行，并行时不动 check.jsonl。任务有
                         decision-log.md 时时间必须是其中已有的一行，没有时至少是
                         带时区、到秒的时间
    handback <NN> --decision <用户的决定>
                         交还给 AI：Status ready-for-human → ready-for-agent，
                         ## Comments 记下用户的决定
    评论语言跟着任务的决定日志走：英文表头写英文，没有日志或中文表头写中文
    summary              汇总一行，给 workflow-state 用
    selfcheck            跑内置断言，不依赖仓库状态

硬校验（直接拒绝，不是警告）：
    Blocker 引用不存在        → 失败
    Blocker 形成环            → 失败
    claim 不在 frontier 里的票 → 失败
    已有别的票在 doing        → 失败（票默认串行；--parallel 除外）

撤回只做 git 找得回来的事：只加反向提交，不 reset。任务目录（工单、
决定日志、截图……）保持撤回前的样子，不跟着回滚。撤回会改到的文件在工作区有没提交的
改动、或暂存区有东西 → 先拒绝，什么都不动；反向改动叠不上（冲突）→ 整体放弃、仓库没动。
带 --with-uncommitted 时先把任务目录以外没提交的改动记进提交（暂存区与工作区不一致时
暂存区、工作区各记一个），再照常检查，然后连同记录提交一起撤：这些改动会从工作区、暂存区
清掉、新建的文件会被删掉，但都能从记录提交里取回；叠不上时连记录提交也不留。

不要把这些函数塞进 task_utils.py / task.py：票是任务目录里的一层，任务目录和
meta 的读写一律走 task.py，本脚本不直接写 task.json。
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

from common.paths import DIR_SCRIPTS, DIR_WORKFLOW, get_repo_root
from decision_log import LOG_NAME, LogError, read_log

IMPL_STATES = ("ready", "doing", "done")

# Status 行回答「该谁做」。只有 frontier --agent-only 读它：claim / done / summary
# 和注入钩子都不看——否则用户自己做完的人工票就没法标成 done。
STATUS_AGENT = "ready-for-agent"
STATUS_HUMAN = "ready-for-human"

# 票文件名形如 01-slug.md，编号即前缀
RE_TICKET_FILE = re.compile(r"^(\d+)-.+\.md$")
# Blocked by 里允许 "01"、"#01"、"1" 三种写法
RE_BLOCKER = re.compile(r"#?(\d+)")

# 当前票写进 check.jsonl —— 审查轴拿它当规格来对，实现轴也读得到。
# 我们只动带这个 reason 的行，用户手工加的条目原样保留。
MANAGED_REASON = "ATW current ticket"
MANIFEST_NAME = "check.jsonl"

# 并行批次的标记写在 task.json 的 meta 里 —— 子代理注入 hook 靠它区分
# 「并行跑着多张票」和「票状态自相矛盾」。
META_TICKET_MODE = "ticket_mode"
MODE_PARALLEL = "parallel"
MODE_SERIAL = "serial"


def field_pattern(name: str) -> re.Pattern[str]:
    """匹配 `**Impl:** doing` 这类字段行。"""
    return re.compile(rf"^\*\*{re.escape(name)}:\*\*[ \t]*(.*)$", re.MULTILINE)


RE_IMPL = field_pattern("Impl")
RE_BLOCKED_BY = field_pattern("Blocked by")
RE_STATUS = field_pattern("Status")
RE_COMMENTS_HEADING = re.compile(r"^## Comments[ \t]*$", re.MULTILINE)
RE_H2 = re.compile(r"^## ", re.MULTILINE)


@dataclass
class Ticket:
    num: int
    path: Path
    impl: str
    blockers: list[int] = field(default_factory=list)
    status: str = STATUS_AGENT

    @property
    def label(self) -> str:
        return self.path.stem


class TicketError(Exception):
    """所有硬校验失败都走这里，main 统一转成退出码 1。"""


# ---------------------------------------------------------------------------
# 解析（纯函数，selfcheck 直接驱动这一层）
# ---------------------------------------------------------------------------

def parse_ticket(path: Path) -> Ticket:
    m = RE_TICKET_FILE.match(path.name)
    if not m:
        raise TicketError(f"票文件名不是 NN-slug.md 形式：{path.name}")
    text = path.read_text(encoding="utf-8")

    impl_match = RE_IMPL.search(text)
    if impl_match is None:
        raise TicketError(
            f"{path.name} 缺少 **Impl:** 字段。"
            " 这个字段由票模板写入，缺了说明票不是按模板生成的。"
        )
    impl = impl_match.group(1).strip().lower()
    if impl not in IMPL_STATES:
        raise TicketError(
            f"{path.name} 的 **Impl:** 是 {impl!r}，只允许 {'/'.join(IMPL_STATES)}"
        )

    blocked_match = RE_BLOCKED_BY.search(text)
    raw = blocked_match.group(1).strip() if blocked_match else ""
    blockers = [] if raw.lower() in ("", "none", "-", "无") else [
        int(x) for x in RE_BLOCKER.findall(raw)
    ]
    status_match = RE_STATUS.search(text)
    status = status_match.group(1).strip().lower() if status_match else ""
    return Ticket(num=int(m.group(1)), path=path, impl=impl, blockers=blockers,
                  status=status or STATUS_AGENT)


def load_tickets(issues_dir: Path) -> list[Ticket]:
    if not issues_dir.is_dir():
        return []
    tickets = [parse_ticket(p) for p in sorted(issues_dir.glob("*.md"))]
    seen: dict[int, Path] = {}
    for t in tickets:
        if t.num in seen:
            raise TicketError(f"票号 {t.num:02d} 重复：{seen[t.num].name} 和 {t.path.name}")
        seen[t.num] = t.path
    validate(tickets)
    return tickets


def validate(tickets: list[Ticket]) -> None:
    by_num = {t.num: t for t in tickets}
    for t in tickets:
        for b in t.blockers:
            if b not in by_num:
                raise TicketError(f"{t.label} 的 Blocked by 指向不存在的票 {b:02d}")

    # 环检测：白=未访问 / 灰=在当前递归栈上 / 黑=已确认无环
    color: dict[int, str] = {t.num: "white" for t in tickets}
    stack: list[int] = []

    def walk(num: int) -> None:
        color[num] = "grey"
        stack.append(num)
        for nxt in by_num[num].blockers:
            if color[nxt] == "grey":
                cycle = stack[stack.index(nxt):] + [nxt]
                raise TicketError(
                    "Blocker 形成环：" + " → ".join(f"{n:02d}" for n in cycle)
                )
            if color[nxt] == "white":
                walk(nxt)
        stack.pop()
        color[num] = "black"

    for t in tickets:
        if color[t.num] == "white":
            walk(t.num)


def frontier(tickets: list[Ticket]) -> list[Ticket]:
    by_num = {t.num: t for t in tickets}
    return [
        t for t in tickets
        if t.impl == "ready" and all(by_num[b].impl == "done" for b in t.blockers)
    ]


def split_by_assignee(tickets: list[Ticket]) -> tuple[list[Ticket], list[Ticket]]:
    """把一组票分成（AI 可做, 给人做）两列，顺序保持。"""
    human = [t for t in tickets if t.status == STATUS_HUMAN]
    agent = [t for t in tickets if t.status != STATUS_HUMAN]
    return agent, human


def set_impl(ticket: Ticket, state: str) -> None:
    text = ticket.path.read_text(encoding="utf-8")
    new_text, n = RE_IMPL.subn(f"**Impl:** {state}", text, count=1)
    if n != 1:
        raise TicketError(f"{ticket.label} 的 **Impl:** 字段写回失败")
    ticket.path.write_text(new_text, encoding="utf-8")
    ticket.impl = state


def set_status(ticket: Ticket, status: str) -> None:
    """写 Status 行；票没有这一行时插在 Impl 行前面。"""
    text = ticket.path.read_text(encoding="utf-8")
    new_text, n = RE_STATUS.subn(f"**Status:** {status}", text, count=1)
    if n == 0:
        new_text, n = RE_IMPL.subn(lambda m: f"**Status:** {status}\n{m.group(0)}",
                                   text, count=1)
    if n != 1:
        raise TicketError(f"{ticket.label} 的 **Status:** 字段写回失败")
    ticket.path.write_text(new_text, encoding="utf-8")
    ticket.status = status


def append_comment(ticket: Ticket, body: str) -> None:
    """在 `## Comments` 末尾追加 `- <日期> <内容>` 一行；没有这一节就在文件末尾新建。"""
    line = f"- {date.today().isoformat()} {body}\n"
    text = ticket.path.read_text(encoding="utf-8")
    heading = RE_COMMENTS_HEADING.search(text)
    if heading is None:
        text = text.rstrip("\n") + f"\n\n## Comments\n\n{line}"
    else:
        nxt = RE_H2.search(text, heading.end())
        end = nxt.start() if nxt else len(text)
        head = text[:end].rstrip("\n")
        # 只有标题、还没有评论时，标题和第一条之间空一行
        sep = "\n\n" if len(head) <= heading.end() else "\n"
        text = head + sep + line + (f"\n{text[end:]}" if nxt else "")
    ticket.path.write_text(text, encoding="utf-8")


def one_line(value: str | None) -> str:
    """评论一条只占一行：换行与连续空白合成一个空格。"""
    return " ".join((value or "").split())


# ---------------------------------------------------------------------------
# task.py 交界面
# ---------------------------------------------------------------------------

def repo_root() -> Path:
    """仓库根一律走 paths.get_repo_root（认 .atw/），不问 git。

    票在任务目录里，任务目录在 .atw/ 下——用 `git rev-parse` 会把一个还没
    `git init` 的项目判成「不是仓库」，票循环跟着一起停摆。
    """
    return get_repo_root().resolve()


def run(cmd: list[str], err: str, cwd: Path | None = None) -> str:
    proc = subprocess.run(cmd, capture_output=True, text=True, cwd=cwd)
    if proc.returncode != 0:
        raise TicketError(f"{err}：{proc.stderr.strip() or proc.stdout.strip()}")
    return proc.stdout.strip()


def task_py(root: Path) -> str:
    return str(root / DIR_WORKFLOW / DIR_SCRIPTS / "task.py")


def task_dir(root: Path, override: str | None) -> Path:
    """任务目录一律问 task.py，不自己解析 Session Pointer。"""
    if override:
        return (root / override).resolve()
    out = run(
        [sys.executable, task_py(root), "current", "--json"],
        "没有 Active Task —— 接上已有任务用 task.py resume <task>（task.py start 只用于进入 implement），不要退回 .scratch/",
        cwd=root,
    )
    rel = (json.loads(out).get("current_task") or {}).get("dir")
    if not rel:
        raise TicketError("没有 Active Task")
    return (root / rel).resolve()


def ticket_mode(task: Path) -> str:
    """只读 meta.ticket_mode；写一律走 task.py set-meta。"""
    try:
        data = json.loads((task / "task.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return MODE_SERIAL
    meta = data.get("meta") if isinstance(data, dict) else None
    mode = meta.get(META_TICKET_MODE) if isinstance(meta, dict) else None
    return MODE_PARALLEL if mode == MODE_PARALLEL else MODE_SERIAL


def base_sha(task: Path) -> str | None:
    """只读 meta.implementation_base_sha。"""
    try:
        data = json.loads((task / "task.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    meta = data.get("meta") if isinstance(data, dict) else None
    sha = meta.get("implementation_base_sha") if isinstance(meta, dict) else None
    return sha if isinstance(sha, str) and sha else None


def set_meta(root: Path, task: Path, key: str, value: str) -> None:
    run(
        [
            sys.executable, task_py(root), "set-meta",
            str(task.relative_to(root)), key, value,
        ],
        f"写 meta.{key} 失败",
        cwd=root,
    )


def record_base_sha(root: Path, task: Path) -> None:
    """记下 claim 时刻的 HEAD —— code-review 拿它当 diff 基线。

    仓库还没有 commit（新项目的第一张票）时 `git rev-parse HEAD` 必然失败。
    那种情况下基线就是「空仓库」，本来也没有 diff 可对，所以警告一声继续，
    不能让第一张票 claim 不动。
    """
    proc = subprocess.run(
        ["git", "rev-parse", "HEAD"], capture_output=True, text=True, cwd=root
    )
    if proc.returncode != 0:
        print(
            "警告：取不到 HEAD（仓库还没有 commit？），"
            "implementation_base_sha 未记录，code-review 需自行指定基线",
            file=sys.stderr,
        )
        return
    set_meta(root, task, "implementation_base_sha", proc.stdout.strip())


def rewrite_manifest(root: Path, task: Path, ticket: Ticket | None) -> None:
    """把当前票写进 check.jsonl —— 子代理拿到票的唯一通路。

    task.py 只有 add-context，没有删除命令，所以切票必须自己重写：先滤掉我们
    上一次写的那行（靠 MANAGED_REASON 认领），再按需追加新的。
    """
    manifest = task / MANIFEST_NAME
    lines: list[str] = []
    if manifest.exists():
        for line in manifest.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                if json.loads(line).get("reason") == MANAGED_REASON:
                    continue
            except json.JSONDecodeError:
                raise TicketError(f"{MANIFEST_NAME} 有非法 JSON 行：{line[:60]}")
            lines.append(line)
    if ticket is not None:
        rel = ticket.path.resolve().relative_to(root).as_posix()
        lines.append(json.dumps(
            {"file": rel, "reason": MANAGED_REASON}, ensure_ascii=False
        ))
    manifest.write_text("".join(f"{l}\n" for l in lines), encoding="utf-8")


# ---------------------------------------------------------------------------
# 命令
# ---------------------------------------------------------------------------

def pick(tickets: list[Ticket], num: str) -> Ticket:
    for t in tickets:
        if t.num == int(num):
            return t
    raise TicketError(f"没有编号为 {num} 的票")


def cmd_list(tickets: list[Ticket], **_) -> int:
    if not tickets:
        print("(没有票)")
        return 0
    open_nums = {t.num for t in frontier(tickets)}
    for t in tickets:
        mark = " ←frontier" if t.num in open_nums else ""
        blockers = ", ".join(f"{b:02d}" for b in t.blockers) or "-"
        print(f"{t.num:02d}  {t.impl:<5}  blocked-by: {blockers:<12} {t.label}{mark}")
    return 0


def cmd_frontier(tickets: list[Ticket], agent_only: bool = False, **_) -> int:
    ready = frontier(tickets)
    # 不带开关时输出必须与加开关之前逐字相同——编排者之外的调用方都靠它
    human: list[Ticket] = []
    if agent_only:
        ready, human = split_by_assignee(ready)
    if not ready:
        # 「没票」和「只剩人工票」要分得开，编排者据此决定是收尾还是停下等用户
        print(f"(frontier 里只剩 {STATUS_HUMAN} 的票)" if human else "(frontier 为空)")
    for t in ready:
        print(f"{t.num:02d}  {t.label}")
    if human:
        print()
        print(f"{STATUS_HUMAN}，不派给 AI，等用户做完后照常 claim / done：")
        for t in human:
            print(f"{t.num:02d}  {t.label}")
    return 0


def ensure_claimable(tickets: list[Ticket], target: Ticket, parallel: bool) -> None:
    # 票默认串行：同一任务一次只推进一张。并行批次是唯一的例外
    busy = [t for t in tickets if t.impl == "doing"]
    if busy and not parallel:
        raise TicketError(
            f"{busy[0].label} 还在 doing。票默认串行，先 done 它再 claim 下一张"
        )
    if target not in frontier(tickets):
        blocked = [f"{b:02d}" for b in target.blockers
                   if pick(tickets, str(b)).impl != "done"]
        reason = f"未完成的 Blocker：{', '.join(blocked)}" if blocked \
            else f"Impl 是 {target.impl}，不是 ready"
        raise TicketError(f"{target.label} 不在 frontier 里（{reason}）")


def cmd_claim(tickets: list[Ticket], root: Path, task: Path, num: str,
              parallel: bool = False, **_) -> int:
    target = pick(tickets, num)
    if target.impl == "doing":
        print(f"{target.label} 已经在 doing，无需重复 claim")
        return 0
    first_of_batch = not any(t.impl == "doing" for t in tickets)
    ensure_claimable(tickets, target, parallel)

    set_impl(target, "doing")
    if parallel:
        # 基线只在批次的第一张票上记：之后 HEAD 随合并前移，再记就把已合并的
        # 票排除在整批审查的 diff 之外了
        if first_of_batch:
            record_base_sha(root, task)
        # 并行批次没有「唯一的当前票」，check.jsonl 里不留当前票行
        rewrite_manifest(root, task, None)
        if ticket_mode(task) != MODE_PARALLEL:
            set_meta(root, task, META_TICKET_MODE, MODE_PARALLEL)
        print(f"claimed {target.label} → Impl: doing（并行批次）")
        return 0
    record_base_sha(root, task)
    rewrite_manifest(root, task, target)
    if ticket_mode(task) == MODE_PARALLEL:
        set_meta(root, task, META_TICKET_MODE, MODE_SERIAL)
    print(f"claimed {target.label} → Impl: doing")
    return 0


def cmd_done(tickets: list[Ticket], root: Path, task: Path, num: str, **_) -> int:
    target = pick(tickets, num)
    if target.impl == "done":
        print(f"{target.label} 已经是 done")
        return 0
    # ready 直接跳 done 会绕过 claim，implementation_base_sha 停在上一张票，
    # 之后的 code-review 会拿错基线去 diff —— 状态看着对，审的范围是错的。
    if target.impl != "doing":
        raise TicketError(
            f"{target.label} 的 Impl 是 {target.impl}，不是 doing。"
            f"先 claim {num} 再 done —— 跳过 claim 会让 implementation_base_sha "
            "停在上一张票，code-review 的 diff 基线就错了"
        )
    set_impl(target, "done")
    rewrite_manifest(root, task, None)
    left = frontier(tickets)
    if not left and all(t.impl == "done" for t in tickets):
        # 实测过一次：三张票全 done，但没人推挡位，归档门禁卡住且没人知道为什么
        print(f"{target.label} → Impl: done。全部票已完成 —— "
              f"下一步 `task.py set-status {task} accept`")
        return 0
    nxt = "、".join(f"{t.num:02d}" for t in left) or "无（全部完成或被阻塞）"
    print(f"{target.label} → Impl: done。下一批可开工：{nxt}")
    return 0


# 反向提交说明里的那句（与 git revert 写的一样），重试时靠它认出上一次已经撤过的提交
RE_REVERTS = re.compile(r"^This reverts commit ([0-9a-f]{40})", re.MULTILINE)
# 决定日志的时间：本地时间带时区、到秒（decision_log.py 写的样子）
RE_LOG_TIME = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$")


def git(cwd: Path, *args: str) -> str:
    return run(["git", *args], f"git {args[0]} 失败", cwd=cwd)


def git_bytes(cwd: Path, args: list[str], env: dict[str, str] | None = None,
              stdin: bytes | None = None) -> bytes:
    """不 strip、按字节读写的 git 调用：补丁、-z 输出都要原样。"""
    proc = subprocess.run(["git", *args], input=stdin, capture_output=True, cwd=cwd, env=env)
    if proc.returncode != 0:
        msg = proc.stderr.decode("utf-8", "replace").strip()
        raise TicketError(f"git {args[0]} 失败：{msg}")
    return proc.stdout


def outside_task(task_rel: str) -> list[str]:
    """pathspec：整个仓库，除了任务目录——任务记录不跟着撤回。"""
    return ["--", ":(top)", f":(top,exclude){task_rel}"]


def ensure_revertable(top: Path, task_rel: str, commits: list[str],
                      recorded: bool = False) -> None:
    """撤回前的检查，任何一项不过都在动手之前拒绝。

    recorded：任务目录以外没提交的改动已记进提交、会一起撤，只剩任务目录要查。
    """
    touched: set[str] = set()
    for sha in commits:
        # 和下面的 status 一样用 -z、同样解码：不带 -z 时中文等文件名会被转义、加引号，对不上
        out = git_bytes(top, ["diff", "--name-only", "-z", "--no-renames", f"{sha}^1", sha,
                              *outside_task(task_rel)])
        touched.update(f for f in out.decode("utf-8", "surrogateescape").split("\0") if f)

    staged: list[str] = []
    dirty: list[str] = []
    # -z 下路径相对 git 顶层、不加引号；改名条目后面多跟一个原路径
    raw = git_bytes(top, ["status", "--porcelain", "-z", "--untracked-files=all",
                          *(["--", f":(top){task_rel}"] if recorded else [])])
    entries = raw.decode("utf-8", "surrogateescape").split("\0")
    i = 0
    while i < len(entries):
        entry = entries[i]
        i += 1
        if not entry:
            continue
        x, path = entry[0], entry[3:]
        if x in "RC":
            i += 1
        if x not in " ?":
            staged.append(path)
        if path in touched:
            dirty.append(path)
    if staged:
        raise TicketError(
            "暂存区有改动（" + "、".join(staged) + "），撤回不在这种时候动手。"
            "先 `git restore --staged <文件>` 取消暂存（改动留在工作区）再撤"
        )
    if dirty:
        raise TicketError(
            "这些文件有没提交的改动，撤回会改到它们：" + "、".join(dirty)
            + "。先提交或手工处理掉再撤"
        )


def snapshot(top: Path, task_rel: str, head: str) -> tuple[str, str]:
    """任务目录以外暂存区、工作区此刻的样子，各写成一棵树返回；真索引不动。"""
    with tempfile.TemporaryDirectory() as d:
        env = {**os.environ, "GIT_INDEX_FILE": str(Path(d) / "index")}
        git_bytes(top, ["read-tree", head], env=env)
        # 暂存区的样子：真索引相对 head 的改动叠进临时索引
        patch = git_bytes(top, ["diff", "--cached", "--binary", head, *outside_task(task_rel)])
        if patch:
            git_bytes(top, ["apply", "--cached"], env=env, stdin=patch)
        staged_tree = git_bytes(top, ["write-tree"], env=env).decode().strip()
        # 工作区的样子：改过的、暂存的、新建的都进，被忽略的不进
        git_bytes(top, ["add", "-A", *outside_task(task_rel)], env=env)
        work_tree = git_bytes(top, ["write-tree"], env=env).decode().strip()
    return staged_tree, work_tree


def record_uncommitted(top: Path, task_rel: str, target: Ticket) -> tuple[list[str], str]:
    """把任务目录以外没提交的改动记成接在 HEAD 后面的提交，返回它们（旧的在前）和记下的暂存区那棵树；
    没有改动时提交为空。

    暂存区与工作区一致时记一个；不一致时先记暂存区的样子、再在它上面记工作区的样子，
    两个版本都找得回。只建提交对象、不挪 HEAD：撤回整体放弃时它们不在任何分支上。
    和反向提交一样不跑提交钩子。
    """
    head = git(top, "rev-parse", "HEAD")
    staged_tree, work_tree = snapshot(top, task_rel, head)

    def record(tree: str, parent: str, what: str) -> str:
        message = (f"Record the {what} changes of the failed attempt at {target.label}\n\n"
                   "Written by tickets.py revert --with-uncommitted and reverted right after it.\n")
        return git_bytes(top, ["commit-tree", tree, "-p", parent, "-F", "-"],
                         stdin=message.encode("utf-8")).decode().strip()

    head_tree = git(top, "rev-parse", f"{head}^{{tree}}")
    records: list[str] = []
    if staged_tree not in (head_tree, work_tree):
        records.append(record(staged_tree, head, "staged"))
    if work_tree != (staged_tree if records else head_tree):
        records.append(record(work_tree, records[-1] if records else head,
                              "working-tree" if records else "uncommitted"))
    return records, staged_tree


def make_reverts(top: Path, task_rel: str, commits: list[str],
                 records: list[str] | None = None, recorded_index: str = "") -> list[str]:
    """按给的顺序（新的在前）逐个加反向提交，只撤任务目录以外的改动；返回撤了的原提交。

    不用 git revert：它要连任务目录一起撤，而任务目录里常有没提交的记录（决定日志又多了
    几行），git revert 会因此拒绝。改为在临时索引里叠好全部反向提交、再一次挪 HEAD——
    任何一个叠不上（冲突）就整体放弃，HEAD 和工作区都没动过。和 git revert 一样不跑提交钩子。
    给了 records（record_uncommitted 的记录提交，recorded_index 是记下的暂存区那棵树）时
    从最新的那个叠起、连它们一起撤，并把仍是记下那份的改动从工作区、暂存区清回去。
    """
    head = git(top, "rev-parse", "HEAD")
    reverted: list[str] = []
    tip = head
    if records:
        commits = [*reversed(records), *commits]
        tip = records[-1]
    with tempfile.TemporaryDirectory() as d:
        env = {**os.environ, "GIT_INDEX_FILE": str(Path(d) / "index")}
        git_bytes(top, ["read-tree", tip], env=env)
        for sha in commits:
            # 第一个父提交为准：普通提交就是它的父提交，合入提交就是 -m 1
            patch = git_bytes(top, ["diff", "--binary", sha, f"{sha}^1",
                                    *outside_task(task_rel)])
            if not patch:
                continue
            try:
                git_bytes(top, ["apply", "--cached"], env=env, stdin=patch)
            except TicketError as e:
                short = git(top, "log", "-1", "--format=%h %s", sha)
                raise TicketError(f"{short} 的反向改动和现在的代码冲突，撤回整体放弃、"
                                  f"仓库没动。{e}") from e
            tree = git_bytes(top, ["write-tree"], env=env).decode().strip()
            subject = git(top, "log", "-1", "--format=%s", sha)
            message = f'Revert "{subject}"\n\nThis reverts commit {sha}.\n'
            if git(top, "diff", "--name-only", f"{sha}^1", sha, "--", f":(top){task_rel}"):
                message += f"\nChanges under {task_rel} were kept: task records are not rolled back.\n"
            tip = git_bytes(top, ["commit-tree", tree, "-p", tip, "-F", "-"],
                            stdin=message.encode("utf-8")).decode().strip()
            reverted.append(sha)
    if not reverted:
        return []
    git(top, "update-ref", "-m", "tickets.py revert", "HEAD", tip, head)
    literal = {**os.environ, "GIT_LITERAL_PATHSPECS": "1"}

    def names(*args: str | bytes) -> set[bytes]:
        return {p for p in git_bytes(top, [*args], env=literal).split(b"\0") if p}

    # 让索引与工作区跟上新 HEAD：只动这几个反向提交改到的文件。不带记录提交时它们事先查过
    # 没有未提交改动；带记录提交时，没提交的改动都已记下，它们的文件一起清回新 HEAD
    paths = names("diff", "--name-only", "-z", "--no-renames", head, tip)
    if records:
        for r in records:
            paths |= names("diff", "--name-only", "-z", "--no-renames", head, r)
        # 只清此刻仍是记下那份的：记录之后才新建或又改过的（暂存区或工作区）git 里找不回，原样留下
        staged_now, work_now = snapshot(top, task_rel, head)
        for was, now in ((recorded_index, staged_now), (records[-1], work_now)):
            paths -= names("diff", "--name-only", "-z", "--no-renames", was, now)
        # 工作区有、记下的工作区却没有的（被忽略、从没记下）git 里找不回：工作区不动，只清暂存区
        recorded = names("ls-tree", "-r", "-z", "--name-only", records[-1])
        unsaved = {p for p in paths - recorded if os.path.lexists(top / os.fsdecode(p))}
        # 整份列出再取交集，路径不走命令行参数，改动再多也不超长
        known = names("ls-files", "-z") | names("ls-tree", "-r", "-z", "--name-only", tip)
        index_only = sorted(unsaved & known)
        paths -= unsaved
        # restore 认不出新 HEAD 和索引里都没有的：只在工作区的新建文件删掉，哪儿都没有的
        # （提交过又暂存删除的新文件）已经是该有的样子
        for p in paths - known:
            f = top / os.fsdecode(p)
            if not os.path.lexists(f):
                continue
            f.unlink()
            for parent in f.parents:
                if parent == top or any(parent.iterdir()):
                    break
                parent.rmdir()
        paths &= known
        if index_only:
            git_bytes(top, ["restore", "--source=HEAD", "--staged",
                            "--pathspec-from-file=-", "--pathspec-file-nul"],
                      env=literal, stdin=b"\0".join(index_only))
    paths = sorted(paths)
    if paths:
        git_bytes(top, ["restore", "--source=HEAD", "--staged", "--worktree",
                        "--pathspec-from-file=-", "--pathspec-file-nul"],
                  env=literal, stdin=b"\0".join(paths))
    return reverted


def serial_attempt_commits(top: Path, task: Path, target: Ticket) -> list[str]:
    """串行：认领以来的提交（沿第一个父提交），新的在前；上一次已撤过的连同它的反向提交一起跳过。"""
    if target.impl != "doing":
        raise TicketError(
            f"{target.label} 的 Impl 是 {target.impl}，不是 doing。"
            "implementation_base_sha 记的是正在 doing 的那张票的认领点，撤别的票会撤错范围"
        )
    base = base_sha(task)
    if base is None:
        raise TicketError("task.json 里没有 meta.implementation_base_sha，不知道从哪撤起")
    probe = subprocess.run(["git", "merge-base", "--is-ancestor", base, "HEAD"],
                           capture_output=True, text=True, cwd=top)
    if probe.returncode != 0:
        raise TicketError(f"implementation_base_sha {base[:12]} 不在当前分支的历史里")
    commits = git(top, "rev-list", "--first-parent", f"{base}..HEAD").splitlines()
    skip: set[str] = set()
    for sha in commits:
        m = RE_REVERTS.search(git(top, "log", "-1", "--format=%B", sha))
        if m and m.group(1) in commits:
            skip.update((sha, m.group(1)))
    return [c for c in commits if c not in skip]


def cmd_revert(tickets: list[Ticket], root: Path, task: Path, num: str,
               merge: str | None = None, with_uncommitted: bool = False, **_) -> int:
    target = pick(tickets, num)
    parallel = ticket_mode(task) == MODE_PARALLEL
    if with_uncommitted and parallel:
        raise TicketError("--with-uncommitted 只用于串行；并行批次的改动在各自的分支上")
    if parallel and not merge:
        raise TicketError(
            "并行批次没有每张票各自的认领点，用 --merge <sha> 指定要撤的合入提交"
        )
    if merge and not parallel:
        raise TicketError("--merge 只给并行批次用；串行时直接 revert <NN>，撤认领以来的提交")
    top = Path(git(root, "rev-parse", "--show-toplevel")).resolve()
    task_rel = task.resolve().relative_to(top).as_posix() + "/"
    if parallel:
        commits = [git(top, "rev-parse", "--verify", f"{merge}^{{commit}}")]
        if len(git(top, "rev-list", "--parents", "-n", "1", commits[0]).split()) < 3:
            raise TicketError(f"{merge} 不是合入提交；--merge 要给并行批次合入这张票的那个提交")
    else:
        commits = serial_attempt_commits(top, task, target)
    # 带开关时先记录：任务目录以外的改动都进了记录提交、会一起撤，检查只剩任务目录
    records, recorded_index = (record_uncommitted(top, task_rel, target) if with_uncommitted
                               else ([], ""))
    ensure_revertable(top, task_rel, commits, recorded=bool(records))
    reverted = make_reverts(top, task_rel, commits, records, recorded_index)
    if not reverted:
        print(f"{target.label} 认领以来没有要撤的提交（任务目录以外没有改动）")
        return 0
    shorts = "、".join(c[:7] for c in reverted)
    if records:
        print(f"先把没提交的改动记成提交 {'、'.join(r[:7] for r in records)}，", end="")
    print(f"撤回 {target.label} 的 {len(reverted)} 个提交（{shorts}），原提交留在历史里；"
          f"任务目录 {task_rel} 保持撤回前的样子；工单状态没动（Impl 仍是 {target.impl}）")
    return 0


# ## Comments 里两种评论的写法，语言跟着任务的决定日志走（没有日志按中文）
COMMENT_TEXT = {
    "zh": {"skip": "跳过，要人做：{reason}（决定日志 {time} 那一行）",
           "handback": "交还给 AI：{decision}"},
    "en": {"skip": "skipped, needs a human: {reason} (decision log row {time})",
           "handback": "handed back to the AI: {decision}"},
}


def task_log(task: Path) -> tuple[str, set[str]] | None:
    """任务的决定日志：(语言, 各行时间)；没有日志返回 None。"""
    try:
        found = read_log(task / LOG_NAME)
    except LogError as e:
        raise TicketError(str(e)) from e
    if found is None:
        return None
    lang, rows = found
    return lang, {r.raw_time for r in rows}


def comment_lang(task: Path) -> str:
    found = task_log(task)
    return found[0] if found else "zh"


def cmd_skip(tickets: list[Ticket], root: Path, task: Path, num: str,
             reason: str | None = None, log_time: str | None = None, **_) -> int:
    target = pick(tickets, num)
    reason, log_time = one_line(reason), one_line(log_time)
    if not reason:
        raise TicketError("skip 需要 --reason：为什么跳过、要人做什么")
    if not log_time:
        raise TicketError("skip 需要 --log-time：决定日志里记这次跳过的那一行的时间")
    # 一行由它的时间唯一指称：有日志就必须指到日志里已有的一行
    found = task_log(task)
    if found is not None and log_time not in found[1]:
        raise TicketError(f"{task / LOG_NAME} 里没有时间为 {log_time} 的行；"
                          "先用 decision_log.py 记下这次跳过，再把那一行的时间传给 --log-time")
    if found is None and not RE_LOG_TIME.match(log_time):
        raise TicketError(f"--log-time {log_time} 不是带时区、到秒的时间"
                          "（形如 2026-10-18T15:30:12+08:00）")
    lang = found[0] if found else "zh"
    was_doing = target.impl == "doing"
    set_impl(target, "ready")
    set_status(target, STATUS_HUMAN)
    append_comment(target, COMMENT_TEXT[lang]["skip"].format(reason=reason, time=log_time))
    # 串行时这张票就是 check.jsonl 里的当前票，跳过后它不再在做；
    # 并行批次本来就没有当前票行，不动这个文件
    if was_doing and ticket_mode(task) != MODE_PARALLEL:
        rewrite_manifest(root, task, None)
    print(f"{target.label} → Impl: ready，Status: {STATUS_HUMAN}（跳过，要人做）")
    return 0


def cmd_handback(tickets: list[Ticket], task: Path, num: str,
                 decision: str | None = None, **_) -> int:
    target = pick(tickets, num)
    decision = one_line(decision)
    if not decision:
        raise TicketError("handback 需要 --decision：用户拍板的决定")
    if target.status != STATUS_HUMAN:
        raise TicketError(
            f"{target.label} 的 Status 是 {target.status}，不是 {STATUS_HUMAN}，没有要交还的"
        )
    set_status(target, STATUS_AGENT)
    append_comment(target, COMMENT_TEXT[comment_lang(task)]["handback"].format(decision=decision))
    print(f"{target.label} → Status: {STATUS_AGENT}（交还给 AI）")
    return 0


def cmd_summary(tickets: list[Ticket], **_) -> int:
    if not tickets:
        print("票 0 张")
        return 0
    doing = [t for t in tickets if t.impl == "doing"]
    done = [t for t in tickets if t.impl == "done"]
    parts = [f"票 {len(tickets)} 张", f"done {len(done)}"]
    parts.append("doing " + ("、".join(t.label for t in doing) or "-"))
    parts.append("frontier " + ("、".join(f"{t.num:02d}" for t in frontier(tickets)) or "-"))
    print(" | ".join(parts))
    return 0


# ---------------------------------------------------------------------------
# 自检：只驱动纯函数，不需要仓库、Active Task 或 git
# ---------------------------------------------------------------------------

TICKET_TMPL = """# {num:02d} — {slug}

**Status:** {status}
**Impl:** {impl}
**Blocked by:** {blocked}
**Issue:**

## What to build
略
"""


def cmd_selfcheck(**_) -> int:
    def build(tmp: Path, specs) -> list[Ticket]:
        for n, impl, blocked, *rest in specs:
            status = rest[0] if rest else STATUS_AGENT
            (tmp / f"{n:02d}-t{n}.md").write_text(
                TICKET_TMPL.format(num=n, slug=f"t{n}", impl=impl, blocked=blocked,
                                   status=status),
                encoding="utf-8",
            )
        return load_tickets(tmp)

    def fails(fn, needle: str) -> None:
        try:
            fn()
        except TicketError as e:
            assert needle in str(e), f"错误信息不含 {needle!r}：{e}"
            return
        raise AssertionError(f"本该失败却通过了（期望 {needle!r}）")

    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)

        # 01 无阻塞、02 被 01 挡、03 的阻塞已 done
        ts = build(tmp, [(1, "ready", "none"), (2, "ready", "01"), (3, "ready", "04"),
                         (4, "done", "none")])
        assert [t.num for t in frontier(ts)] == [1, 3], [t.num for t in frontier(ts)]

        # 01 做完后 02 进入 frontier
        set_impl(ts[0], "done")
        assert [t.num for t in frontier(load_tickets(tmp))] == [2, 3]

        # doing 的票不算 frontier —— 否则会被重复认领
        set_impl(ts[1], "doing")
        assert [t.num for t in frontier(load_tickets(tmp))] == [3]

    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        # Status 行只影响 --agent-only 的分列：01 给 AI、02 给人、03 没写 Status 行
        # 按 ready-for-agent 算、04 给人但被 02 挡着——不在 frontier，两列都不出现
        (tmp / "03-t3.md").write_text(
            "# 03\n\n**Impl:** ready\n**Blocked by:** none\n", encoding="utf-8")
        ts = build(tmp, [(1, "ready", "none"), (2, "ready", "none", STATUS_HUMAN),
                         (4, "ready", "02", STATUS_HUMAN)])
        assert ts[2].status == STATUS_AGENT, ts[2].status
        agent, human = split_by_assignee(frontier(ts))
        assert [t.num for t in agent] == [1, 3], [t.num for t in agent]
        assert [t.num for t in human] == [2], [t.num for t in human]
        # frontier 本身不读 Status：人工票照样在里面，claim / done 才能对它生效
        assert [t.num for t in frontier(ts)] == [1, 2, 3]
        # 只剩人工票时 agent 列为空、human 列非空——cmd_frontier 靠这个区分两种空
        agent, human = split_by_assignee([ts[1]])
        assert agent == [] and [t.num for t in human] == [2]

    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        # ready 直接 done 必须被拒 —— 绕过 claim 就没写 implementation_base_sha
        ts = build(tmp, [(1, "ready", "none"), (2, "doing", "none")])
        fails(lambda: cmd_done(ts, tmp, tmp, "01"), "不是 doing")
        assert load_tickets(tmp)[0].impl == "ready", "被拒之后不该改动票"
        # doing 的票正常收掉
        assert cmd_done(ts, tmp, tmp, "02") == 0
        assert load_tickets(tmp)[1].impl == "done"
        # 重复 done 幂等，不报错
        assert cmd_done(load_tickets(tmp), tmp, tmp, "02") == 0

    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        ts = build(tmp, [(1, "doing", "none"), (2, "ready", "none"), (3, "ready", "02")])
        fails(lambda: ensure_claimable(ts, ts[1], parallel=False), "票默认串行")
        ensure_claimable(ts, ts[1], parallel=True)  # 并行批次放行第二张 doing
        # 并行不绕过阻塞：Blocker 没 done 的票照样认领不了
        fails(lambda: ensure_claimable(ts, ts[2], parallel=True), "不在 frontier 里")

    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        assert ticket_mode(tmp) == MODE_SERIAL  # 没有 task.json 按串行算
        (tmp / "task.json").write_text(
            json.dumps({"meta": {META_TICKET_MODE: MODE_PARALLEL}}), encoding="utf-8")
        assert ticket_mode(tmp) == MODE_PARALLEL

    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        fails(lambda: build(tmp, [(1, "ready", "09")]), "不存在的票")

    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        fails(lambda: build(tmp, [(1, "ready", "02"), (2, "ready", "01")]), "形成环")

    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        fails(lambda: build(tmp, [(1, "ready", "01")]), "形成环")  # 自环

    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        fails(lambda: build(tmp, [(1, "claimed", "none")]), "只允许")

    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        (tmp / "01-t1.md").write_text("# 01\n\n**Status:** ready-for-agent\n",
                                      encoding="utf-8")
        fails(lambda: load_tickets(tmp), "缺少 **Impl:** 字段")

    # check.jsonl：只换自己写的行，用户手工加的条目原样保留
    with tempfile.TemporaryDirectory() as d:
        root = Path(d).resolve()  # macOS 的 /var 是 /private/var 的软链，两边都要 resolve
        task = root / DIR_WORKFLOW / "tasks/demo"
        issues = task / "issues"
        issues.mkdir(parents=True)
        ts = build(issues, [(1, "ready", "none"), (2, "ready", "none")])
        manifest = task / MANIFEST_NAME
        manifest.write_text(
            json.dumps({"file": "docs/adr/0001.md", "reason": "手工加的"}) + "\n",
            encoding="utf-8",
        )
        rewrite_manifest(root, task, ts[0])
        rewrite_manifest(root, task, ts[1])  # 切票
        rows = [json.loads(l) for l in manifest.read_text(encoding="utf-8").splitlines()]
        assert len(rows) == 2, rows
        assert rows[0]["reason"] == "手工加的"
        assert rows[1]["file"].endswith("02-t2.md"), rows[1]
        rewrite_manifest(root, task, None)  # done 之后撤掉
        rows = [json.loads(l) for l in manifest.read_text(encoding="utf-8").splitlines()]
        assert len(rows) == 1 and rows[0]["reason"] == "手工加的", rows

    print("selfcheck 通过")
    return 0


COMMANDS = {
    "list": cmd_list, "frontier": cmd_frontier, "claim": cmd_claim,
    "done": cmd_done, "summary": cmd_summary, "selfcheck": cmd_selfcheck,
    "revert": cmd_revert, "skip": cmd_skip, "handback": cmd_handback,
}


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="ATW 票解析器")
    p.add_argument("command", choices=sorted(COMMANDS))
    p.add_argument("num", nargs="?", help="票号，claim / done 用")
    p.add_argument("--task-dir", help="仓库相对的任务目录，缺省问 task.py current")
    p.add_argument("--parallel", action="store_true",
                   help="claim 用：并行批次认领，允许多张票同时 doing")
    p.add_argument("--agent-only", action="store_true",
                   help=f"frontier 用：只列 AI 可做的票，Status: {STATUS_HUMAN} 的另列一段")
    p.add_argument("--merge", metavar="SHA",
                   help="revert 用：并行批次里要撤的合入提交（git revert -m 1）")
    p.add_argument("--with-uncommitted", action="store_true",
                   help="revert 用、只用于串行：先把任务目录以外没提交的改动记成提交再一起撤")
    p.add_argument("--reason", help="skip 用：为什么跳过、要人做什么")
    p.add_argument("--log-time", help="skip 用：决定日志里记这次跳过的那一行的时间")
    p.add_argument("--decision", help="handback 用：用户拍板的决定")
    args = p.parse_args(argv)
    if args.with_uncommitted and args.merge:
        p.error("--with-uncommitted 只用于串行，不能和 --merge 同给")

    try:
        if args.command == "selfcheck":
            return cmd_selfcheck()
        if args.command in ("claim", "done", "revert", "skip", "handback") \
                and not args.num:
            raise TicketError(f"{args.command} 需要票号")
        root = repo_root()
        task = task_dir(root, args.task_dir)
        tickets = load_tickets(task / "issues")
        return COMMANDS[args.command](
            tickets=tickets, root=root, task=task, num=args.num,
            parallel=args.parallel, agent_only=args.agent_only, merge=args.merge,
            with_uncommitted=args.with_uncommitted,
            reason=args.reason, log_time=args.log_time, decision=args.decision,
        )
    except TicketError as e:
        print(f"错误：{e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
