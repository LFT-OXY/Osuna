#!/usr/bin/env python3
"""跨模型复查脚本 —— 安装到 .atw/scripts/cross_model_review.py。

    cross_model_review.py prepare --questions <题目文件>
                                  --reviewer "<工具> model=<模型> [effort=<强度>]" [...]
                                  [--task <任务目录>] [--intent-file <意图文件>]
                                  [--since <起点>] [--path <文件夹或文件> ...]
                                  [--whole | --group "<文件夹>,<文件夹>" ...]
                                  [--expect-base <起点提交> --expect-patch <补丁哈希>]
                                  [--recheck <快照> --picked-file <选去改的条目>]
                                  [--pick '<这一轮 pick 输出的 JSON>'] [--lang zh|en]
    cross_model_review.py prepare-log --questions <题目文件> --reviewer "<…>" [...] --task <任务目录>
                                      [--whole | --session [对话编号]] [--pick '<pick 输出的 JSON>'] [--lang zh|en]
                                      （日志复查的材料）
    cross_model_review.py run <编号>
    cross_model_review.py family | probe | pick | wizard      （认家、查工具、定复查员、设置向导）
    cross_model_review.py pick --settings-only [--model-line …] [--author …]   （无人值守：只看设置）
    cross_model_review.py afk-notice --skill <连做命令> --branch <分支> [--new-branch] [--max N] --task <任务目录>
                                     [--model-line …] [--author …] [--lang zh|en]   （无人值守的开跑提醒）
    cross_model_review.py host                               （宿主的围栏：在不在、能否申请到围栏外）
    cross_model_review.py settings | check | save            （复查员设置：读、验证、验证后写入）
    cross_model_review.py report --file <报告草稿> [--task <任务目录> [--log-review] | --append <已存的报告>]
                                                             （打码、存报告）

prepare：在仓库根目录冻结一份补丁、组好材料与题目，放进
`.atw/.runtime/cross-model-review/<编号>/`，标准输出给一个 JSON 对象（编号、补丁、
起点提交、文件、总行数与各文件夹行数、跳过的像密钥文件、只记路径的文件、复查员）。
默认范围：当前分支与主线的合并基点以来的全部改动，连同工作区，再加未跟踪（未忽略）
的文件；排除 `.atw/tasks/`、`.atw/workspace/`；未跟踪文件里名字像密钥的不放入、只列出；
二进制与大文件只记路径。行数是加与删合计，不含上面排除的部分。
主线取 `--task` 的 `task.json` 里的 `base_branch`，没有任务时取仓库默认主线；就在主线上
时只查未提交的改动；`--since` 给起点（提交、分支、标签）、`--path` 只看某些文件夹或文件。
没有改动时给 `stop: "no-changes"`、超过 500 行时给 `stop: "over-limit"` 与按文件夹的分组
建议，两种都不冻结；用户选了整段看加 `--whole`，选了分开看每组一个 `--group`，每组各冻结
一份、材料相同。
冻结先把这次看到的整个工作区状态（同样的排除规则，不收像密钥的未跟踪文件）存成一个
git 快照，补丁就从起点到这个快照算；快照挂在 `refs/atw/cross-model-review/<快照>` 下（不在
任何分支上，不改工作区与暂存区），编号给在 `snapshot`，`--path` 的范围记在它的提交说明里；
写材料出错退出 2 时引用与写了一半的目录一并撤掉。复核时 `--recheck <快照>` 以它为起点，
只冻结那之后的改动（`baseFrom: "snapshot"`，不给 `--path` 时照用快照记下的范围），材料另加
`--picked-file` 给的上次选去改的条目；没有改动时给 `stop: "no-changes-since-snapshot"`，
不冻结、不留新快照。
冻结了的输出另带 `notice`（`zh`、`en` 各一段）：开跑前那段交代，由 AI 原样贴出，只列用得上的项；
点名的、作者是哪家、设置里谁这次不跑，取自 `--pick` 给的 pick 输出，不给时这几项不写。

run：用一条命令同时跑全部复查员——每个复查员一条 `atw channel run --json`（只读、
干净环境、不留会话记录、标准速度档、显式模型、可选思考强度、30 分钟），材料完全相同；
收完结果删掉补丁目录与临时频道，失败的也删。标准输出给一个 JSON 对象，每个复查员带
channel 交出的结果对象原样（`status` 分跑完、超时、出错、没起来），另加卡在哪一步
（`stage`：没开始 / 跑到一半 / 跑完但没看完）、代码是否已发出（`codeSent`）、是否已花钱
（`spent`），以及答案末尾 `## Not read` 一节认出的没看的文件与行数（`notRead`，超过 500 行
时带按文件夹的分组建议；认不出的行进 `unmatched`，这时行数为 null）。结果里另有
起点提交 `baseCommit` 与补丁哈希 `patchHash`：重试或换人时交给 `prepare --expect-base
--expect-patch`，它在 `sameAsBefore` 里说材料与第一次是否相同。
时限固定 30 分钟；环境变量 `ATW_REVIEW_TIMEOUT`（`<N>s` 或 `<N>m`）只给测试缩短用，
比 30 分钟长或写法不对时退出 2、什么都不跑。

复查员设置整台电脑一份：`~/.atw/reviewers.yaml`（环境变量 `ATW_REVIEWERS_FILE` 可改），
带版本号，一行一个复查员（先写工具，后接可选的 model= 与 effort=）；不认识的键提醒并忽略，
非法工具名、思考强度、缺版本号或版本更新时报错。`pick` 的优先级：当场点名 > 设置 > 自动挑；
没点名也没设置时给 `mode: setup`（先走设置向导）。`pick --failed <工具>` 交代这次跑不起来的：
自动挑出的给出下一个合格的（要点头），点名或设置里的不自动换人，只给出「换成自动挑出的
某某」里的那一个。

host：这条命令是不是在宿主的围栏里跑——Codex 看 `CODEX_SANDBOX`（获批到围栏外跑的命令没有它、
却仍带 `CODEX_SANDBOX_NETWORK_DISABLED`；只剩后者时，在 macOS 上能在 `.git` 里建文件才算出了围栏，
网络只在 macOS 实测过，别的平台仍算在围栏里），
Claude Code 的命令围栏看 `SANDBOX_RUNTIME=1`——给 `sandboxed`、每个围栏一条 `sandboxes`（`by`、
`networkDisabled`、`canRequest`、`requestWith`、`source`）与合起来的 `canRequest`（有一个 `no` 就是
`no`，否则有 `unknown` 就是 `unknown`，否则 `yes`；没有围栏时 null）。能否申请按实际生效的设置：
Codex 读本次会话记录最后一轮的 `approval_policy`（含启动时的开关与 profile），`never` 为 `no`、其余为
`yes`；读不到记录而配置（顶层或当前 profile）写 `never` 时为 `unknown`（可能已被启动开关盖过，先申请
一次）。Claude Code 设置（托管 > 本地 > 项目 > 用户，托管或用户的 false 总作数）里
`sandbox.allowUnsandboxedCommands` 定为 false 时为 `no`。`source` 是定下取值的记录或文件。
申请获批后在围栏外再跑一次 `host`，`sandboxed` 为 false 才算真出来了。

report：读主 AI 写好的复查报告草稿（存好后删掉；出错退出 2 时留着并在报错里写明），把像密钥的内容整段换成标明类型的占位
（「[已打码：私钥]」之类，规则见 `SECRET_PATTERNS` 与 `_NAMED_SECRET`），标准输出给打码后的
`text`、打了几处 `redactedCount`、每处的类型与行号和所在小节 `redactions`；给了 `--task` 时把
同一份打码后的文字存成任务目录下 `cross-model-review/<日期>-<时分秒>.md`（`saved`），没给时
不写文件；`--append <已存的报告>` 把草稿（用户选去改的条目）打码后追加到那份报告末尾，行号接着它算。
聊天里显示与存档都用这份 `text`。冻结补丁排除 `.atw/tasks/`，存下的报告不会被
下次复查当成改动。

prepare-log（日志复查，prd K 节）：不冻结补丁、没有 500 行停顿。材料是任务决定日志里最近一次运行
那一段（最后一条 start 行那个对话写的行；`--whole` 时整份；`--session <编号>` 时只取那个对话写的行，不带值时是这次
对话——`resolve_context_key`，与 decision_log 自查的 `run` 同一个标识，无人值守收尾用它），加那次运行的聊天记录——按 start 行证据格
的对话编号跑一次 `atw mem extract --context <编号> --tools --after <start 行时间> --uncut --json`，取不截短的完整
条目，每条先用 report 的规则整段打码，再照 atw mem 的规则截短（参数值、换路引的话、首尾行）、渲染成它 `--tools`
文字输出的样子：命令与结果留开头
结尾各 20 行，另一份各 5 行的供「材料太长」重试，两份出自同一次读取；日志也打码，一起写进
`.atw/.runtime/cross-model-review/<编号>/`，打码处数与位置按完整版算。输出 `kind: "log-review"`、`stop`、`scope`（`last-run`、`session`、`whole`）、`session`（只在给了 `--session` 时有）、`runs`、`rows`、
`id`、`prompt`、`files`、`redactedCount`、`redactions`、`reviewers`、`chatProblems`、`notice`。没有日志给
`stop: "no-log"`；`--session` 指定的对话在日志里没有 start 行（或这次对话的编号查不到，`session` 为 null）给
`stop: "no-run"`，什么都不读、不写，不改看别的对话；有一次运行的聊天记录找不到给 `stop: "chat-not-found"`，`chatProblems` 每条写原因
（`no-session-id`、`manual-override`——编号不带 ATW 认得的平台前缀，多半来自 `ATW_CONTEXT_ID` 手动覆盖、
`unreadable-id`——ATW 认得的平台但 atw mem 读不了、
`not-found`、`ambiguous`、`mem-failed`），什么都不写、不拿别的对话充数。
日志复查的 `run` 按失败原因自动重试（先按工具报的出错种类 `errorKind` 归类，见 `ERROR_KIND_REASONS`，
Claude `rate_limit` 带 `QUOTA_SUBKINDS` 里的 `errorSubkind` 算额度用完；
没有种类或种类不在表里时按报错文字，见 `FAILURE_PATTERNS`）：`transient` 原样重试、
`too-long` 改用各 5 行的材料、`unknown` 重试一次，每个复查员最多两次；`tool-error`、`not-installed`、
`not-logged-in`、`quota-exhausted`、`model-unavailable`、`timeout`（半截照用）不重试。一个复查员的全部尝试
合计不超过 30 分钟：重试只用剩下的时间，剩下不到十分之一就不再试（`retryStoppedBy: "time-limit"`）。每个
复查员另带 `failureReason`、`retries`、每次尝试的 `attempts` 与各次合计的 `total`（`durationMs`、`costUsd`、
`costUnreported`——有一次没报花费即为真），`codeSent`、`spent` 合计各次。
日志复查的 `notRead` 不拿补丁文件去对：只有 `text` 与 `parts`（`## Not read` 各条原样，写 `None`/「无」时为空），
没写这一节或标题下面空着为 null。
`pick --settings-only`：无人值守时只用设置里的复查员，不自动挑、不换人、不弹向导；用不成时退出 0、
`unavailable` 给 `{reason, detail}`（`no-settings`、`settings-broken`、`current-ai-unknown`、
`sandbox-needs-approval`——照 `host` 判断命令在宿主围栏里、出去要用户点头、`none-qualified`）；
`logReviewCommand` 给当前宿主里日志复查的输入 `{zh, en}`（与 `afk-notice` 同一套写法），认不出宿主时为 null。
`report --log-review --task <任务目录>`：日志复查的报告存进任务目录的 `log-review/`，不进 `cross-model-review/`。
`afk-notice`（prd F 节）：两个连做命令 `--afk` 开跑时用。照 `pick --settings-only` 挑人、原样给出它的输出，另带
`notice`（`zh`、`en` 各一段）：分支（新开还是原有）、收尾请谁做日志复查（家、按名字认出、认不出照跑、设置里谁不跑）
或为什么跳过与现在怎么补、事后怎么补、会发出去什么、宿主会不会逐条要授权（Claude Code 设置的 `permissions.defaultMode`、
Codex 会话记录或配置的 `approval_policy`，查不到就说查不到）、五条红线、「等你处理」清单位置、随时可打断；
命令只给当前宿主的写法，认不出宿主时三种都给。AI 原样贴出，不改写、不压缩。

交给钩子显示（工单 26）：`afk-notice`、`prepare`、`prepare-log` 解析参数之前先删 `.atw/.runtime/hook-notice.json`
（`.atw/` 所在目录按 `common.paths.get_repo_root` 找，不是 git 顶层），输出带 `notice` 时把 `--lang` 那一种语言
（不给时中、英两段，中文在前、空一行）连同命令名与这次对话的 ATW 会话编号（`resolve_context_key`，拿不到为 null）
写进去；参数不对、停下、出错退出 2 都不留。Claude Code 的 PostToolUse 钩子 `show-notice.py` 在同名命令跑完后、
同一个对话里（任一边没有编号时不比）把它作为 `systemMessage` 原样显示给用户（不经模型）、删掉文件，并用
`additionalContext` 告诉 AI 已显示过；超过 8000 字（Claude Code 上限 10000）不显示，改让 AI 自己原样贴出。
三个命令名另写在钩子的 `COMMAND_RE` 里，改一处要改另一处。别的宿主没有这个钩子，照旧由 AI 原样贴出。

退出码：0 成功（复查员各自成败看 JSON）；2 没跑起来（参数不对、起点认不出、
编号不存在、找不到 atw 命令），错误写到标准错误。
"""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import io
import json
import os
import posixpath
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from collections.abc import Callable
from pathlib import Path

from common import configure_encoding
from common.active_task import KNOWN_PLATFORMS, resolve_context_key
from common.atw_config import parse_simple_yaml
from common.paths import get_repo_root
from decision_log import LANGS as LOG_LANGS
from decision_log import START_PHASE, LogError, Row, format_row, owners, read_log

EXIT_OK = 0
EXIT_ERROR = 2

TOOLS = ("claude", "codex", "pi", "omp")
REVIEW_TIMEOUT_S = 30 * 60
RUNTIME_SUBDIR = Path(".atw/.runtime/cross-model-review")
EXCLUDED_PREFIXES = (".atw/tasks/", ".atw/workspace/", ".atw/.runtime/")
# 开跑前那段交代交给 Claude Code 的 PostToolUse 钩子 show-notice.py 原样显示（工单 26）
HOOK_NOTICE = Path(".atw/.runtime/hook-notice.json")
# 与 show-notice.py 的 COMMAND_RE 是同一组命令名：改一处要改另一处
NOTICE_COMMANDS = ("afk-notice", "prepare", "prepare-log")
# 单个文件的改动超过这么多字节就只记路径，免得一个产物文件塞满复查员的上下文
LARGE_FILE_BYTES = 256 * 1024
SECRET_SUFFIXES = (".pem", ".key", ".p12", ".pfx")
SECRET_PREFIXES = (".env", "id_rsa", "id_ed25519")
# 补丁超过这么多行（加与删合计）先停下，由用户选整段看还是分开看
LINE_LIMIT = 500


class ReviewError(Exception):
    """没跑起来：参数、仓库状态或环境不对。"""


# ---------------------------------------------------------------------------
# git
# ---------------------------------------------------------------------------


def _git(
    root: Path,
    args: list[str],
    ok_codes: tuple[int, ...] = (0,),
    env: dict[str, str] | None = None,
    stdin: str | None = None,
) -> str:
    proc = subprocess.run(
        ["git", "-c", "core.quotepath=off", *args],
        cwd=root,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=env,
        input=stdin,
    )
    if proc.returncode not in ok_codes:
        raise ReviewError(f"git {' '.join(args)} 失败：{proc.stderr.strip()}")
    return proc.stdout


DIFF_FLAGS = ["--no-color", "--no-ext-diff", "--no-renames", "--src-prefix=a/", "--dst-prefix=b/"]


def repo_root() -> Path:
    out = _git(Path.cwd(), ["rev-parse", "--show-toplevel"])
    return Path(out.strip())


def _excluded(path: str) -> bool:
    return any(path.startswith(p) for p in EXCLUDED_PREFIXES)


def is_secret_like(path: str) -> bool:
    name = posixpath.basename(path).lower()
    return (
        name.startswith(SECRET_PREFIXES)
        or name.endswith(SECRET_SUFFIXES)
        or "credentials" in name
    )


def _current_branch(root: Path) -> str | None:
    return _git(root, ["branch", "--show-current"]).strip() or None


def _task_base_branch(task: Path | None) -> str | None:
    if task is None or not (task / "task.json").is_file():
        return None
    try:
        data = json.loads((task / "task.json").read_text(encoding="utf-8"))
    except ValueError as e:
        raise ReviewError(f"读不了 {task / 'task.json'}：{e}") from e
    base = data.get("base_branch") if isinstance(data, dict) else None
    return base if isinstance(base, str) and base.strip() else None


def _default_branch(root: Path) -> str:
    """仓库默认主线：本地记下的 origin/HEAD 指向的；没有时取 init.defaultBranch、main、master 里先有的。

    只看本地引用，不连远端（`git remote show origin` 会走网络）。
    """
    head = _git(root, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], ok_codes=(0, 1)).strip()
    name = head.split("/", 1)[1] if head.startswith("origin/") else None
    if name is None:
        configured = _git(root, ["config", "--get", "init.defaultBranch"], ok_codes=(0, 1)).strip()
        name = next((n for n in (configured, "main", "master") if n and _ref_exists(root, n)), None)
    if name is None:
        raise ReviewError("认不出仓库的默认主线，用 --since 指定起点")
    return name


def resolve_start(root: Path, since: str | None, task: Path | None) -> dict:
    """起点：用户给的，否则任务的 base_branch，否则仓库默认主线；就在主线上时从 HEAD 起。"""
    if since is not None:
        if not _ref_exists(root, since):
            raise ReviewError(f"认不出起点 {since}（不是提交、分支或标签）")
        commit = _git(root, ["merge-base", since, "HEAD"]).strip()
        return {"base": since, "baseFrom": "since", "onBase": False, "baseCommit": commit}
    name = _task_base_branch(task)
    base_from = "task"
    if name is None:
        name, base_from = _default_branch(root), "default"
    ref = next((r for r in (name, f"origin/{name}") if _ref_exists(root, r)), None)
    if ref is None:
        raise ReviewError(f"认不出主线 {name}（本地与 origin 上都没有这个分支）")
    # `origin/main` 这类远端跟踪名，与本地同名分支算同一条主线
    local = name.split("/", 1)[1] if "/" in name and _ref_exists(root, f"refs/remotes/{name}") else name
    on_base = _current_branch(root) in (name, local)
    commit = _git(root, ["rev-parse", "HEAD"] if on_base else ["merge-base", ref, "HEAD"]).strip()
    return {"base": name, "baseFrom": base_from, "onBase": on_base, "baseCommit": commit}


def _in_member(path: str, member: str) -> int | None:
    """path 落在分组成员（文件夹或文件）里时返回匹配长度；`.` 只管顶层的文件。"""
    m = member.strip().strip("/")
    if m in ("", "."):
        return 0 if "/" not in path else None
    if path == m or path.startswith(m + "/"):
        return len(m)
    return None


def assign_groups(paths: list[str], groups: list[list[str]]) -> list[int | None]:
    """每个文件归到成员最长匹配的那组；哪组都不在时为 None。"""
    out: list[int | None] = []
    for path in paths:
        best, best_len = None, -1
        for i, members in enumerate(groups):
            for m in members:
                n = _in_member(path, m)
                if n is not None and n > best_len:
                    best, best_len = i, n
        out.append(best)
    return out


def suggest_groups(lines_by_folder: dict[str, int], path_only: list[dict]) -> list[list[str]]:
    """按文件夹顺序装组，每组不超过 LINE_LIMIT 行；一个文件夹自己就超过的单独成组。"""
    folders = set(lines_by_folder) | {posixpath.dirname(x["path"]) or "." for x in path_only}
    groups: list[list[str]] = []
    current: list[str] = []
    n = 0
    for folder in sorted(folders):
        c = lines_by_folder.get(folder, 0)
        if current and n + c > LINE_LIMIT:
            groups.append(current)
            current, n = [], 0
        current.append(folder)
        n += c
    if current:
        groups.append(current)
    return groups


def summarize(pieces: dict[str, str], lines: dict[str, int], path_only: list[dict]) -> dict:
    files = sorted(pieces)
    by_folder: dict[str, int] = {}
    for path in files:
        folder = posixpath.dirname(path) or "."
        by_folder[folder] = by_folder.get(folder, 0) + lines[path]
    patch_text = "".join(pieces[p] for p in files)
    return {
        "patchText": patch_text,
        "patchHash": hashlib.sha256(patch_text.encode("utf-8")).hexdigest(),
        "files": files,
        "totalLines": sum(lines[p] for p in files),
        "linesByFolder": by_folder,
        "linesByFile": {p: lines[p] for p in files},
        "pathOnly": sorted(path_only, key=lambda x: x["path"]),
    }


def _untracked(root: Path, pathspec: list[str], env: dict[str, str] | None = None) -> tuple[list[str], list[str]]:
    """未跟踪（未忽略）的文件，去掉排除的部分，分成（收的，名字像密钥、只列出的）。快照与冻结共用。"""
    out = _git(root, ["ls-files", "--others", "--exclude-standard", "-z", "--", *pathspec], env=env)
    kept: list[str] = []
    secret_like: list[str] = []
    for path in out.split("\0"):
        if path and not _excluded(path):
            (secret_like if is_secret_like(path) else kept).append(path)
    return kept, secret_like


def freeze(root: Path, base_commit: str, snapshot: str, paths: list[str]) -> dict:
    """冻结起点到这次快照之间（限于 paths）的补丁；返回各文件的补丁与统计，不写任何文件。

    未跟踪的文件已在快照里；名字像密钥的没进快照，这里只列出。
    """
    pathspec = (paths or ["."]) + [f":(exclude){p}" for p in EXCLUDED_PREFIXES]
    pieces: dict[str, str] = {}
    lines: dict[str, int] = {}
    path_only: list[dict] = []

    numstat = _git(
        root,
        ["diff", "--no-renames", "-z", "--numstat", base_commit, snapshot, "--", *pathspec],
    )
    for record in numstat.split("\0"):
        if not record:
            continue
        added, deleted, path = record.split("\t", 2)
        if added == "-" and deleted == "-":
            path_only.append({"path": path, "reason": "binary"})
            continue
        text = _git(root, ["diff", *DIFF_FLAGS, base_commit, snapshot, "--", path])
        if len(text.encode("utf-8")) > LARGE_FILE_BYTES:
            path_only.append({"path": path, "reason": "large"})
            continue
        pieces[path] = text
        lines[path] = int(added) + int(deleted)

    skipped = _untracked(root, pathspec)[1]
    return {"pieces": pieces, "lines": lines, "pathOnly": path_only, "skippedSecretLike": sorted(skipped)}


SNAPSHOT_REF_PREFIX = "refs/atw/cross-model-review/"
# 快照提交的作者固定写 ATW，不依赖用户有没有配 user.name
_SNAPSHOT_IDENT = {
    "GIT_AUTHOR_NAME": "ATW cross-model review",
    "GIT_AUTHOR_EMAIL": "atw@localhost",
    "GIT_COMMITTER_NAME": "ATW cross-model review",
    "GIT_COMMITTER_EMAIL": "atw@localhost",
}


SNAPSHOT_PATHS_TRAILER = "ATW-Paths: "


def snapshot_commit(root: Path, paths: list[str]) -> str:
    """把工作区此刻的状态（与冻结同样的排除规则）写成一个提交，不挂引用。

    在暂存区的副本上做，用户的暂存区、工作区与分支都不动；没跟踪的里名字像密钥的不收。
    """
    real_index = Path(_git(root, ["rev-parse", "--path-format=absolute", "--git-path", "index"]).strip())
    fd, tmp = tempfile.mkstemp(prefix="atw-xmr-index-")
    os.close(fd)
    try:
        if real_index.is_file():
            # 连修改时间一起复制：git 靠暂存区文件的时间认出同一秒里改过、大小没变的文件
            shutil.copy2(real_index, tmp)
        else:
            os.unlink(tmp)
        env = {**os.environ, "GIT_INDEX_FILE": tmp, **_SNAPSHOT_IDENT}
        excludes = [f":(exclude){p}" for p in EXCLUDED_PREFIXES]
        wanted = _untracked(root, ["."], env=env)[0]
        _git(root, ["add", "--update", "--", ".", *excludes], env=env)
        if wanted:
            _git(
                root,
                ["add", "--pathspec-from-file=-", "--pathspec-file-nul", "--"],
                env=env,
                stdin="\0".join(wanted),
            )
        tree = _git(root, ["write-tree"], env=env).strip()
        parent = ["-p", "HEAD"] if _ref_exists(root, "HEAD") else []
        # 这次只看了哪些文件夹或文件，记在提交说明里，复核照用
        message = f"ATW cross-model review snapshot\n\n{SNAPSHOT_PATHS_TRAILER}{json.dumps(paths, ensure_ascii=False)}\n"
        return _git(root, ["commit-tree", tree, *parent, "-m", message], env=env).strip()
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(tmp)


def snapshot_paths(root: Path, commit: str) -> list[str]:
    """快照记下的范围（`--path`）；没记的（不是本脚本存的提交）当作整个仓库。"""
    for line in _git(root, ["log", "-1", "--format=%B", commit]).splitlines():
        if line.startswith(SNAPSHOT_PATHS_TRAILER):
            with contextlib.suppress(ValueError):
                recorded = json.loads(line[len(SNAPSHOT_PATHS_TRAILER):])
                if isinstance(recorded, list) and all(isinstance(x, str) for x in recorded):
                    return recorded
    return []


def keep_snapshot(root: Path, commit: str) -> None:
    """挂到 ATW 内部引用名下，免得被 git 当垃圾清掉；不在 refs/heads 下，不算分支。"""
    _git(root, ["update-ref", SNAPSHOT_REF_PREFIX + commit, commit])


def _ref_exists(root: Path, ref: str) -> bool:
    proc = subprocess.run(
        ["git", "rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}"],
        cwd=root,
        capture_output=True,
        text=True,
    )
    return proc.returncode == 0


# ---------------------------------------------------------------------------
# 复查员
# ---------------------------------------------------------------------------


def parse_reviewer(spec: str) -> dict:
    """`<工具> model=<模型> [effort=<强度>]` → {tool, model, effort}。"""
    parts = spec.split()
    if not parts or parts[0] not in TOOLS:
        raise ReviewError(f"复查员「{spec}」要以工具名开头：{' / '.join(TOOLS)}")
    fields: dict[str, str] = {}
    for part in parts[1:]:
        key, sep, value = part.partition("=")
        if not sep or not value or key not in ("model", "effort"):
            raise ReviewError(f"复查员「{spec}」里的「{part}」不认识，只认 model= 与 effort=")
        fields[key] = value
    if "model" not in fields:
        raise ReviewError(f"复查员「{spec}」没写 model=：模型总是显式交给工具")
    return {"tool": parts[0], "model": fields["model"], "effort": fields.get("effort")}


# ---------------------------------------------------------------------------
# 复查员设置（prd F；决策记录 0001：整台电脑一份）
# ---------------------------------------------------------------------------

SETTINGS_VERSION = 1
# 各工具自己的思考强度档，与 atw channel 各对接的校验一致
EFFORT_LEVELS: dict[str, tuple[str, ...]] = {
    "claude": ("low", "medium", "high", "xhigh", "max", "ultracode"),
    "codex": ("none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra", "persistent"),
    "pi": ("off", "minimal", "low", "medium", "high", "xhigh", "max"),
    "omp": ("off", "minimal", "low", "medium", "high", "xhigh", "max"),
}


def settings_path() -> Path:
    env = os.environ.get("ATW_REVIEWERS_FILE")
    return Path(env) if env else Path.home() / ".atw" / "reviewers.yaml"


def _check_effort(spec: str, tool: str, effort: str | None) -> None:
    if effort is not None and effort not in EFFORT_LEVELS[tool]:
        raise ReviewError(
            f"复查员「{spec}」的思考强度 {effort} {tool} 没有，只认：{' / '.join(EFFORT_LEVELS[tool])}"
        )


def parse_settings_line(spec: str, warnings: list[str]) -> dict:
    """设置里的一行：先写工具，后接可选的 model= 与 effort=；不认识的写法提醒并忽略（向后兼容）。"""
    parts = spec.split()
    if not parts or parts[0] not in TOOLS:
        raise ReviewError(f"复查员「{spec}」要以工具名开头：{' / '.join(TOOLS)}")
    fields: dict[str, str] = {}
    for part in parts[1:]:
        key, sep, value = part.partition("=")
        if sep and value and key in ("model", "effort"):
            fields[key] = value
        else:
            warnings.append(f"复查员「{spec}」里的「{part}」不认识，已忽略")
    _check_effort(spec, parts[0], fields.get("effort"))
    return {"tool": parts[0], "model": fields.get("model"), "effort": fields.get("effort")}


def _parse_settings_yaml(text: str, path: Path, warnings: list[str]) -> dict:
    """简易 YAML 解析器把读不了的写法印到标准错误；收进 warnings，好让用户听到。"""
    captured = io.StringIO()
    with contextlib.redirect_stderr(captured):
        data = parse_simple_yaml(text, source=str(path))
    warnings.extend(line for line in captured.getvalue().splitlines() if line.strip())
    return data


def _check_version(version: object) -> str:
    if not isinstance(version, str) or not version.isdigit():
        raise ReviewError("没写版本号（第一行应是 version: 1）")
    if int(version) > SETTINGS_VERSION:
        raise ReviewError(f"版本 {version} 比这个 ATW 认得的 {SETTINGS_VERSION} 新：请升级 ATW")
    return version


def read_settings() -> dict:
    """读设置文件；没有文件时 exists 为 False、reviewers 为空。写法不对时报错并写明文件。"""
    path = settings_path()
    out: dict = {"file": str(path), "exists": False, "version": None, "reviewers": [], "warnings": []}
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return out
    except OSError as e:
        raise ReviewError(f"读不了复查员设置 {path}：{e}") from e
    out["exists"] = True
    data = _parse_settings_yaml(text, path, out["warnings"])
    try:
        out["version"] = _check_version(data.get("version"))
        for key in data:
            if key not in ("version", "reviewers"):
                out["warnings"].append(f"不认识的键「{key}」，已忽略")
        lines = data.get("reviewers", [])
        if lines == {}:
            lines = []  # `reviewers:` 下面一条都没写
        if not isinstance(lines, list):
            raise ReviewError("reviewers 要写成一行一个复查员的列表")
        out["reviewers"] = [parse_settings_line(line, out["warnings"]) for line in lines]
    except ReviewError as e:
        raise ReviewError(f"复查员设置 {path} 不对：{e}") from e
    return out


# ---------------------------------------------------------------------------
# 认家（prd G）
# ---------------------------------------------------------------------------

# 家 → (名字任何位置的整词, 只认整名或开头的短词)
FAMILY_WORDS: dict[str, tuple[tuple[str, ...], tuple[str, ...]]] = {
    "Anthropic": (("claude", "anthropic"), ()),
    "OpenAI": (("gpt", "chatgpt", "codex", "openai"), ("o1", "o3", "o4")),
    "Google": (("gemini", "gemma"), ()),
    "xAI": (("grok",), ()),
    "Meta": (("llama",), ()),
    "Mistral": (
        ("mistral", "mixtral", "codestral", "devstral", "magistral", "ministral", "pixtral"),
        (),
    ),
    "DeepSeek": (("deepseek",), ()),
    "Alibaba": (("qwen", "qwq"), ()),
    "Moonshot": (("kimi", "moonshot"), ()),
    "Zhipu": (("glm", "chatglm"), ()),
    "MiniMax": (("minimax",), ()),
    "Cohere": (("cohere", "aya"), ("command",)),
    "Microsoft": ((), ("phi",)),
    "ByteDance": (("doubao",), ()),
    "Tencent": (("hunyuan",), ()),
    "Baidu": (("ernie",), ()),
    "Cursor": ((), ("composer",)),
}
# Claude Code 的模型简称：只在工具是 Claude Code 时算 Anthropic，只认整名或开头
CLAUDE_CODE_ALIASES = ("opus", "sonnet", "haiku", "opusplan", "default", "best", "fable")


def _starts_with_word(name: str, word: str) -> bool:
    if not name.startswith(word):
        return False
    rest = name[len(word):]
    if not rest:
        return True
    nxt = rest[0]
    # 词以字母结尾时数字也算分隔（phi4）；以数字结尾时只认非字母数字（o3-mini，不认 o35）
    return not nxt.isalpha() and not (word[-1].isdigit() and nxt.isdigit())


def families_of(model: str, tool: str | None = None) -> list[str]:
    """按模型自己的名字认家；转发服务名（最后一个 `/` 之前）不算；认不出给空列表。"""
    name = model.strip().lower().rsplit("/", 1)[-1]
    # 整词：两侧是名字开头结尾或非字母字符，数字也算分隔
    words = set(re.findall(r"[a-z]+", name))
    found: list[str] = []
    for family, (anywhere, leading) in FAMILY_WORDS.items():
        if words.intersection(anywhere) or any(_starts_with_word(name, w) for w in leading):
            found.append(family)
    if tool == "claude" and "Anthropic" not in found:
        if any(_starts_with_word(name, w) for w in CLAUDE_CODE_ALIASES):
            found.append("Anthropic")
    return found


# ---------------------------------------------------------------------------
# 查工具（prd F；只用调研 02 里不调模型、不吐密钥的办法）
# ---------------------------------------------------------------------------

AUTO_PICK_ORDER = ("codex", "claude", "pi", "omp")
# 每条查询命令最多等这么久；环境变量可改（测试与很慢的机器用）
PROBE_TIMEOUT_S = float(os.environ.get("ATW_REVIEW_PROBE_TIMEOUT_S") or 60)
# omp 配置里 `<模型>:<思考强度>` 的后缀；auto 会另调评判模型，channel 不收，按不写处理
OMP_THINKING_SUFFIXES = ("off", "minimal", "low", "medium", "high", "xhigh", "max", "auto")


class ProbeFailed(Exception):
    """查询命令本身出了问题（起不来、超时、输出不是约定的样子）：不等于没登录。"""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def _probe_cmd(args: list[str]) -> tuple[int, str]:
    """跑一条查询命令，返回退出码与标准输出；标准错误一律丢掉（Codex 会在那里印半截密钥）。"""
    try:
        proc = subprocess.run(
            args,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=PROBE_TIMEOUT_S,
        )
    except subprocess.TimeoutExpired as e:
        raise ProbeFailed("probe-timed-out") from e
    except OSError as e:
        raise ProbeFailed("probe-failed") from e
    return proc.returncode, proc.stdout


def _probe_json(args: list[str], ok_codes: tuple[int, ...] = (0,)) -> tuple[int, dict]:
    code, out = _probe_cmd(args)
    try:
        parsed = json.loads(out)
    except ValueError as e:
        raise ProbeFailed("probe-failed") from e
    if code not in ok_codes or not isinstance(parsed, dict):
        raise ProbeFailed("probe-failed")
    return code, parsed


def _logged_in_by_exit(code: int) -> bool:
    """codex login status 与 pi auth check：0 已登录，1 没登录，其余是命令出错。"""
    if code not in (0, 1):
        raise ProbeFailed("probe-failed")
    return code == 0


def _read_json(path: Path) -> object:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _settings_model(path: Path) -> str | None:
    settings = _read_json(path)
    model = settings.get("model") if isinstance(settings, dict) else None
    return model if isinstance(model, str) and model else None


def _claude_default_model() -> str:
    """调研 02 §2.1 的优先级：ANTHROPIC_MODEL > 设置文件（本地 > 项目 > 用户）> ANTHROPIC_DEFAULT_MODEL。"""
    env = os.environ.get("ANTHROPIC_MODEL")
    if env:
        return env
    user_dir = Path(os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude")
    # 复查从仓库根目录跑，项目设置就在当前目录
    for f in (Path.cwd() / ".claude/settings.local.json", Path.cwd() / ".claude/settings.json", user_dir / "settings.json"):
        model = _settings_model(f)
        if model:
            return model
    env = os.environ.get("ANTHROPIC_DEFAULT_MODEL")
    if env:
        return env
    # 都没设：以 Claude Code 的 default 简称为准，具体型号跑完再记（prd F 例外）
    return "default"


def _codex_home() -> Path:
    return Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex")


def _codex_default_model() -> str | None:
    try:
        text = (_codex_home() / "config.toml").read_text(encoding="utf-8")
    except OSError:
        return None
    for line in text.splitlines():
        if line.lstrip().startswith("["):
            break  # 只看顶层键，profile 里的 model 不是默认
        m = re.match(r"""\s*model\s*=\s*["']([^"']+)["']""", line)
        if m:
            return m.group(1)
    return None


def _claude_logged_in() -> bool:
    _, status = _probe_json(["claude", "auth", "status", "--json"], ok_codes=(0, 1))
    # 只读 loggedIn；JSON 里的邮箱与组织名不读、不输出
    if not isinstance(status.get("loggedIn"), bool):
        raise ProbeFailed("probe-failed")
    return status["loggedIn"]


def _probe_claude(r: dict) -> None:
    r["defaultModel"] = _claude_default_model()
    r["recordActualModel"] = r["defaultModel"] == "default"
    r["loggedIn"] = _claude_logged_in()
    # Claude Code 没有不调模型就能列出可用模型的办法：简称与完整名都照它的配置收下
    if r["loggedIn"]:
        r["available"] = True


def _probe_codex(r: dict) -> None:
    r["defaultModel"] = _codex_default_model()
    code, _ = _probe_cmd(["codex", "login", "status"])
    r["loggedIn"] = _logged_in_by_exit(code)
    if not r["loggedIn"] or r["defaultModel"] is None:
        return
    r["available"] = r["defaultModel"] in _codex_models()


def _codex_models() -> set:
    cache = _read_json(_codex_home() / "models_cache.json")
    models = cache.get("models") if isinstance(cache, dict) else None
    return {m.get("slug") for m in models if isinstance(m, dict)} if isinstance(models, list) else set()


def _pi_logged_in(provider: str) -> bool:
    # --no-refresh：不刷新过期的登录（会写凭据文件）；绝不加 --credentials
    code, _ = _probe_cmd(["pi", "auth", "check", "--provider", provider, "--json", "--no-refresh"])
    return _logged_in_by_exit(code)


def _pi_models() -> set:
    """`pi --list-models` 的表格 → {"<渠道>/<模型>"}。"""
    code, table = _probe_cmd(["pi", "--offline", "--no-extensions", "--list-models"])
    if code != 0:
        raise ProbeFailed("probe-failed")
    rows = [line.split() for line in table.splitlines()[1:]]
    return {f"{row[0]}/{row[1]}" for row in rows if len(row) >= 2}


def _probe_pi(r: dict) -> None:
    settings = _read_json(Path.home() / ".pi/agent/settings.json")
    provider = settings.get("defaultProvider") if isinstance(settings, dict) else None
    model = settings.get("defaultModel") if isinstance(settings, dict) else None
    if not isinstance(provider, str) or not isinstance(model, str) or not provider or not model:
        return
    r["defaultModel"] = f"{provider}/{model}"
    r["loggedIn"] = _pi_logged_in(provider)
    if not r["loggedIn"]:
        return
    r["available"] = r["defaultModel"] in _pi_models()


def _omp_default_model() -> str | None:
    try:
        text = (Path.home() / ".omp/agent/config.yml").read_text(encoding="utf-8")
    except OSError:
        return None
    in_roles = False
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if not line[0].isspace():
            in_roles = line.split("#", 1)[0].strip() == "modelRoles:"
            continue
        m = re.match(r"""\s+default\s*:\s*["']?([^"'#\s]+)""", line)
        if in_roles and m:
            return m.group(1)
    return None


def _omp_quota_reached(provider: str) -> bool:
    """`omp usage --redact --json`：这个渠道的订阅账号全都到了上限才算用完。

    只覆盖有额度接口的订阅账号，填 API key 的渠道查不到；这条命令本身出错时只是查不到额度，
    不拦这个复查员（Claude Code、pi 本来就查不到额度）。邮箱与账号 id 不读、不输出。
    """
    try:
        _, usage = _probe_json(["omp", "usage", "--redact", "--json", "--no-extensions"])
    except ProbeFailed:
        return False
    reports = usage.get("reports")
    mine = [x for x in reports if isinstance(x, dict) and x.get("provider") == provider] if isinstance(reports, list) else []
    return bool(mine) and all((x.get("metadata") or {}).get("limitReached") is True for x in mine)


def _probe_omp(r: dict) -> None:
    configured = _omp_default_model()
    if configured is None:
        return
    model, _, suffix = configured.rpartition(":")
    if model and suffix in OMP_THINKING_SUFFIXES:
        r["defaultEffort"] = None if suffix == "auto" else suffix
    else:
        model = configured
    r["defaultModel"] = model
    selectors = _omp_models()
    provider = model.split("/", 1)[0]
    r["loggedIn"] = _omp_provider_listed(selectors, provider)
    if not r["loggedIn"]:
        return
    r["available"] = model in selectors
    if r["available"] and _omp_quota_reached(provider):
        r["reason"] = "quota-exhausted"


def _omp_models() -> set:
    # 不用 omp auth / omp token（会吐密钥）；models --json 只列有凭据的渠道的模型
    _, listed = _probe_json(["omp", "models", "--json", "--no-extensions"])
    models = listed.get("models")
    return {m.get("selector") for m in models if isinstance(m, dict)} if isinstance(models, list) else set()


def _omp_provider_listed(selectors: set, provider: str) -> bool:
    return any(isinstance(s, str) and s.split("/", 1)[0] == provider for s in selectors)


PROBES = {"claude": _probe_claude, "codex": _probe_codex, "pi": _probe_pi, "omp": _probe_omp}


def probe_tool(tool: str) -> dict:
    """查一个工具：装没装、登没登录、配置的默认模型与思考强度、在不在可用列表里、是哪家。"""
    r: dict = {
        "tool": tool,
        "installed": shutil.which(tool) is not None,
        "loggedIn": None,
        "defaultModel": None,
        "defaultEffort": None,
        "available": None,
        "families": [],
        "recordActualModel": False,
        "reason": None,
    }
    if not r["installed"]:
        r["reason"] = "not-installed"
        return r
    try:
        PROBES[tool](r)
    except ProbeFailed as e:
        r["reason"] = e.reason
    if r["defaultModel"] is not None:
        r["families"] = families_of(r["defaultModel"], tool)
    if r["reason"] is not None:
        return r
    if r["defaultModel"] is None:
        r["reason"] = "no-default-model"
    elif not r["loggedIn"]:
        r["reason"] = "not-logged-in"
    elif not r["available"]:
        r["reason"] = "default-model-unavailable"
    return r


def _model_reason(tool: str, model: str) -> str | None:
    """点名的模型能不能用：登录了、在该工具的可用列表里；能用给 None。Claude Code 没有列表，登录了就收下。"""
    if tool == "claude":
        return None if _claude_logged_in() else "not-logged-in"
    if tool == "codex":
        code, _ = _probe_cmd(["codex", "login", "status"])
        if not _logged_in_by_exit(code):
            return "not-logged-in"
        return None if model in _codex_models() else "model-unavailable"
    provider, slash, _ = model.partition("/")
    if not slash:
        return "model-unavailable"  # pi、omp 的模型要写成 <渠道>/<模型>
    if tool == "pi":
        if not _pi_logged_in(provider):
            return "not-logged-in"
        return None if model in _pi_models() else "model-unavailable"
    selectors = _omp_models()
    if not _omp_provider_listed(selectors, provider):
        return "not-logged-in"
    if model not in selectors:
        return "model-unavailable"
    return "quota-exhausted" if _omp_quota_reached(provider) else None


def verify_reviewer(w: dict) -> dict:
    """写入或这次用之前再验证一遍：工具装了、登录了、模型（不写时是配置的默认模型）能用。"""
    out = {
        "tool": w["tool"],
        "model": w["model"],
        "effort": w["effort"],
        "checkedModel": w["model"],
        "listChecked": w["tool"] != "claude",
        "usable": False,
        "reason": None,
    }
    if w["model"] is None:
        p = probe_tool(w["tool"])
        out["checkedModel"], out["reason"] = p["defaultModel"], p["reason"]
    elif shutil.which(w["tool"]) is None:
        out["reason"] = "not-installed"
    else:
        try:
            out["reason"] = _model_reason(w["tool"], w["model"])
        except ProbeFailed as e:
            out["reason"] = e.reason
    out["usable"] = out["reason"] is None
    return out


def _settings_line(w: dict) -> str:
    return " ".join(
        [w["tool"]] + [f"{k}={w[k]}" for k in ("model", "effort") if w[k] is not None]
    )


def _kept_from_existing(path: Path) -> tuple[list[str], dict[tuple, list[str]]]:
    """重写前读旧文件：更新的 ATW 写的不降级；它加的顶层键原样留下，复查员行里不认识的字段按（工具, 模型）留下。"""
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return [], {}
    except OSError as e:
        raise ReviewError(f"读不了复查员设置 {path}：{e}") from e
    data = _parse_settings_yaml(text, path, [])
    version = data.get("version")
    # 只拦更新的版本；旧文件写坏了（缺版本号等）正好由这次重写修好
    if isinstance(version, str) and version.isdigit() and int(version) > SETTINGS_VERSION:
        raise ReviewError(f"复查员设置 {path} 不对：版本 {version} 比这个 ATW 认得的 {SETTINGS_VERSION} 新：请升级 ATW")
    blocks: list[str] = []
    keep = False
    for line in text.splitlines():
        if line and not line[0].isspace() and not line.startswith("#"):
            keep = line.partition(":")[0].strip() not in ("version", "reviewers")
        if keep and line.strip():
            blocks.append(line)
    extras: dict[tuple, list[str]] = {}
    lines = data.get("reviewers")
    for spec in lines if isinstance(lines, list) else []:
        parts = spec.split()
        if not parts:
            continue
        model = None
        unknown: list[str] = []
        for part in parts[1:]:
            key, sep, value = part.partition("=")
            if sep and value and key in ("model", "effort"):
                model = value if key == "model" else model
            else:
                unknown.append(part)
        extras.setdefault((parts[0], model), unknown)
    return blocks, extras


def cmd_save(args: argparse.Namespace) -> dict:
    wanted = [_parse_wanted(s) for s in args.reviewer]
    path = settings_path()
    blocks, extras = _kept_from_existing(path)
    checked = [verify_reviewer(w) for w in wanted]
    saved = all(c["usable"] for c in checked)
    if saved:
        body = f"version: {SETTINGS_VERSION}\nreviewers:\n" + "".join(
            "  - " + " ".join([_settings_line(w), *extras.get((w["tool"], w["model"]), [])]) + "\n"
            for w in wanted
        ) + "".join(f"{line}\n" for line in blocks)
        tmp = path.with_name(path.name + ".tmp")
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp.write_text(body, encoding="utf-8")
            os.replace(tmp, path)
        except OSError as e:
            with contextlib.suppress(OSError):
                tmp.unlink(missing_ok=True)
            raise ReviewError(f"写不了复查员设置 {path}：{e}") from e
    return {"saved": saved, "file": str(path), "reviewers": checked}


# ---------------------------------------------------------------------------
# 宿主与当前 AI（prd G）、挑人（prd H）
# ---------------------------------------------------------------------------

NEEDS_USER_CURRENT_AI = "current-ai-unknown"


def host_candidates() -> list[str]:
    """环境变量里各宿主的标记；一个宿主里再开另一个时，外层的标记会被继承下来。"""
    env = os.environ
    agent = env.get("AI_AGENT", "")
    found: list[str] = []
    if env.get("OMPCODE"):
        found.append("omp")
    if agent == "pi" or env.get("PI_CODING_AGENT"):
        found.append("pi")
    if env.get("CODEX_THREAD_ID"):
        found.append("codex")
    # omp 也给子进程设 CLAUDECODE=1：有 OMPCODE 时只凭 AI_AGENT 认 Claude Code
    if agent.startswith("claude-code") or (env.get("CLAUDECODE") and "omp" not in found):
        found.append("claude")
    # pi 与 Claude Code 都会改写 AI_AGENT，它指向的是里层那个
    if "pi" in found and "claude" in found:
        found.remove("claude" if agent == "pi" else "pi")
    return found


def detect_host() -> tuple[str | None, list[str]]:
    """认得出唯一的宿主时给它；标记互相矛盾、分不出里外层时给 None（停下问用户）。"""
    found = host_candidates()
    return (found[0] if len(found) == 1 else None), found


# ---------------------------------------------------------------------------
# 宿主的围栏（prd L）
# ---------------------------------------------------------------------------


def _codex_config_approval() -> tuple[str, str] | None:
    """Codex 配置里顶层或当前 profile 的 approval_policy 与配置文件路径；没写时给 None。"""
    path = _codex_home() / "config.toml"
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return None
    section, values = "", {}
    for line in text.splitlines():
        head = re.match(r"\s*\[([^\]]+)\]\s*$", line)
        if head:
            section = head.group(1).strip()
            continue
        m = re.match(r"""\s*(approval_policy|profile)\s*=\s*["']([^"']+)["']""", line)
        if m:
            values[(section, m.group(1))] = m.group(2)
    profile = values.get(("", "profile"))
    policy = values.get((f"profiles.{profile}", "approval_policy")) if profile else None
    policy = policy or values.get(("", "approval_policy"))
    return (policy, str(path)) if policy else None


def _codex_approval_never() -> str | None:
    """Codex 配置里顶层或当前 profile 的 approval_policy 是 never 时给出配置文件路径。"""
    found = _codex_config_approval()
    return found[1] if found and found[0] == "never" else None


CLAUDE_MANAGED_SETTINGS = (
    Path("/Library/Application Support/ClaudeCode/managed-settings.json"),
    Path("/etc/claude-code/managed-settings.json"),
)


def _claude_settings_files() -> tuple[Path, ...]:
    """Claude Code 的设置文件，按优先级 托管 > 本地 > 项目 > 用户；用户的在最后。"""
    user_dir = Path(os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude")
    return (
        *CLAUDE_MANAGED_SETTINGS,
        Path.cwd() / ".claude/settings.local.json",
        Path.cwd() / ".claude/settings.json",
        user_dir / "settings.json",
    )


def _claude_retry_allowed() -> tuple[bool, str | None]:
    """Claude Code 的 sandbox.allowUnsandboxedCommands 实际取值与定下它的设置文件。

    优先级 托管 > 本地 > 项目 > 用户；但托管或用户设置里的 false 怎样都作数，
    项目的 true 改不回来（官方文档 sandboxing「Turn off the retry with strict sandbox mode」）。
    """
    ranked = _claude_settings_files()
    user = ranked[-1]
    values: list[tuple[Path, bool]] = []
    for f in ranked:
        settings = _read_json(f)
        box = settings.get("sandbox") if isinstance(settings, dict) else None
        value = box.get("allowUnsandboxedCommands") if isinstance(box, dict) else None
        if isinstance(value, bool):
            values.append((f, value))
    for f, value in values:
        if value is False and (f in CLAUDE_MANAGED_SETTINGS or f == user):
            return False, str(f)
    if values:
        return values[0][1], str(values[0][0])
    return True, None


def _claude_permission_mode() -> tuple[str, str] | None:
    """设置里实际生效的 permissions.defaultMode 与定下它的文件；启动时的开关看不到。"""
    for f in _claude_settings_files():
        settings = _read_json(f)
        perms = settings.get("permissions") if isinstance(settings, dict) else None
        mode = perms.get("defaultMode") if isinstance(perms, dict) else None
        if isinstance(mode, str) and mode:
            return mode, str(f)
    return None


def _can_write_git() -> bool:
    """这条命令能不能在当前仓库的 .git 里建文件（冻结要写快照与引用）；不在仓库里算不能。"""
    try:
        git_dir = Path(_git(Path.cwd(), ["rev-parse", "--path-format=absolute", "--git-common-dir"]).strip())
        fd, tmp = tempfile.mkstemp(prefix=".atw-host-", dir=git_dir)
    except (ReviewError, OSError):
        return False
    os.close(fd)
    os.unlink(tmp)
    return True


def _codex_fenced() -> bool:
    """Codex 的围栏给命令设 CODEX_SANDBOX；申请获批在围栏外跑的命令（codex 0.163.0 macOS 实测）
    不再带 CODEX_SANDBOX，却仍带 CODEX_SANDBOX_NETWORK_DISABLED=1，实际能联网、能写 .git。

    只剩网络变量时要冻结（写 .git）与复查员联网两样都有证据才算出了围栏：.git 当场试写；
    网络只认实测过的 macOS——不在本地探测连通性，免得走代理的电脑被误判、也不多等超时。
    别的平台（Linux 上可能本就没有 CODEX_SANDBOX）按仍在围栏里，宿主照 skill 在冻结之前停下。
    """
    if os.environ.get("CODEX_SANDBOX"):
        return True
    if not os.environ.get("CODEX_SANDBOX_NETWORK_DISABLED"):
        return False
    return sys.platform != "darwin" or not _can_write_git()


def host_sandbox() -> dict:
    """主 AI 跑的命令是不是在宿主的围栏里、能不能申请到围栏外跑。

    只认这条命令自己：在围栏外重跑一次（申请获批后）就不再算在围栏里。
    能否申请按实际生效的设置；只看得到配置文件时给 unknown，以那次申请本身为准。
    """
    env = os.environ
    found: list[dict] = []
    if _codex_fenced():
        # 会话记录里的 approval_policy 是实际生效的（含 --approve-for-me、-a、profile 等启动时的覆盖）；
        # 读不到时配置文件的 never 可能已被启动开关盖过，只能说不确定、先申请一次
        effective = _codex_session_value(env.get("CODEX_THREAD_ID", ""), "approval_policy")
        if effective:
            can, source = ("no" if effective[0] == "never" else "yes"), effective[1]
        else:
            source = _codex_approval_never()
            can = "unknown" if source else "yes"
        found.append({
            "by": "codex",
            "networkDisabled": env.get("CODEX_SANDBOX_NETWORK_DISABLED") == "1",
            "canRequest": can,
            "requestWith": "require_escalated",
            "source": source,
        })
    # Claude Code 给围栏里跑的每条命令设 SANDBOX_RUNTIME=1（@anthropic-ai/sandbox-runtime）
    if env.get("SANDBOX_RUNTIME") == "1":
        allowed, source = _claude_retry_allowed()
        found.append({
            "by": "claude",
            "networkDisabled": None,
            "canRequest": "yes" if allowed else "no",
            "requestWith": "dangerouslyDisableSandbox",
            "source": source,
        })
    candidates = host_candidates()
    return {
        "host": candidates[0] if len(candidates) == 1 else None,
        "hostCandidates": candidates,
        "sandboxed": bool(found),
        "canRequest": next((c for c in ("no", "unknown") if any(s["canRequest"] == c for s in found)), "yes") if found else None,
        "sandboxes": found,
    }


def _codex_session_value(thread_id: str, key: str) -> tuple[str, str] | None:
    """本次 Codex 会话记录文件里最后一轮 turn_context 的某一项（实际生效的值，含启动时的覆盖）。"""
    sessions = _codex_home() / "sessions"
    if not thread_id or not sessions.is_dir():
        return None
    for f in sorted(sessions.rglob(f"rollout-*-{thread_id}.jsonl"), reverse=True):
        value = None
        try:
            lines = f.read_text(encoding="utf-8").splitlines()
        except OSError:
            continue
        for line in lines:
            try:
                o = json.loads(line)
            except ValueError:
                continue
            if isinstance(o, dict) and o.get("type") == "turn_context":
                v = (o.get("payload") or {}).get(key)
                if isinstance(v, str) and v:
                    value = v
        if value:
            return value, str(f)
    return None


def _codex_session_model(thread_id: str) -> tuple[str, str] | None:
    """本次 Codex 会话记录文件里最后一轮的 turn_context.model。"""
    return _codex_session_value(thread_id, "model")


def current_ai(host: str | None, model_line: str | None) -> dict | None:
    """按宿主查固定来源，不让模型自报；查不出给 None。"""
    model = source = None
    if host in ("claude", "omp") and model_line:
        if host == "claude":
            # 宿主可能整行照抄，id 后面还跟着别的句子；id 后紧跟的标点不算 id。
            # 「powered by the model」后要整个 id 带标点结束一句，「Opus 5.5」「named Opus」这类显示名不当 id
            model_id = r"""([^\s,;.)"]+(?:\.[^\s,;.)"]+)*)"""
            m = re.search(rf"""exact model ID is {model_id}[,;.)"]*(?:\s|$)""", model_line) or re.search(
                rf"""powered by the model (?!named\s){model_id}(?:[,;.)"]+(?:\s|$)|$)""", model_line
            )
        else:
            m = re.search(r"Model:\s*(\S+)", model_line)
        if m:
            model, source = m.group(1), "system prompt"
    elif host == "pi":
        provider, name = os.environ.get("PI_PROVIDER"), os.environ.get("PI_MODEL")
        if name:
            model = f"{provider}/{name}" if provider else name
            source = "PI_PROVIDER/PI_MODEL"
    elif host == "codex":
        found = _codex_session_model(os.environ.get("CODEX_THREAD_ID", ""))
        if found:
            model, source = found[0], f"Codex session record {found[1]}"
    if model is None or host is None:
        return None
    return {"model": model, "families": families_of(model, host), "source": source}


def _family_named(name: str) -> list[str]:
    for family in FAMILY_WORDS:
        if family.lower() == name.strip().lower():
            return [family]
    return families_of(name)


def _parse_wanted(spec: str) -> dict:
    """当场点名：`<工具> [model=<模型>] [effort=<强度>]`，模型可省（用查实的默认模型）。"""
    parts = spec.split()
    if not parts or parts[0] not in TOOLS:
        raise ReviewError(f"复查员「{spec}」要以工具名开头：{' / '.join(TOOLS)}")
    fields: dict[str, str] = {}
    for part in parts[1:]:
        key, sep, value = part.partition("=")
        if not sep or not value or key not in ("model", "effort"):
            raise ReviewError(f"复查员「{spec}」里的「{part}」不认识，只认 model= 与 effort=")
        fields[key] = value
    _check_effort(spec, parts[0], fields.get("effort"))
    return {"tool": parts[0], "model": fields.get("model"), "effort": fields.get("effort")}


def _candidate(tool: str, model: str, effort: str | None, avoid: list[str] | None, auto: bool,
               record_actual: bool) -> dict:
    fams = families_of(model, tool)
    return {
        "tool": tool,
        "model": model,
        "effort": effort,
        "families": fams,
        # 认不出家或不知道要避开谁时为 None
        "sameFamily": bool(set(fams) & set(avoid)) if fams and avoid is not None else None,
        "unrecognised": not fams,
        "needsNod": auto,
        # Claude Code 复查员锁在仓库里；其余三个技术上能读到用户能读的文件
        "readsWholeDisk": tool != "claude",
        "recordActualModel": record_actual,
    }


def _who_wrote(args: argparse.Namespace) -> tuple[dict, list[str] | None]:
    """判宿主、当前 AI 与作者；给出输出的公共部分与要避开的家（不知道时为 None）。"""
    host, candidates = detect_host()
    current = current_ai(host, args.model_line)
    if host in ("claude", "omp") and args.model_line is not None and current is None:
        # 传错了那一行（只给模型编号、只抄半句等）当场退出 2，不往下给「认不出哪家 AI」的结果
        raise ReviewError(
            f"认不出 --model-line「{args.model_line}」里的模型：要原样照抄系统提示里写模型的那一整行——"
            "Claude Code 是以「You are powered by the model」开头的那一整行（后面若有「The exact model ID is …」一句也照抄），"
            "omp 是「- Model: <provider>/<id>」那一行"
        )
    author: list[str] | None = None
    if args.author:
        author = []
        for name in args.author:
            fams = _family_named(name)
            if not fams:
                raise ReviewError(f"认不出作者「{name}」是哪家：给家名（如 OpenAI）或模型名")
            author += [f for f in fams if f not in author]
    if author is not None:
        avoid: list[str] | None = author
    elif current is not None and current["families"]:
        avoid = current["families"]
    else:
        avoid = None
    return {
        "host": host,
        "hostCandidates": candidates,
        "current": current,
        "author": author,
        "avoid": avoid or [],
        "needsUser": NEEDS_USER_CURRENT_AI if avoid is None else None,
    }, avoid


def _auto_skip_reason(p: dict, avoid: list[str]) -> str | None:
    """自动挑的合格条件：能用、认得出家、与作者不同家。"""
    if p["reason"] is not None:
        return p["reason"]
    if not p["families"]:
        return "unrecognised-family"
    if set(p["families"]) & set(avoid):
        return "same-family"
    return None


def cmd_wizard(args: argparse.Namespace) -> dict:
    out, avoid = _who_wrote(args)
    tools = []
    recommended = None
    for tool in AUTO_PICK_ORDER:
        p = probe_tool(tool)
        same = bool(set(p["families"]) & set(avoid)) if p["families"] and avoid is not None else None
        tools.append({**p, "usable": p["reason"] is None, "sameFamily": same, "readsWholeDisk": tool != "claude"})
        if recommended is None and avoid is not None and _auto_skip_reason(p, avoid) is None:
            recommended = tool
    return {**out, "tools": tools, "recommended": recommended}


def _settled(w: dict, avoid: list[str] | None) -> tuple[dict | None, str | None]:
    """点名或设置里的一个复查员：写了模型照收、不先查；没写模型时查默认模型，用不了给原因。"""
    if w["model"] is not None:
        return _candidate(w["tool"], w["model"], w["effort"], avoid, False, False), None
    p = probe_tool(w["tool"])
    if p["reason"] is not None:
        return None, p["reason"]
    return _candidate(
        w["tool"], p["defaultModel"], w["effort"] or p["defaultEffort"], avoid, False, p["recordActualModel"]
    ), None


def _auto_pick(avoid: list[str], exclude: set[str]) -> tuple[dict | None, list[dict]]:
    """只挑一个：按顺序找第一个合格的，不先试跑；exclude 里的工具（这次跑不起来的）不再去查。"""
    skipped: list[dict] = []
    for tool in AUTO_PICK_ORDER:
        if tool in exclude:
            skipped.append({"tool": tool, "reason": "failed"})
            continue
        p = probe_tool(tool)
        reason = _auto_skip_reason(p, avoid)
        if reason is not None:
            skipped.append({"tool": tool, "reason": reason})
            continue
        return _candidate(tool, p["defaultModel"], p["defaultEffort"], avoid, True, p["recordActualModel"]), skipped
    return None, skipped


def _chosen_failed(out: dict, avoid: list[str] | None, failed: list[str]) -> dict:
    """点名或设置里的跑不起来：不自动换人，只给出问「换成自动挑出的某某」时的那一个。"""
    if failed and avoid is not None:
        running = {r["tool"] for r in out["reviewers"]}
        alt, _ = _auto_pick(avoid, set(failed) | running)
    else:
        alt = None
    out["failed"] = [{"tool": t, "from": out["mode"], "ask": "retry-switch-skip", "next": alt} for t in failed]
    return out


def _from_settings(reviewers: list[dict], avoid: list[str] | None, out: dict) -> int:
    """设置里的复查员逐个定下：同家的与跑不起来的进 skipped（不换人）；返回因同家跳过的个数。"""
    same_family = 0
    for w in reviewers:
        fams = families_of(w["model"], w["tool"]) if w["model"] is not None else None
        c, reason = (None, "same-family") if fams and avoid and set(fams) & set(avoid) else _settled(w, avoid)
        # 省略模型的查完默认模型才知道是哪家
        if c is not None and c["sameFamily"]:
            c, reason = None, "same-family"
        if c is None:
            same_family += reason == "same-family"
            out["skipped"].append({"tool": w["tool"], "model": w["model"], "reason": reason, "from": "settings"})
        else:
            out["reviewers"].append(c)
    return same_family


def _pick_settings_only(out: dict, avoid: list[str] | None) -> dict:
    """无人值守时（prd K 节）：只用设置里的，不自动挑、不换人、不弹向导；用不成时给原因，不退出 2。"""
    out["mode"] = "settings-only"
    out["unavailable"] = None
    # 日志复查没做成时，清单条目的 --command 直接取它（工单 22）；认不出宿主时为 None
    zh, en = (skill_input(f"atw-cross-model-review {w}", out["host"]) for w in ENTRY_WORDS["log-review"])
    out["logReviewCommand"] = None if zh is None else {"zh": zh, "en": en}

    def unavailable(reason: str, detail: str | None = None) -> dict:
        out["unavailable"] = {"reason": reason, "detail": detail}
        return out

    try:
        settings = read_settings()
    except ReviewError as e:
        out["settings"] = {"file": str(settings_path()), "warnings": []}
        return unavailable("settings-broken", str(e))
    out["settings"] = {"file": settings["file"], "warnings": settings["warnings"]}
    if not settings["reviewers"]:
        return unavailable("no-settings")
    if avoid is None:
        # 不知道要避开哪家就得问用户，而这时没人能问
        return unavailable(NEEDS_USER_CURRENT_AI)
    box = host_sandbox()
    if box["sandboxed"]:
        # 复查员在宿主围栏里连不上模型，出围栏要用户点头（canRequest 为 no 时连申请都不行）
        fences = "、".join(f"{b['by']}（canRequest {b['canRequest']}）" for b in box["sandboxes"])
        return unavailable("sandbox-needs-approval", f"命令在宿主的围栏里：{fences}")
    _from_settings(settings["reviewers"], avoid, out)
    return out if out["reviewers"] else unavailable("none-qualified")


def cmd_pick(args: argparse.Namespace) -> dict:
    if args.settings_only and (args.reviewer or args.auto or args.failed):
        raise ReviewError("--settings-only 只用设置里的复查员：不与 --reviewer、--auto、--failed 同用（不点名、不自动挑、不换人）")
    out, avoid = _who_wrote(args)
    failed = args.failed or []
    out.update({"mode": "auto", "settings": None, "reviewers": [], "skipped": [], "failed": []})
    if args.settings_only:
        return _pick_settings_only(out, avoid)
    if args.reviewer:
        # 当场点名优先：照跑，同家或认不出也照跑（由 AI 开跑前说一句）
        out["mode"] = "named"
        for spec in args.reviewer:
            w = _parse_wanted(spec)
            c, reason = _settled(w, avoid)
            if c is None:
                out["skipped"].append({"tool": w["tool"], "reason": reason})
            else:
                out["reviewers"].append(c)
        return _chosen_failed(out, avoid, failed)
    if not args.auto:
        settings = read_settings()
        out["settings"] = {"file": settings["file"], "warnings": settings["warnings"]}
        if not settings["reviewers"]:
            out["mode"] = "setup"  # 这台电脑还没设复查员：走设置向导，向导即这次的确认
            return out
        out["mode"] = "settings"
        same_family = _from_settings(settings["reviewers"], avoid, out)
        # 全因同家被跳过才改自动挑；跑不起来的是用户选定的人，不自动换
        if same_family < len(settings["reviewers"]):
            return _chosen_failed(out, avoid, failed)
        out["mode"] = "auto"
    if avoid is None:
        # 不知道要避开哪家就不挑，停下问用户；跑不起来的照样列出
        out["failed"] = [{"tool": t, "from": "auto", "ask": "nod", "next": None} for t in failed]
        return out
    picked, skipped = _auto_pick(avoid, set(failed))
    out["skipped"] += skipped
    if picked is not None:
        out["reviewers"].append(picked)
    # 自动挑出的跑不起来：推荐下一个合格的，用户点头再换
    out["failed"] = [{"tool": t, "from": "auto", "ask": "nod", "next": picked} for t in failed]
    return out


def codex_personal_instructions() -> str | None:
    """Codex 复查员关不掉的用户个人说明文件；有内容时返回路径。"""
    home = Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex")
    for name in ("AGENTS.override.md", "AGENTS.md"):
        p = home / name
        if p.is_file() and p.stat().st_size > 0:
            return str(p)
    return None


# ---------------------------------------------------------------------------
# 材料与题目
# ---------------------------------------------------------------------------


def _rel(root: Path, p: Path) -> str:
    try:
        return p.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return str(p)


def ticket_bodies(issues_dir: Path) -> str:
    """全部工单正文，去掉末尾的 `## Comments` 一节。"""
    out: list[str] = []
    for f in sorted(issues_dir.glob("*.md")):
        body: list[str] = []
        for line in f.read_text(encoding="utf-8").splitlines():
            if line.strip() == "## Comments":
                break
            body.append(line)
        out.append(f"===== {f.name} =====\n" + "\n".join(body).rstrip() + "\n")
    return "\n".join(out)


def _change_line(scope: dict, patch_rel: str, group: tuple[int, int, list[str]] | None) -> str:
    base, commit = scope["base"], scope["baseCommit"]
    if scope["baseFrom"] == "snapshot":
        what = (
            f"only what changed after the last review: everything that differs from snapshot `{commit}`"
            " (the working tree the last review saw), uncommitted edits and new files included."
        )
    elif scope["onBase"]:
        what = f"the uncommitted edits and new files on `{base}`, on top of commit `{commit}`."
    elif scope["baseFrom"] == "since":
        what = f"everything since commit `{commit}` (from `{base}`), uncommitted edits and new files included."
    else:
        what = (
            f"everything since commit `{commit}` (where this branch left `{base}`), uncommitted edits and"
            " new files included."
        )
    line = f"- The change under review: `{patch_rel}` — {what}"
    if group is not None:
        k, n, members = group
        listed = ", ".join(f"`{x}`" for x in members)
        line += f" This is group {k} of {n} ({listed}); the rest of the change is reviewed separately."
    return line


def build_prompt(
    root: Path,
    questions: str,
    scope: dict,
    path_only: list[dict],
    patch_rel: str,
    group: tuple[int, int, list[str]] | None,
    task: Path | None,
    tickets_rel: str | None,
    intent: str | None,
    picked_rel: str | None = None,
) -> str:
    m: list[str] = [
        "## Material",
        "",
        "Everything listed here is on disk under the working directory. Read it with your"
        " read-only tools. Every reviewer in this round gets exactly the same material.",
        "",
        _change_line(scope, patch_rel, group),
    ]
    if scope["paths"]:
        m.append("- Only these paths were asked for: " + ", ".join(f"`{x}`" for x in scope["paths"]) + ".")
    if path_only:
        listed = ", ".join(f"`{x['path']}` ({x['reason']})" for x in path_only)
        m.append(f"- Changed but not in the patch (binary or too large; open them yourself if they matter): {listed}.")
    if task is not None and (task / "prd.md").is_file():
        m.append(f"- The spec this change implements: `{_rel(root, task / 'prd.md')}`.")
    if tickets_rel is not None:
        m.append(f"- The tickets it was sliced into (bodies only): `{tickets_rel}`.")
    if picked_rel is not None:
        m.append(
            f"- The findings the user picked to fix after the last review, from its report: `{picked_rel}`."
        )
    if task is not None and (task / "decision-log.md").is_file():
        m.append(
            f"- The author's decision log: `{_rel(root, task / 'decision-log.md')}`. Treat every entry"
            " as a claim to check, not as fact: does the code really do what it says, for the reason"
            " it gives, and does the evidence it points to open?"
        )
    if intent is not None:
        m.append("- There is no written spec. What the change is meant to do, as the author put it:")
        m.append("")
        m.extend(f"  > {line}" if line else "  >" for line in intent.strip().splitlines())
        m.append("")
    conventions = [_rel(root, p) for p in sorted((root / ".atw/spec").glob("**/index.md"))]
    conventions += [n for n in ("AGENTS.md", "CLAUDE.md") if (root / n).is_file()]
    if conventions:
        m.append(
            "- The project's written conventions, to read as needed: "
            + ", ".join(f"`{c}`" for c in conventions)
            + "."
        )
    # prd E：任务目录里给出的之外（调研笔记、决策单、追踪文件、别的任务）都不是材料
    m.append(
        "- Nothing else under `.atw/tasks/` is review material: not this task's `research/` notes,"
        " `map-issues/`, `check.jsonl` or `task.json`, and not other tasks. Do not read it and do"
        " not use it as evidence."
    )
    m.append(
        "- Apart from that, you may read any other file in the repository to follow a call or check"
        " a claim. You may not change anything."
    )
    return questions.rstrip() + "\n\n---\n\n" + "\n".join(m) + "\n"


# ---------------------------------------------------------------------------
# 开跑前交代（prd C 节第 4 项；工单 28）：脚本写好，AI 原样贴出
# ---------------------------------------------------------------------------

TOOL_NAMES = {"claude": "Claude Code", "codex": "Codex", "pi": "pi", "omp": "omp"}
SKIP_REASONS = {
    "not-installed": ("没装", "not installed"),
    "not-logged-in": ("没登录", "not logged in"),
    "no-default-model": ("没设默认模型", "no default model set"),
    "model-unavailable": ("模型不在它的可用列表里", "the model is not in its list"),
    "quota-exhausted": ("额度用完了", "its quota is used up"),
    "probe-failed": ("检查它时出错了，它本身也许能用", "checking it failed; the tool itself may still work"),
    "probe-timed-out": ("检查它时没按时回应", "checking it did not answer in time"),
    "unrecognised-family": ("认不出是哪家", "its family cannot be told"),
}


def _who(r: dict) -> str:
    return f"{TOOL_NAMES[r['tool']]} `{r['model']}`"


def _files(n: int, en: bool) -> str:
    return (f"{n} file" + ("" if n == 1 else "s")) if en else f"{n} 个文件"


def _lines(n: int, en: bool) -> str:
    return (f"{n} line" + ("" if n == 1 else "s")) if en else f"{n} 行"


def _ticks(items: list[str], en: bool) -> str:
    return (", " if en else "、").join(f"`{x}`" for x in items)


def _scope_clause(out: dict, en: bool) -> str:
    base, c = out["base"], out["baseCommit"][:7]
    size = (", " if en else "，").join([_files(len(out["files"]), en), _lines(out["totalLines"], en)])
    if out["baseFrom"] == "snapshot":
        s = (f"This is a recheck, of only what changed after the last review (against snapshot `{c}`, uncommitted"
             f" edits and new files included): {size}." if en else
             f"这是复核，只看上次复查之后改过的地方（与快照 `{c}` 相比，含未提交的修改与新文件）：{size}。")
    elif out["onBase"]:
        s = (f"Reviewing only the uncommitted edits and new files on `{base}`, on top of commit `{c}`: {size}." if en
             else f"这次只复查 `{base}` 上未提交的修改与新文件（在提交 `{c}` 之上）：{size}。")
    elif out["baseFrom"] == "since":
        # 用户给的就是提交号时不再重复一遍
        given = "" if out["baseCommit"].startswith(base) else (
            f" (the start point you gave, `{base}`)" if en else f"（你给的起点 `{base}`）")
        s = (f"Reviewing everything since commit `{c}`{given}, uncommitted edits and new files included: {size}." if en
             else f"这次复查自提交 `{c}`{given}以来的全部改动，含未提交的修改与新文件：{size}。")
    else:
        s = (f"Reviewing everything since this branch left `{base}` (from commit `{c}`, uncommitted edits and new"
             f" files included): {size}." if en else
             f"这次复查这条分支离开 `{base}` 以来的全部改动（自提交 `{c}` 起，含未提交的修改与新文件）：{size}。")
    if out["paths"]:
        s += (f" Only these paths: {_ticks(out['paths'], en)}." if en else f"只看你指定的：{_ticks(out['paths'], en)}。")
    if out.get("groups"):
        gs = out["groups"]
        parts = [
            (f"group {i} {_ticks(g['paths'], en)}, {_files(len(g['files']), en)}, {_lines(g['totalLines'], en)}" if en
             else f"第 {i} 组 {_ticks(g['paths'], en)}，{_files(len(g['files']), en)}，{_lines(g['totalLines'], en)}")
            for i, g in enumerate(gs, 1)
        ]
        s += (f" In {len(gs)} groups, run one after another: {'; '.join(parts)}." if en
              else f"分 {len(gs)} 组，各跑一次：{'；'.join(parts)}。")
    return s


def _reviewer_part(r: dict, fams: list[str], en: bool) -> str:
    bits = []
    if r["effort"]:
        bits.append(f"effort {r['effort']}" if en else f"思考强度 {r['effort']}")
    if fams:
        bits.append(f"{', '.join(fams)}, recognised by name" if en else f"按名字认出是 {'、'.join(fams)} 家")
    else:
        bits.append("family cannot be told" if en else "认不出是哪家")
    return f"{_who(r)} ({', '.join(bits)})" if en else f"{_who(r)}（{'，'.join(bits)}）"


def _skip_reason(s: dict, avoid: list[str], en: bool) -> str:
    if s["reason"] == "same-family":
        fam = ", ".join(avoid) if en else "、".join(avoid)
        return f"same family as the AI that wrote the change: {fam}" if en else f"与写这段改动的 AI 同家：{fam}"
    zh_en = SKIP_REASONS.get(s["reason"])
    return s["reason"] if zh_en is None else zh_en[1 if en else 0]


def _unrecognised_sentence(r: dict, en: bool) -> str:
    return (f"{_who(r)}'s family cannot be told, so it may be the same; it runs anyway, so the review counts for less."
            if en else f"{_who(r)} 认不出是哪家，分不清是不是同家，仍然照跑，这次复查的分量要打折扣。")


def _skipped_line(from_settings: list[dict], avoid: list[str], en: bool) -> str:
    """设置里这次不跑的人与原因，不带句末标点。"""
    items = []
    for s in from_settings:
        who = TOOL_NAMES[s["tool"]] + (f" `{s['model']}`" if s.get("model") else "")
        why = _skip_reason(s, avoid, en)
        items.append(f"{who} ({why})" if en else f"{who}（{why}）")
    return (f"From the settings, these sit this round out: {'; '.join(items)}" if en
            else f"设置里的这几个这次不跑：{'；'.join(items)}")


def _check_pick(pick: object) -> None:
    """冻结之前查 --pick 里交代要用的字段，免得写到一半才出错、留下快照引用。"""
    bad = "--pick 要原样给 pick 输出的那个 JSON 对象"
    if not isinstance(pick, dict):
        raise ReviewError(bad)
    if not isinstance(pick.get("mode"), (str, type(None))):
        raise ReviewError(f"{bad}：mode 不对")
    avoid = pick.get("avoid")
    if avoid is not None and not (isinstance(avoid, list) and all(isinstance(x, str) for x in avoid)):
        raise ReviewError(f"{bad}：avoid 要是家名的列表")
    for key in ("reviewers", "skipped"):
        items = pick.get(key)
        if items is None:
            continue
        if not isinstance(items, list) or not all(isinstance(x, dict) for x in items):
            raise ReviewError(f"{bad}：{key} 要是对象的列表")
        if key == "skipped" and not all(x.get("tool") in TOOLS and isinstance(x.get("reason"), str) for x in items):
            raise ReviewError(f"{bad}：skipped 每条要有 tool 与 reason")


READS_CODE = (
    "复查员可以只读地翻看仓库里的其他文件（任务记录里材料以外的不算），每个复查员最多 30 分钟。",
    "Reviewers may read other files in the repository, read-only (task records outside the material"
    " excepted), and each gets at most 30 minutes.",
)


def build_notice(
    out: dict,
    pick: dict | None,
    scope: Callable[[dict, bool], str] = _scope_clause,
    reads: tuple[str, str] = READS_CODE,
) -> dict:
    """按 prepare 的结果与 pick 的输出写好开跑前那段交代（中英各一份），只列用得上的项。

    日志复查换掉开头讲范围的那句（scope）与讲复查员能读什么的那句（reads），其余照用。
    """
    pick = pick or {}
    mode = pick.get("mode")
    avoid = pick.get("avoid") or []
    named = {(r.get("tool"), r.get("model")) for r in pick.get("reviewers") or []} if mode == "named" else set()
    from_settings = [s for s in pick.get("skipped") or [] if s.get("from") == "settings"]
    notice = {}
    for lang in ("zh", "en"):
        en = lang == "en"
        sent = [scope(out, en)]
        rs = out["reviewers"]
        fams = [families_of(r["model"], r["tool"]) for r in rs]
        listed = [_reviewer_part(r, f, en) for r, f in zip(rs, fams)]
        if len(rs) == 1:
            sent.append(f"It goes to {listed[0]}." if en else f"交给 {listed[0]}。")
        else:
            sent.append(f"It goes to {len(rs)} reviewers, at the same time on the same material: {'; '.join(listed)}."
                        if en else f"交给 {len(rs)} 个复查员，同时跑、材料相同：{'；'.join(listed)}。")
        for r, f in zip(rs, fams):
            if not f:
                sent.append(_unrecognised_sentence(r, en))
            elif set(f) & set(avoid):
                same = ", ".join(x for x in f if x in avoid) if en else "、".join(x for x in f if x in avoid)
                sent.append(f"{_who(r)} is of the same family as the AI that wrote the change ({same}); it runs anyway,"
                            " so the review counts for less." if en else
                            f"{_who(r)} 与写这段改动的 AI 同家（{same}），仍然照跑，这次复查的分量要打折扣。")
        if from_settings:
            line = _skipped_line(from_settings, avoid, en)
            if mode == "auto":
                line += ", so the reviewer this time was picked automatically" if en else "，所以这次用自动挑出的复查员"
            sent.append(line + ("." if en else "。"))
        # prd F 节：当场点名的在这段话里提醒一次；设置里的、点头同意的已在认可时说过，复核沿用第一次的人也不再说
        recheck = out.get("baseFrom") == "snapshot"
        disk = [_who(r) for r in rs if r["tool"] != "claude" and (r["tool"], r["model"]) in named and not recheck]
        if disk:
            sent.append(f"{' and '.join(disk)} can technically read any file on this computer that you can read." if en
                        else f"{'、'.join(disk)} 技术上能读到这台电脑上你能读的任何文件。")
        secret_like = out.get("skippedSecretLike") or []
        if secret_like:
            names = " and ".join(f"`{x}`" for x in secret_like) if en else _ticks(secret_like, en)
            sent.append(f"{names} {'is' if len(secret_like) == 1 else 'are'} left out because"
                        f" {'its name looks' if len(secret_like) == 1 else 'their names look'} like"
                        " secrets." if en else f"{names} 名字像密钥，没放进去。")
        for r in rs:
            if r.get("personalInstructions"):
                p = r["personalInstructions"]
                sent.append(f"{_who(r)} will read your personal instructions at `{p}` (Codex has no switch to turn"
                            " them off)." if en else f"{_who(r)} 会读你的个人说明 `{p}`（Codex 没有开关能关掉）。")
        sent.append(reads[1] if en else reads[0])
        sent.append("Interrupt now to change the scope." if en else "要改范围，现在打断我。")
        notice[lang] = (" " if en else "").join(sent)
    return notice


# ---------------------------------------------------------------------------
# 无人值守的开跑提醒（prd F 节；工单 20）：脚本写好全文，两个连做 skill 原样贴出
# ---------------------------------------------------------------------------

# 当前工具输 skill 的写法；认不出宿主时三种都给
SKILL_PREFIX = {"claude": "/", "codex": "$", "pi": "/skill:", "omp": "/skill:"}
ENTRY_WORDS = {"setup": ("设置", "setup"), "log-review": ("日志复查", "log-review")}
SENT_ITEMS = (
    "这次运行在决定日志里写的那一段，加这次对话的聊天记录（你和我说的话，以及每条命令和它结果的开头结尾几行），发出前先打码。",
    "this run's part of the decision log and this conversation's chat (what you and I said, plus the first and last"
    " lines of each command and its result), redacted first.",
)
SKIP_WHY = {
    "no-settings": ("这台电脑还没设复查员", "no reviewers are set on this computer"),
    "none-qualified": ("设置里的复查员这次都不能跑", "none of the reviewers in the settings can run this time"),
    NEEDS_USER_CURRENT_AI: ("认不出写改动的是哪家 AI，没法避开同家的复查员",
                            "which family the AI writing the changes is from cannot be told, so a reviewer of the"
                            " same family cannot be avoided"),
}
MODEL_LINE_SHAPES = {
    "claude": ("系统提示里以 `You are powered by the model` 开头的那一整行",
               "the whole line of the system prompt that starts `You are powered by the model`"),
    "omp": ("系统提示里 `- Model: <provider>/<id>` 那一整行", "the whole `- Model: <provider>/<id>` line of the system prompt"),
}
LEAVE_FENCE = {
    "claude": ("在 Claude Code 里用 `/sandbox` 关掉命令围栏", "turn Claude Code's command sandbox off in `/sandbox`"),
    "codex": ("不带围栏重新启动 Codex（`--dangerously-bypass-approvals-and-sandbox`，即全权限）",
              "start Codex again without its sandbox (`--dangerously-bypass-approvals-and-sandbox`, full access)"),
}


def skill_input(cmd: str, host: str | None) -> str | None:
    """当前宿主里输这条 skill 命令的写法（不带反引号）；认不出宿主时给 None。"""
    return f"{SKILL_PREFIX[host]}{cmd}" if host in SKILL_PREFIX else None


def _typed(cmd: str, host: str | None, en: bool) -> str:
    typed = skill_input(cmd, host)
    if typed is not None:
        return f"`{typed}`"
    return (f"`/{cmd}` (Claude Code), `${cmd}` (Codex) or `/skill:{cmd}` (pi, omp)" if en
            else f"`/{cmd}`（Claude Code）、`${cmd}`（Codex）或 `/skill:{cmd}`（pi、omp）")


def _entry(word: str, host: str | None, en: bool) -> str:
    return _typed(f"atw-cross-model-review {ENTRY_WORDS[word][1 if en else 0]}", host, en)


def _branch_sentence(skill: str, branch: str, opened: bool, en: bool) -> str:
    if skill == "atw-implement-spec":
        if opened:
            return (f"This run opened the integration branch `{branch}`; every ticket lands on it." if en
                    else f"这次运行新开了集成分支 `{branch}`，各工单都合入这条分支。")
        return (f"The integration branch is the existing `{branch}`; every ticket lands on it." if en
                else f"集成分支沿用已有的 `{branch}`，各工单都合入这条分支。")
    if opened:
        return (f"This run opened a new branch, `{branch}`, and commits everything on it." if en
                else f"这次运行新开了分支 `{branch}`，改动都提交在这条分支上。")
    return (f"This run opened no new branch; it works on the current branch, `{branch}`." if en
            else f"这次运行没有新开分支，就在当前分支 `{branch}` 上做。")


def _approval_sentence(host: str | None, en: bool) -> str:
    """宿主会不会逐条要授权：只说查得到的（来源写明），启动时的开关查不到就说查不到。"""
    override = ("a switch given at start-up can override it, which cannot be found out here" if en
                else "启动时给的开关能盖过它，这里查不到")
    if host == "claude":
        found = _claude_permission_mode()
        if found is None:
            return ("Whether Claude Code asks you to approve each command: no `permissions.defaultMode` is set in its"
                    " settings; a switch given at start-up can override the settings, which cannot be found out here."
                    if en else "Claude Code 会不会每条命令都要你授权：设置里没写 `permissions.defaultMode`；"
                    "启动时给的开关能盖过设置，这里查不到。")
        mode, f = found
        means = (", so it does not ask" if en else "，即不逐条要授权") if mode == "bypassPermissions" else ""
        return (f"Whether Claude Code asks you to approve each command: `permissions.defaultMode` in `{f}` is"
                f" `{mode}`{means}; {override}." if en else
                f"Claude Code 会不会每条命令都要你授权：设置 `{f}` 里 `permissions.defaultMode` 是 `{mode}`{means}；{override}。")
    if host == "codex":
        def means(policy: str) -> str:
            return (", so it never stops to ask" if en else "，即不停下来要授权") if policy == "never" else ""
        effective = _codex_session_value(os.environ.get("CODEX_THREAD_ID", ""), "approval_policy")
        if effective:
            v, f = effective
            return (f"Whether Codex asks you to approve each command: `approval_policy` is `{v}` in this session's"
                    f" record `{f}`{means(v)}." if en else
                    f"Codex 会不会每条命令都要你授权：这次会话的记录 `{f}` 里 `approval_policy` 是 `{v}`{means(v)}。")
        configured = _codex_config_approval()
        if configured:
            v, f = configured
            return (f"Whether Codex asks you to approve each command: this session's record cannot be read;"
                    f" `approval_policy` in the config `{f}` is `{v}`{means(v)}; {override}." if en else
                    f"Codex 会不会每条命令都要你授权：读不到这次会话的记录；配置 `{f}` 里 `approval_policy` 是"
                    f" `{v}`{means(v)}；{override}。")
        return ("Whether Codex asks you to approve each command cannot be found out here: this session's record cannot"
                " be read, and the config sets no `approval_policy`." if en else
                "Codex 会不会每条命令都要你授权，这里查不到：读不到这次会话的记录，配置里也没写 `approval_policy`。")
    if host in TOOL_NAMES:
        return (f"Whether {TOOL_NAMES[host]} asks you to approve each command cannot be found out here." if en
                else f"{TOOL_NAMES[host]} 会不会每条命令都要你授权，这里查不到。")
    return ("Which tool this is cannot be told, so whether it asks you to approve each command cannot be found out"
            " here." if en else "认不出这是哪个工具，它会不会每条命令都要你授权，这里查不到。")


def _skipped_review(pick: dict, restart: str, fences: list[str], en: bool) -> list[str]:
    """日志复查会跳过：为什么、现在怎么补（只给当前工具的写法）、事后怎么补。"""
    host, why = pick["host"], pick["unavailable"]
    reason, detail = why["reason"], why["detail"]
    if reason == "settings-broken":
        cause = (f"the reviewer settings cannot be read ({detail})" if en else f"复查员设置读不了（{detail}）")
    elif reason == "sandbox-needs-approval":
        by = " and ".join(TOOL_NAMES[b] for b in fences) if en else "、".join(TOOL_NAMES[b] for b in fences)
        cause = (f"the reviewers need the network to reach their models, so the commands would have to leave {by}'s"
                 " sandbox, which needs your approval, and nobody will be there to give it" if en else
                 f"复查员要连网找模型，命令得跑到 {by} 的围栏外，这要你点头，到时没人能点")
    else:
        cause = SKIP_WHY[reason][1 if en else 0]
    sent = [f"The log review at the end will be skipped this time: {cause}." if en
            else f"收尾时的日志复查这次会跳过：{cause}。"]
    skipped = [s for s in pick.get("skipped") or [] if s.get("from") == "settings"]
    if skipped:
        sent.append(_skipped_line(skipped, pick.get("avoid") or [], en) + ("." if en else "。"))
    setup = _entry("setup", host, en)
    if reason == NEEDS_USER_CURRENT_AI:
        fix = None
    elif reason == "no-settings":
        fix = f"type {setup} to set reviewers" if en else f"输 {setup} 设好复查员"
    elif reason == "settings-broken":
        fix = (f"fix the file named above, or type {setup} to set them again" if en
               else f"改好上面说的那个文件，或输 {setup} 重新设")
    elif reason == "sandbox-needs-approval":
        fix = (", and " if en else "，并").join(LEAVE_FENCE[b][1 if en else 0] for b in fences)
    elif skipped and all(s["reason"] == "same-family" for s in skipped):
        fix = f"type {setup} to add a reviewer of another family" if en else f"输 {setup} 加一个别家的复查员"
    else:
        fix = (f"fix them by the reasons above, or type {setup} to change them" if en
               else f"按上面的原因把它们弄好，或输 {setup} 换人")
    if reason == NEEDS_USER_CURRENT_AI and host in MODEL_LINE_SHAPES and pick["current"] is None:
        # 这两个宿主认不出 AI 只会是没交写模型的那一行（交错了已退出 2）：照抄那一行重跑就补上了
        shape = MODEL_LINE_SHAPES[host][1 if en else 0]
        sent.append(f"To fix it now: run this `afk-notice` command again with `--model-line` set to {shape}." if en
                    else f"要现在补：带上 `--model-line`，照抄{shape}，重跑这条 `afk-notice` 命令。")
    elif fix is None:
        sent.append("There is no fix before the run." if en else "开跑前没有办法补。")
    else:
        sent.append(f"To fix it now: interrupt this run, {fix}, then type {restart} to start again." if en
                    else f"要现在补：打断这次运行，{fix}，再输 {restart} 重新开跑。")
    review = _entry("log-review", host, en)
    sent.append(f"To make it up afterwards, type {review}." if en else f"事后补做：输 {review}。")
    sent.append(f"So nothing is sent at the end; making it up sends {SENT_ITEMS[1]}" if en
                else f"所以收尾时什么都不发出去；补做时发的是{SENT_ITEMS[0]}")
    return sent


def build_afk_notice(pick: dict, skill: str, branch: str, opened: bool, max_n: int | None, task: str) -> dict:
    """`--afk` 开跑提醒（中英各一段）：prd F 节各项，复查员与跳过原因取自同一次 pick --settings-only。"""
    host = pick["host"]
    restart_cmd = f"{skill} --afk" + (f" --max {max_n}" if max_n is not None else "")
    fences = [b["by"] for b in host_sandbox()["sandboxes"]] if pick["unavailable"] else []
    waiting = posixpath.join(task.rstrip("/"), "waiting-on-you.md")
    notice = {}
    for lang in ("zh", "en"):
        en = lang == "en"
        sent = [_branch_sentence(skill, branch, opened, en)]
        if pick["unavailable"]:
            sent += _skipped_review(pick, _typed(restart_cmd, host, en), fences, en)
        else:
            rs = pick["reviewers"]
            fams = [families_of(r["model"], r["tool"]) for r in rs]
            listed = [_reviewer_part(r, f, en) for r, f in zip(rs, fams)]
            if len(rs) == 1:
                sent.append(f"The log review at the end goes to {listed[0]}." if en else f"收尾时的日志复查交给 {listed[0]}。")
            else:
                sent.append(f"The log review at the end goes to {len(rs)} reviewers, at the same time on the same"
                            f" material: {'; '.join(listed)}." if en else
                            f"收尾时的日志复查交给 {len(rs)} 个复查员，同时跑、材料相同：{'；'.join(listed)}。")
            sent += [_unrecognised_sentence(r, en) for r, f in zip(rs, fams) if not f]
            skipped = [s for s in pick["skipped"] if s.get("from") == "settings"]
            if skipped:
                sent.append(_skipped_line(skipped, pick["avoid"], en) + ("." if en else "。"))
            sent.append(f"What they will be sent is {SENT_ITEMS[1]}" if en else f"到时发给复查员的是{SENT_ITEMS[0]}")
        sent.append(_approval_sentence(host, en))
        sent.append("If an approval is asked for mid-run, the run halts there and waits for you; I never change the"
                    " host's settings for you." if en else "中途如果要你授权，运行会停在那里等你；我不替你改宿主的设置。")
        sent.append("Five red lines stay uncrossed: no push, no merge into the base branch (nor a commit on it), no"
                    " publishing, no deleting what git cannot bring back, no lowering the bar." if en else
                    "五条红线不碰：不推送，不合入主线（也不直接在主线上提交），不发布，不删 git 找不回的东西，不降低标准。")
        sent.append(f"Whatever needs you goes into the waiting-on-you list, `{waiting}`, and the run goes around it and"
                    " carries on." if en else f"要你处理的事记进「等你处理」清单 `{waiting}`，记下后绕开接着做。")
        sent.append("This only tells you; it does not wait for an answer, and you may interrupt the run at any time."
                    if en else "这段只是交代，不等你回答；你随时可以打断这次运行。")
        notice[lang] = (" " if en else "").join(sent)
    return notice


# ---------------------------------------------------------------------------
# 子命令
# ---------------------------------------------------------------------------


def _write_frozen(
    root: Path,
    part: dict,
    scope: dict,
    group: tuple[int, int, list[str]] | None,
    questions: str,
    task: Path | None,
    intent: str | None,
    reviewers: list[dict],
    picked: str | None,
    made: list[Path],
) -> dict:
    """把一份补丁连同材料与题目写进自己的编号目录；返回这一份的摘要（也是 run 读的 manifest）。"""
    review_id = time.strftime("%Y%m%d-%H%M%S") + "-" + secrets.token_hex(2)
    out_dir = root / RUNTIME_SUBDIR / review_id
    out_dir.mkdir(parents=True)
    made.append(out_dir)
    patch_rel = (RUNTIME_SUBDIR / review_id / "patch.diff").as_posix()
    (root / patch_rel).write_text(part["patchText"], encoding="utf-8")

    tickets_rel = None
    if task is not None and (task / "issues").is_dir():
        tickets_rel = (RUNTIME_SUBDIR / review_id / "tickets.md").as_posix()
        (root / tickets_rel).write_text(ticket_bodies(task / "issues"), encoding="utf-8")

    picked_rel = None
    if picked is not None:
        picked_rel = (RUNTIME_SUBDIR / review_id / "picked.md").as_posix()
        (root / picked_rel).write_text(picked, encoding="utf-8")

    prompt_rel = (RUNTIME_SUBDIR / review_id / "prompt.md").as_posix()
    prompt = build_prompt(
        root, questions, scope, part["pathOnly"], patch_rel, group, task, tickets_rel, intent, picked_rel
    )
    (root / prompt_rel).write_text(prompt, encoding="utf-8")

    summary = {
        "id": review_id,
        "dir": (RUNTIME_SUBDIR / review_id).as_posix(),
        "patch": patch_rel,
        "prompt": prompt_rel,
        **{k: v for k, v in part.items() if k not in ("patchText", "linesByFile")},
    }
    manifest = {**scope, **summary, "linesByFile": part["linesByFile"], "reviewers": reviewers}
    (out_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
    return summary


def _split(frozen: dict, groups: list[list[str]]) -> list[dict]:
    """把同一次冻结按组分开；有文件哪组都不在、或某组一个文件都没有时报错。"""
    pieces, path_only = frozen["pieces"], frozen["pathOnly"]
    names = sorted(pieces) + [x["path"] for x in path_only]
    where = dict(zip(names, assign_groups(names, groups)))
    stray = [n for n, g in where.items() if g is None]
    if stray:
        raise ReviewError("这些文件不在任何一组里：" + "、".join(sorted(stray)))
    parts = []
    for i, members in enumerate(groups):
        mine = {p: t for p, t in pieces.items() if where[p] == i}
        mine_only = [x for x in path_only if where[x["path"]] == i]
        if not mine and not mine_only:
            raise ReviewError(f"第 {i + 1} 组（{', '.join(members)}）没有改动")
        parts.append(summarize(mine, frozen["lines"], mine_only))
    return parts


def cmd_prepare(args: argparse.Namespace) -> dict:
    reviewers = [parse_reviewer(s) for s in args.reviewer]
    questions_path = Path(args.questions)
    if not questions_path.is_file():
        raise ReviewError(f"找不到题目文件：{questions_path}")
    if args.whole and args.group:
        raise ReviewError("--whole 与 --group 只能选一个：整段看还是分开看")
    if args.recheck and args.since:
        raise ReviewError("--recheck 与 --since 只能给一个：复核从上次的快照算起")
    if bool(args.recheck) != bool(args.picked_file):
        raise ReviewError("--recheck 与 --picked-file 要一起给：复核的材料要有上次报告里用户选去改的条目")
    if (args.expect_base is None) != (args.expect_patch is None):
        raise ReviewError("--expect-base 与 --expect-patch 要一起给")
    if args.expect_patch is not None and args.group:
        raise ReviewError("--expect-patch 不与 --group 同用：重跑一组时用 --path 给这组的文件夹或文件")
    groups = [[m.strip() for m in g.split(",") if m.strip()] for g in args.group or []]
    if any(not g for g in groups):
        raise ReviewError("--group 不能是空的")
    try:
        pick = json.loads(args.pick) if args.pick is not None else None
    except ValueError as e:
        raise ReviewError(f"--pick 要原样给 pick 输出的那个 JSON 对象：{e}") from e
    if pick is not None:
        _check_pick(pick)
    root = repo_root()
    task = Path(args.task).resolve() if args.task else None
    if task is not None and not task.is_dir():
        raise ReviewError(f"找不到任务目录：{args.task}")
    intent = Path(args.intent_file).read_text(encoding="utf-8") if args.intent_file else None
    picked = Path(args.picked_file).read_text(encoding="utf-8") if args.picked_file else None
    if intent is None and (task is None or not (task / "prd.md").is_file()):
        raise ReviewError("没有任务的 prd.md 时，要用 --intent-file 交一段意图")

    paths = args.path or []
    if args.recheck:
        if not _ref_exists(root, args.recheck):
            raise ReviewError(f"认不出上次的快照 {args.recheck}（复查报告里写的快照编号）")
        last = _git(root, ["rev-parse", f"{args.recheck}^{{commit}}"]).strip()
        start = {"base": args.recheck, "baseFrom": "snapshot", "onBase": False, "baseCommit": last}
        # 上次只看了某些文件夹或文件时，复核也只看那里
        paths = paths or snapshot_paths(root, last)
    else:
        start = resolve_start(root, args.since, task)
    # 先存快照再从它冻结：补丁就是快照里看到的样子
    snap = snapshot_commit(root, paths)
    frozen = freeze(root, start["baseCommit"], snap, paths)
    whole = summarize(frozen["pieces"], frozen["lines"], frozen["pathOnly"])
    scope = {**start, "paths": paths, "lineLimit": LINE_LIMIT}

    personal = codex_personal_instructions()
    for r in reviewers:
        r["personalInstructions"] = personal if r["tool"] == "codex" else None

    out = {
        **scope,
        **{k: v for k, v in whole.items() if k not in ("patchText", "linesByFile")},
        "skippedSecretLike": frozen["skippedSecretLike"],
        "reviewers": reviewers,
        "stop": None,
        # 重试或换人：与第一次的起点提交、补丁是否相同；不是重跑时为 None
        "sameAsBefore": None if args.expect_patch is None else {
            "baseCommit": start["baseCommit"] == args.expect_base,
            "patch": whole["patchHash"] == args.expect_patch,
        },
    }
    if not whole["files"] and not whole["pathOnly"]:
        # 复核时上次之后没有改动：不重跑（prd O 节），与第一次就没有改动分开
        return {**out, "stop": "no-changes-since-snapshot" if args.recheck else "no-changes"}
    if not groups and whole["totalLines"] > LINE_LIMIT and not args.whole:
        return {**out, "stop": "over-limit", "suggestedGroups": suggest_groups(whole["linesByFolder"], whole["pathOnly"])}

    questions = questions_path.read_text(encoding="utf-8")
    # 先分好再写：有一组不对就什么都不冻结
    parts = _split(frozen, groups) if groups else []
    # 「上次查到哪」：复核时以它为起点（prd O 节）；分组时各组共用一个
    keep_snapshot(root, snap)
    out["snapshot"] = scope["snapshot"] = snap
    made: list[Path] = []
    try:
        if not groups:
            out = {**out, **_write_frozen(root, whole, scope, None, questions, task, intent, reviewers, picked, made)}
        else:
            out["groups"] = [
                {"paths": members, **_write_frozen(
                    root, part, scope, (i + 1, len(parts), members), questions, task, intent, reviewers, picked, made
                )}
                for i, (members, part) in enumerate(zip(groups, parts))
            ]
        return {**out, "notice": build_notice(out, pick)}
    except (OSError, ReviewError) as e:
        # 退出 2 说什么都没冻结：快照引用与写了一半的编号目录一并撤掉
        _git(root, ["update-ref", "-d", SNAPSHOT_REF_PREFIX + snap], ok_codes=(0, 1))
        for d in made:
            shutil.rmtree(d, ignore_errors=True)
        raise ReviewError(f"写不了这次复查的材料：{e}") from e


# ---------------------------------------------------------------------------
# 日志复查（decision-log-afk 工单 09，prd K 节）：材料是决定日志与聊天记录，不冻结补丁
# ---------------------------------------------------------------------------

LOG_NAME = "decision-log.md"
# 聊天材料里每条命令结果留的开头结尾行数：平时 20，材料太长重试时 5（prd O 节）
RESULT_LINES = 20
SHORT_RESULT_LINES = 5
# atw mem extract --context 认得出的编号前缀（与 core mem 的 CONTEXT_PREFIX_PLATFORMS 一致）
MEM_CONTEXT_PREFIXES = ("claude", "codex", "grok", "omp", "opencode", "pi", "session")
# ATW 自己算出的对话编号都以平台名（或认不出平台时的 session）加 `_` 开头；不带这种前缀的
# 多半是 ATW_CONTEXT_ID 手动覆盖的原样值（resolve_context_key 只把它净化，不加前缀）
ATW_CONTEXT_PREFIXES = frozenset(KNOWN_PLATFORMS) | frozenset(MEM_CONTEXT_PREFIXES)
_MEM_NOT_FOUND = "no session matches ATW context id"
# prepare-log 只写 --session 不带值时的占位：换成这次对话的编号
CURRENT_SESSION = object()


def _log_runs(rows: list[Row], scope: str, session: str | None) -> list[dict]:
    """这次要看的运行：默认最近一次（最后一条 start 行那个对话写的行），--whole 时每个对话一段，
    --session 时只取那个对话的（调用方先确认它在日志里有 start 行）。

    一段归哪个对话照 decision_log 的 owners：被别的对话插写后重写的 start 也算同一个对话。
    """
    owner = owners(rows)
    starts = [i for i, r in enumerate(rows) if r.phase == START_PHASE]
    if scope == "session":
        sessions = [session]
    elif scope == "whole":
        sessions = list(dict.fromkeys(rows[i].evidence for i in starts))
    else:
        sessions = [rows[starts[-1]].evidence]
    runs = []
    for s in sessions:
        mine = [r for r, o in zip(rows, owner) if o == s]
        runs.append({"session": s, "start": mine[0].raw_time, "end": mine[-1].raw_time, "rows": mine})
    return runs


def _context_from_override(session: str) -> bool:
    """这个编号是不是这条命令的 `ATW_CONTEXT_ID` 手动覆盖算出来的（与 resolve_context_key 同算法）。"""
    override = (os.environ.get("ATW_CONTEXT_ID") or "").strip()
    if not override:
        return False
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", override).strip("._-")[:160]
    return session == (safe or hashlib.sha256(override.encode("utf-8")).hexdigest()[:24])


def _chat_problem(session: str, start: str, error: str | None, code: int | None) -> dict:
    """找不到这次对话时照实给原因，不猜、不拿别的对话充数（工单 03 评论：手动覆盖的原样值对不上会话）。"""
    if session in {spec.no_session for spec in LOG_LANGS.values()}:
        reason = "no-session-id"
    elif _context_from_override(session) or "_" not in session or session.partition("_")[0] not in ATW_CONTEXT_PREFIXES:
        reason = "manual-override"
    elif session.partition("_")[0] not in MEM_CONTEXT_PREFIXES:
        # ATW 认得的平台，但 atw mem 读不了它的会话（prd P 节）
        reason = "unreadable-id"
    elif code == 2 and error and _MEM_NOT_FOUND in error:
        reason = "not-found"
    elif code == 2 and error and "matches" in error and "sessions" in error:
        reason = "ambiguous"
    else:
        reason = "mem-failed"
    return {"session": session, "start": start, "reason": reason, "error": error}


# atw mem 的另两处截短（core mem/internal/tool-text.ts 的 clipValue、adapters/pi.ts 的 firstLine）：
# 参数摘要里每个值只留首行前 200 个字，换路标记引的那行话只留前 80 个字（都按 UTF-16 单位数）
ARG_VALUE_MAX = 200
SWITCH_QUOTE_MAX = 80


def _extract_chat(atw: str, root: Path, session: str, start: str) -> tuple[dict | None, int, str]:
    """`atw mem extract --context <编号> --tools --after <start 行时间> --uncut --json`：返回（JSON，退出码，报错）。"""
    proc = subprocess.run(
        [atw, "mem", "extract", "--context", session, "--tools", "--after", start, "--uncut", "--json"],
        cwd=root,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    err = proc.stderr.strip()[-2000:]
    if proc.returncode != 0:
        return None, proc.returncode, err
    try:
        data = json.loads(proc.stdout)
    except ValueError as e:
        return None, proc.returncode, f"atw mem 的输出不是 JSON：{e}"
    if not isinstance(data, dict) or not isinstance(data.get("items"), list):
        return None, proc.returncode, "atw mem 的 JSON 输出里没有 items"
    # 换路引话要先对整段原话打码；旧版 atw 不给 quoteWhole，只打码首行会漏私钥，当读不了
    if any(isinstance(i, dict) and i.get("kind") == "branch_switch" and i.get("quote") and "quoteWhole" not in i
           for i in data["items"]):
        return None, proc.returncode, "atw 版本太旧：换路标记没有 quoteWhole（被引条目的整段原话），无法先整段打码"
    return data, proc.returncode, err


def _js_units(text: str) -> bytes:
    return text.encode("utf-16-le", "surrogatepass")


def _js_slice(text: str, n: int) -> str:
    """JS 的 `text.slice(0, n)`：按 UTF-16 单位取；切开的代理对与 Node 输出时一样成 U+FFFD。"""
    return _js_units(text)[:2 * n].decode("utf-16-le", "replace")


def _clip_value(value: str) -> str:
    """与 atw mem 的 clipValue 一致：多行或首行超过 200 个字时只留首行前 200 个字，写明少了几个字。"""
    first = value.split("\n", 1)[0]
    if len(_js_units(first)) <= 2 * ARG_VALUE_MAX and first == value:
        return value
    kept = _js_slice(first, ARG_VALUE_MAX)
    return f"{kept} …(+{(len(_js_units(value)) - len(_js_units(kept))) // 2} chars)"


def _clip_quote(whole: str) -> str:
    """与 atw mem 的 firstLine 一致：取（已整段打码的）原话首行，超过 80 个字时留前 80 个字加「…」。"""
    line = whole.split("\n", 1)[0]
    return f"{_js_slice(line, SWITCH_QUOTE_MAX)}…" if len(_js_units(line)) > 2 * SWITCH_QUOTE_MAX else line


def _head_tail(text: str, n: int) -> str:
    """与 atw mem（core mem/timeline.ts 的 headTail）一致：留开头、结尾各 n 行，中间写明省略了多少行。"""
    lines = text.rstrip("\n").split("\n")
    if len(lines) <= 2 * n:
        return text
    omitted = len(lines) - 2 * n
    return "\n".join([*lines[:n], f"[... {omitted} lines omitted ...]", *lines[len(lines) - n:]])


def _render_timeline(data: dict, result_lines: int, types: list[str]) -> str:
    """照 `atw mem extract --tools` 的文字输出（cli commands/mem.ts 的 printTimeline）渲染：

    每条先整段打码（记号，见 `_mark_secrets`），再照 atw mem 截短——参数值、换路引的话、命令输入与结果的
    首尾行——省略的行数、字数按打码后的文字算。
    """
    def mark(value: object) -> str:
        return _mark_secrets(str(value), types)

    s = data.get("session") or {}
    out = [f"# session: [{s.get('platform')}] {s.get('id')}"]
    if s.get("title"):
        out.append(f"# title: {s['title']}")
    if s.get("cwd"):
        out.append(f"# cwd:   {str(s['cwd']).replace(str(Path.home()), '~', 1)}")
    if s.get("created"):
        out.append(f"# date:  {str(s['created'])[:16].replace('T', ' ', 1)}")
    items = data["items"]
    out.append(f"# reading: tools  result-lines: {result_lines}"
               + (f"  after: {data['after']}" if data.get("after") else "")
               + f"  items: {len(items)}")
    out = [mark(line) for line in out] + [""]
    for item in items:
        kind = item.get("kind")
        at = f"  ({item['timestamp']})" if item.get("timestamp") else ""
        call_id = f" [{item['callId']}]" if kind in ("tool_call", "tool_result") and item.get("callId") else ""
        if kind == "text":
            head, body = f"## {'Human' if item.get('role') == 'user' else 'Assistant'}{at}", mark(item.get("text", ""))
        elif kind == "marker":
            head, body = f"## Marker{at}", mark(item.get("text", ""))
        elif kind == "branch_switch":
            text, quote = item.get("text", ""), item.get("quote")
            at_quote = text.rfind(quote) if quote else -1
            if at_quote < 0:
                body = mark(text)
            else:
                # 引的那行换成整段原话打码后的首行：私钥 BEGIN 与正文在首行、END 在后面时也遮得住
                body = (mark(text[:at_quote]) + _clip_quote(mark(item["quoteWhole"]))
                        + mark(text[at_quote + len(quote):]))
            head = f"## Branch switch{at}"
            if item.get("summary"):
                body += f"\n\nBranch summary:\n{mark(item['summary'])}"
        elif kind == "tool_call":
            head = f"## Tool call: {item.get('name')}{call_id}{at}"
            if isinstance(item.get("args"), list):
                # 参数摘要：每行 `名字: 值` 整行打码（名字能帮着认出密钥），再截值
                lines = []
                for a in item["args"]:
                    prefix = f"{a['name']}: "
                    marked = mark(prefix + a["value"])
                    lines.append(prefix + _clip_value(marked[len(prefix):]) if marked.startswith(prefix)
                                 else _clip_value(marked))
                body = _head_tail("\n".join(lines), result_lines)
            else:
                body = _head_tail(mark(item.get("input", "")), result_lines)
        elif kind == "tool_result":
            head = (f"## Tool result: {item.get('name') or '(unknown call)'}{call_id}"
                    f"{' (error)' if item.get('isError') else ''}{at}")
            body = _head_tail(mark(item.get("output", "")), result_lines)
        elif kind == "hook_message":
            head, body = f"## Hook message: {item.get('hook')}{at}", mark(item.get("text", ""))
        else:
            # 认不出的种类：atw mem 文字输出里也不显示它的内容，只留分隔线
            out += ["", "---", ""]
            continue
        out += [mark(head), "", body, "", "---", ""]
    return "\n".join(out) + "\n"


def _chat_texts(atw: str, root: Path, runs: list[dict], problems: list[dict]) -> tuple[str, str, list[str]]:
    """每次运行的聊天记录只读一次，出完整版（各 20 行）与短版（各 5 行）；打码记号的类型在第三项。"""
    types: list[str] = []
    full, short = [], []
    for i, run in enumerate(runs, 1):
        data, code, err = None, None, None
        if run["session"] not in {spec.no_session for spec in LOG_LANGS.values()}:
            data, code, err = _extract_chat(atw, root, run["session"], run["start"])
        if data is None:
            problems.append(_chat_problem(run["session"], run["start"], err, code))
            continue
        head = f"===== Run {i}: session {run['session']}, from {run['start']} =====\n\n"
        full.append(head + _render_timeline(data, RESULT_LINES, types).strip() + "\n")
        short.append(head + _render_timeline(data, SHORT_RESULT_LINES, types).strip() + "\n")
    return "\n".join(full), "\n".join(short), types


def _log_text(lang: str, rows: list[Row]) -> str:
    spec = LOG_LANGS[lang]
    lines = [spec.title, "", format_row(list(spec.header)), format_row(["---"] * 6)]
    lines += [format_row([r.raw_time, r.phase, r.decision, r.why, r.evidence, r.result]) for r in rows]
    return "\n".join(lines) + "\n"


def build_log_prompt(questions: str, out: dict, chat_rel: str, result_lines: int) -> str:
    runs = out["runs"]
    if out["scope"] == "whole":
        what = f"the whole log, {out['rows']} rows written over {len(runs)} runs (each run starts at its `start` row)."
        chat = "The chat of each run, one section per run"
    else:
        r = runs[0]
        what = f"the rows one run wrote, from its start row at `{r['start']}` to `{r['end']}` ({r['rows']} rows)."
        chat = "The chat of that run"
    m = [
        "## Material",
        "",
        "Everything listed here is on disk under the working directory. Read it with your"
        " read-only tools. Every reviewer in this round gets exactly the same material.",
        "",
        f"- The decision log under review: `{out['files']['log']}` — {what}",
        f"- {chat}: `{chat_rel}` — what the user and the AI said from that run's start row on, each tool"
        f" call with its name and command, the first and last {result_lines} lines of each result"
        " (the lines in between are counted, not shown), and each message a hook showed the user (on Claude"
        " Code, the start notice and the notice before a log review come this way). The AI's thinking is not"
        " in it.",
        "- Anything that looked like a secret was replaced with a placeholder such as `[已打码：私钥]`"
        " before this material was written.",
        "- The evidence column points at commits, `file:line`, reports, tickets and list items. To see"
        " whether a row's evidence opens and says what the row claims, you may read any file in the"
        " repository, this task's directory included. You may not change anything.",
    ]
    return questions.rstrip() + "\n\n---\n\n" + "\n".join(m) + "\n"


def _log_scope_clause(out: dict, en: bool) -> str:
    runs, k = out["runs"], out["redactedCount"]
    lines = out["resultLines"]
    if out["scope"] == "whole":
        s = (f"This log review reads the whole decision log ({out['rows']} rows, {len(runs)} runs) and the chat of"
             f" every run, each command's result cut to its first and last {lines} lines." if en else
             f"这次日志复查看整份决定日志（{out['rows']} 行，{len(runs)} 次运行）和各次运行的聊天记录，"
             f"每条命令的结果只留开头结尾各 {lines} 行。")
    elif out["scope"] == "session":
        r = runs[0]
        s = (f"This log review reads the rows the run of conversation `{r['session']}` wrote in the decision log"
             f" ({r['start']} to {r['end']}, {r['rows']} rows) and that run's chat (from {r['start']}),"
             f" each command's result cut to its first and last {lines} lines." if en else
             f"这次日志复查看决定日志里对话 `{r['session']}` 那次运行写的那一段（{r['start']} 至 {r['end']}，{r['rows']} 行）"
             f"和那次运行的聊天记录（从 {r['start']} 起），每条命令的结果只留开头结尾各 {lines} 行。")
    else:
        r = runs[0]
        s = (f"This log review reads the rows the most recent run wrote in the decision log ({r['start']} to"
             f" {r['end']}, {r['rows']} rows) and that run's chat (session `{r['session']}`, from {r['start']}),"
             f" each command's result cut to its first and last {lines} lines." if en else
             f"这次日志复查看决定日志里最近一次运行写的那一段（{r['start']} 至 {r['end']}，{r['rows']} 行）"
             f"和那次运行的聊天记录（对话 `{r['session']}`，从 {r['start']} 起），每条命令的结果只留开头结尾各 {lines} 行。")
    s += ((f" Secrets were redacted before sending: {k} place{'' if k == 1 else 's'}." if k else
           " Checked for secrets before sending; none found.") if en else
          (f"发出前先打码，打了 {k} 处。" if k else "发出前查过要打码的，没有。"))
    s += (" A reviewer that fails is retried automatically by the cause of the failure, at most twice." if en else
          "没跑成的按失败原因自动重试，每个复查员最多两次。")
    return s


READS_LOG = (
    "复查员可以只读地翻看仓库里的文件来核对证据，每个复查员最多 30 分钟（所有重试合计）。",
    "Reviewers may read files in the repository, read-only, to check the evidence, and each gets at most 30 minutes,"
    " all its retries included.",
)


def cmd_prepare_log(args: argparse.Namespace) -> dict:
    reviewers = [parse_reviewer(s) for s in args.reviewer]
    questions_path = Path(args.questions)
    if not questions_path.is_file():
        raise ReviewError(f"找不到题目文件：{questions_path}")
    try:
        pick = json.loads(args.pick) if args.pick is not None else None
    except ValueError as e:
        raise ReviewError(f"--pick 要原样给 pick 输出的那个 JSON 对象：{e}") from e
    if pick is not None:
        _check_pick(pick)
    root = repo_root()
    task = Path(args.task).resolve()
    if not task.is_dir():
        raise ReviewError(f"找不到任务目录：{args.task}")
    log_path = task / LOG_NAME
    try:
        existing = read_log(log_path)
    except LogError as e:
        raise ReviewError(str(e)) from e
    named = args.session is not None
    # 不带值的 --session 是这次对话：与 decision_log.py 自查的 run 同一个对话标识
    session = (resolve_context_key() if args.session is CURRENT_SESSION else args.session) if named else None
    scope = "whole" if args.whole else "session" if named else "last-run"
    out: dict = {"kind": "log-review", "stop": None, "scope": scope, "log": _rel(root, log_path), "chatProblems": []}
    if named:
        out["session"] = session
    if existing is None or not any(r.phase == START_PHASE for r in existing[1]):
        return {**out, "stop": "no-log"}
    lang, rows = existing
    if named and (session is None or session not in owners(rows)):
        # prd D 节：指定的对话在日志里没有运行就停下，不改看别的对话
        return {**out, "stop": "no-run"}
    runs = _log_runs(rows, scope, session)
    sent_rows = rows if scope == "whole" else runs[0]["rows"]
    out["runs"] = [{k: (len(v) if k == "rows" else v) for k, v in run.items()} for run in runs]
    out["rows"] = len(sent_rows)

    atw = shutil.which("atw")
    if atw is None:
        raise ReviewError("找不到 atw 命令（PATH 里没有）：读不了聊天记录")
    problems: list[dict] = []
    chat, chat_short, types = _chat_texts(atw, root, runs, problems)
    if problems:
        # prd P 节：读不了这次的聊天记录就不做，不拿别的对话充数
        return {**out, "stop": "chat-not-found", "chatProblems": problems}

    log_text, found_log = redact(_log_text(lang, sent_rows))
    # 打码处数与位置照完整版材料算（prd F 节）
    chat_text, found_chat = _place_marks(chat, types)
    chat_short_text, _ = _place_marks(chat_short, types)
    questions = questions_path.read_text(encoding="utf-8")
    personal = codex_personal_instructions()
    for r in reviewers:
        r["personalInstructions"] = personal if r["tool"] == "codex" else None

    review_id = time.strftime("%Y%m%d-%H%M%S") + "-" + secrets.token_hex(2)
    rel_dir = RUNTIME_SUBDIR / review_id
    out_dir = root / rel_dir
    files = {k: (rel_dir / name).as_posix() for k, name in
             (("log", "log.md"), ("chat", "chat.md"), ("chatShort", "chat-short.md"))}
    out.update({
        "id": review_id,
        "dir": rel_dir.as_posix(),
        "prompt": (rel_dir / "prompt.md").as_posix(),
        "files": files,
        "resultLines": RESULT_LINES,
        "shortResultLines": SHORT_RESULT_LINES,
        "redactedCount": len(found_log) + len(found_chat),
        "redactions": [{"file": "log", **x} for x in found_log] + [{"file": "chat", **x} for x in found_chat],
        "reviewers": reviewers,
    })
    prompt_short = (rel_dir / "prompt-short.md").as_posix()
    try:
        out_dir.mkdir(parents=True)
        for key, text in (("log", log_text), ("chat", chat_text), ("chatShort", chat_short_text)):
            (root / files[key]).write_text(text, encoding="utf-8")
        (root / out["prompt"]).write_text(
            build_log_prompt(questions, out, files["chat"], RESULT_LINES), encoding="utf-8")
        (root / prompt_short).write_text(
            build_log_prompt(questions, out, files["chatShort"], SHORT_RESULT_LINES), encoding="utf-8")
        manifest = {"kind": "log-review", "id": review_id, "prompt": out["prompt"], "promptShort": prompt_short,
                    "reviewers": reviewers}
        (out_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
    except OSError as e:
        shutil.rmtree(out_dir, ignore_errors=True)
        raise ReviewError(f"写不了这次日志复查的材料：{e}") from e
    return {**out, "notice": build_notice(out, pick, _log_scope_clause, READS_LOG)}


def cmd_afk_notice(args: argparse.Namespace) -> dict:
    """两个连做 skill `--afk` 开跑时：照收尾那样只看设置挑人，另给写好的开跑提醒。"""
    if args.max is not None and args.skill != "atw-implement-all":
        raise ReviewError("--max 只属于 atw-implement-all")
    if not Path(args.task).is_dir():
        raise ReviewError(f"找不到任务目录：{args.task}")
    out = cmd_pick(args)
    return {**out, "notice": build_afk_notice(out, args.skill, args.branch, args.new_branch, args.max, args.task)}


def _channel_args(atw: str, root: Path, channel: str, prompt: str, r: dict, timeout: str) -> list[str]:
    cmd = [
        atw, "channel", "run", channel,
        "--provider", r["tool"],
        "--as", "reviewer",
        "--cwd", str(root),
        "--model", r["model"],
    ]
    if r.get("effort"):
        cmd += ["--effort", r["effort"]]
    cmd += [
        "--read-only", "--clean", "--no-session", "--standard-speed",
        "--timeout", timeout,
        "--message-file", prompt,
        "--json",
    ]
    return cmd


def _parse_run_result(stdout: str, stderr: str) -> tuple[dict, bool]:
    """channel 交回的结果对象，与它是不是 channel 真交回的（没交回时这里补一个 not-started，为 False）。"""
    for line in reversed(stdout.splitlines()):
        if line.strip():
            try:
                parsed = json.loads(line)
            except ValueError:
                break
            if isinstance(parsed, dict):
                return parsed, True
            break
    return {
        "status": "not-started",
        "text": None,
        "partial": False,
        "durationMs": 0,
        "costUsd": None,
        "costUnreported": True,
        "usage": None,
        "model": None,
        "instructionSources": None,
        "error": stderr.strip()[-2000:] or "atw channel run 没有交出结果对象",
        "errorKind": None,
        "errorStatus": None,
        "errorSubkind": None,
    }, False


# channel 里 supervisor 报起不来、握手失败的报错开头：这时题目还没发给工具
NOTHING_SENT_ERRORS = ("worker spawn failed: ", "handshake failed: ")
# 要先握手、握手做完才收题目的工具：Codex 的 app-server 要等 `thread/start` 回了线程 id 才收题目，
# 而那条回复必带 `model`（协议 `ThreadStartResponse` 的必填字段），channel 把它交在结果对象的 `model` 里。
# 所以 channel 真交回了结果对象、`not-started` 且 `model` 为空时，握手没做完，题目没发出（如登录失效时握手前就退出）。
# channel 没交回结果对象（被杀、崩了）或交回的带了 `model`（题目发出后才出的别的异常）都说不准。
# Claude 没有握手，进程一起来就收题目；pi、omp 的握手回复不一定带模型名，这三种说不准。
HANDSHAKE_BEFORE_PROMPT = ("codex",)
# commander 解析参数出错时的报错开头（如 `error: unknown option '--read-only'`）：这时 channel 还没做任何事，
# 标准输出也没有结果对象；多半是 PATH 里的 atw 与项目的 ATW 版本不一致
ARGS_REFUSED_ERROR = "error: "


def _args_refused(stdout: str, stderr: str) -> bool:
    """`atw channel run` 在解析参数时就退出：没交结果对象，报错是 commander 的开头。"""
    return not stdout.strip() and stderr.lstrip().startswith(ARGS_REFUSED_ERROR)


def _spent(result: dict, sent: str) -> str:
    """是否已花钱：工具报了正数花费或用量为 yes，报了 0 或确定题目没发出为 no，报不出为 unreported。"""
    cost = result.get("costUsd")
    if isinstance(cost, (int, float)) and cost > 0:
        return "yes"
    usage = result.get("usage")
    if isinstance(usage, dict) and any(isinstance(v, (int, float)) and v > 0 for v in usage.values()):
        return "yes"
    if sent == "no":
        return "no"
    if isinstance(cost, (int, float)) and not result.get("costUnreported"):
        return "no"
    return "unreported"


NOT_READ_HEADING = re.compile(r"^#{1,6}[ \t]*not read[ \t]*$", re.IGNORECASE | re.MULTILINE)
NOTHING_LEFT = {"none", "nothing", "n/a", "无", "没有"}
# 「None」后面跟括注、破折号、冒号或标点再加一句说明，如 `None（均已完整读取）。`、`None — I read every file in full.`
NOTHING_LEFT_WITH_NOTE = re.compile(
    r"(?:none|nothing|n/a|无|没有)[*_`]*\s*[(（—–\-:：,，;；.。](?P<note>.*)", re.IGNORECASE
)
# 说明里点了路径或写了例外、只看一部分，就不算全看完（如 `None, except src/a.py`、`没有，a.py 只看了一半`）
NOTE_NAMES_PATH = re.compile(r"/|\b[\w-]+\.[A-Za-z0-9]{1,6}\b")
NOTE_EXCEPTION = re.compile(
    r"\b(?:except|but|besides|apart from|other than|only|partial(?:ly)?|half|skip(?:ped)?)\b"
    r"|除|只看|没看|未看|一半|跳过|部分",
    re.IGNORECASE,
)


def _entry_file(line: str, names: set[str]) -> tuple[str | None, bool]:
    """一行没看的：开头是补丁里的路径（可带反引号、`a/` `b/` 前缀），后面可跟说明。返回（文件，是否只是一部分）。"""
    head, _, note = line.partition(" ")
    path = head.strip("`*_").rstrip(":,;")
    for cand in (path, path[2:] if path[:2] in ("a/", "b/") else None):
        if cand in names:
            return cand, bool(note.strip(" -—–:()`"))
    return None, False


def _not_read_section(text: str | None) -> str | None:
    """答案末尾 `## Not read` 一节的正文；没写这一节为 None。"""
    heads = list(NOT_READ_HEADING.finditer(text or ""))
    if not heads:
        return None
    rest = (text or "")[heads[-1].end():]
    nxt = re.search(r"^#", rest, re.MULTILINE)
    return (rest[: nxt.start()] if nxt else rest).strip()


def _not_read_entries(section: str) -> list[str]:
    """一节里的各条：去掉列表记号，空行不算。"""
    lines = (re.sub(r"^\s*(?:[-*+]|\d+[.)])\s+", "", raw).strip() for raw in section.splitlines())
    return [line for line in lines if line]


def not_read(text: str | None, manifest: dict) -> dict | None:
    """复查员答案末尾 `## Not read` 一节：没写这一节为 None。

    一行一个补丁里的文件；认不出的行进 `unmatched`，这时没看的大小不明，`lines` 为 None（不是 0）。
    只没看一部分的文件（路径后面有说明）按整个文件算，`linesAtMost` 为真。
    """
    section = _not_read_section(text)
    if section is None:
        return None
    out: dict = {"text": section, "files": [], "partFiles": [], "unmatched": [], "lines": 0,
                 "linesAtMost": False, "suggestedGroups": None}
    if _says_nothing(section):
        return out
    by_file: dict[str, int] = manifest.get("linesByFile", {})
    names = set(by_file) | {x["path"] for x in manifest.get("pathOnly", [])}
    for line in _not_read_entries(section):
        f, part = _entry_file(line, names)
        if f is None:
            out["unmatched"].append(line)
            continue
        if f not in out["files"]:
            out["files"].append(f)
        if part and f not in out["partFiles"]:
            out["partFiles"].append(f)
    out["linesAtMost"] = bool(out["partFiles"])
    if out["unmatched"]:
        out["lines"] = None
        return out
    by_folder: dict[str, int] = {}
    for f in out["files"]:
        folder = posixpath.dirname(f) or "."
        by_folder[folder] = by_folder.get(folder, 0) + by_file.get(f, 0)
    out["lines"] = sum(by_folder.values())
    if out["lines"] > LINE_LIMIT:
        out["suggestedGroups"] = suggest_groups(by_folder, [])
    return out


def log_not_read(text: str | None) -> dict | None:
    """日志复查的 `## Not read`：没有补丁可对，各条（按时间点的行、聊天时间段）原样收进 `parts`。

    写「无」/`None` 算全看了，`parts` 为空；没写这一节、或标题下面空着，都算没说，为 None。
    """
    section = _not_read_section(text)
    if not section:
        return None
    return {"text": section, "parts": [] if _says_nothing(section) else _not_read_entries(section)}


def _outcome(result: dict, unread: dict | None, args_refused: bool = False, handshake_unfinished: bool = False) -> dict:
    """卡在哪一步、代码是否已发出、是否已花钱。"""
    status = result.get("status")
    if status == "done":
        # 写了没看的部分（认不出是哪些文件也算）就是跑完但没看完
        stage = "unread" if unread is not None and not _says_nothing(unread["text"]) else None
        sent = "yes"
    elif status == "not-started":
        # channel 拒了参数、起不来、握手失败，或 Codex 握手没做完，才确定题目没发出；
        # 其余工具一句话没说就退出的（例如收到题目后才拒）说不准
        stage = "not-started"
        nothing_sent = (
            args_refused
            or (result.get("error") or "").startswith(NOTHING_SENT_ERRORS)
            or handshake_unfinished
        )
        sent = "no" if nothing_sent else "maybe"
    else:
        # 超时或中途出错：题目已到模型手里，读没读补丁说不准
        stage, sent = "partway", "maybe"
    out = {"stage": stage, "codeSent": sent, "spent": _spent(result, sent), "notRead": unread}
    if status == "not-started" and args_refused:
        # 只在 channel 解析参数就退出时出现：多半是 PATH 里的 atw 与项目的 ATW 版本不一致
        out["argsRefused"] = True
    return out


def _says_nothing(section: str) -> bool:
    s = section.strip("*_-`. \n")
    if s.lower() in NOTHING_LEFT:
        return True
    m = NOTHING_LEFT_WITH_NOTE.match(s) if "\n" not in s else None
    return m is not None and not NOTE_NAMES_PATH.search(m["note"]) and not NOTE_EXCEPTION.search(m["note"])


def review_timeout() -> str:
    """复查时限 30 分钟；`ATW_REVIEW_TIMEOUT` 只给测试缩短用（`<N>s` 或 `<N>m`，不超过 30 分钟）。"""
    return f"{review_budget_s()}s" if os.environ.get("ATW_REVIEW_TIMEOUT") else f"{REVIEW_TIMEOUT_S // 60}m"


def review_budget_s() -> int:
    """时限的秒数（日志复查重试时按它算剩下的时间）。"""
    raw = os.environ.get("ATW_REVIEW_TIMEOUT")
    if not raw:
        return REVIEW_TIMEOUT_S
    m = re.fullmatch(r"(\d+)(s|m)", raw.strip())
    seconds = int(m.group(1)) * (60 if m.group(2) == "m" else 1) if m else 0
    if not 0 < seconds <= REVIEW_TIMEOUT_S:
        raise ReviewError(f"ATW_REVIEW_TIMEOUT「{raw}」不对：只能缩短时限，写 <N>s 或 <N>m，不超过 30m")
    return seconds


# 日志复查按失败原因自动重试（prd K 节）：先认工具自己报的出错种类（channel 结果的 `errorKind`，原样），
# 没有种类、或种类不在下表时才按报错文字归类（FAILURE_PATTERNS），认不出的算「原因看不出」。
# Claude 的取值是 Agent SDK 的 `SDKAssistantMessageError`（0.3.276）；Codex 的是 app-server v2 的 `codexErrorInfo`
# （codex-cli 0.163.0 `codex app-server generate-json-schema` 导出的 `CodexErrorInfo`）。
# `invalid_request`、`max_output_tokens`、`unknown`、`badRequest`、`other` 等说不清原因的不列，退回文字。
ERROR_KIND_REASONS: dict[str, str] = {
    # Claude
    "model_not_found": "model-unavailable",
    "authentication_failed": "not-logged-in",
    "oauth_org_not_allowed": "not-logged-in",
    "cloud_credential_error": "not-logged-in",
    "verification_required": "not-logged-in",
    "account_on_hold": "not-logged-in",
    "billing_error": "quota-exhausted",
    "rate_limit": "transient",
    "overloaded": "transient",
    "server_error": "transient",
    # Codex
    "unauthorized": "not-logged-in",
    "usageLimitExceeded": "quota-exhausted",
    "sessionBudgetExceeded": "quota-exhausted",
    "contextWindowExceeded": "too-long",
    "rateLimitExceeded": "transient",
    "serverOverloaded": "transient",
    "internalServerError": "transient",
    "httpConnectionFailed": "transient",
    "responseStreamConnectionFailed": "transient",
    "responseStreamDisconnected": "transient",
    "responseTooManyFailedAttempts": "transient",
}
# Claude 的 `rate_limit` 也用于包月额度用完，这时细分种类（`errorSubkind`，Claude 的 `api_error`）是下面两个之一。
# Claude 的 SDK 把 `api_error` 标为内部字段：改名后这里认不出，退回按 `rate_limit` 当一时出错重试
QUOTA_SUBKINDS = frozenset({"usage_limit_reached", "model_requires_usage_credits"})
FAILURE_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    # 只认启动复查员工具本身失败：报错里点名的是工具的可执行文件
    ("not-installed", re.compile(
        r"\b(?:claude|codex|pi|omp)\b[^\n]{0,40}(?:command not found|not installed|\bENOENT\b)"
        r"|(?:command not found|spawn)\b[^\n]{0,40}\b(?:claude|codex|pi|omp)\b", re.I)),
    ("not-logged-in", re.compile(
        r"not logged in|/login\b|log ?in required|unauthori[sz]ed|\b401\b|authentication|invalid api key"
        # pi 登录过期：OAuth 刷新被拒（工单 13 实测 `OAuth refresh failed … "invalid_grant"`）
        r"|invalid x-api-key|oauth refresh failed|invalid_grant", re.I)),
    ("quota-exhausted", re.compile(
        r"usage limit|quota|credit balance|out of credits|billing|plan limit|insufficient[_ ]quota", re.I)),
    ("model-unavailable", re.compile(
        r"model\b[^\n]{0,60}\b(?:not found|does not exist|not available|unavailable|not supported)"
        # Claude Code 2.1.302：「There's an issue with the selected model (…). It may not exist or you may not have access to it.」
        r"|selected model\b[^\n]{0,80}\bmay not exist"
        r"|unknown model|invalid model|no such model|model_not_found", re.I)),
    ("too-long", re.compile(
        r"too long|context[_ ]length|context window|maximum context|too many tokens|token limit"
        r"|request too large|input is too large|\b413\b", re.I)),
    ("transient", re.compile(
        r"\bE(?:CONNRESET|CONNREFUSED|TIMEDOUT|AI_AGAIN|NOTFOUND|PIPE)\b|socket hang up|network"
        r"|connection (?:error|reset|refused|closed|lost)|disconnected|fetch failed|overloaded"
        r"|rate[ _-]?limit|too many requests|\b429\b|internal server error|bad gateway"
        # 5xx 只在状态码的上下文里认，免得「500 行」之类被当成对方服务出错
        r"|\b(?:http|status(?: code)?|api error|error)\W{0,3}5\d\d\b|\b5\d\d (?:internal|bad gateway|service|gateway)"
        r"|service unavailable|gateway timeout|temporarily unavailable|try again later", re.I)),
    ("tool-error", re.compile(
        r"unknown (?:option|argument|flag)|unrecognized (?:option|argument)|unexpected argument"
        r"|invalid (?:argument|option|flag|value)|unsupported|\bversion\b|usage:", re.I)),
)
MAX_RETRIES = 2
# 一个复查员的全部尝试合计不超过时限；剩下不到时限的十分之一（至少 1 秒）就不再重试
MIN_RETRY_SHARE = 10


def classify_failure(result: dict, args_refused: bool) -> str | None:
    """跑成为 None；超时、channel 拒参数直接认；再按工具报的出错种类；最后按报错文字归类，认不出的为 unknown。"""
    status = result.get("status")
    if status == "done":
        return None
    if status == "timeout":
        return "timeout"
    if args_refused:
        return "tool-error"
    kind = result.get("errorKind")
    if kind == "rate_limit" and result.get("errorSubkind") in QUOTA_SUBKINDS:
        return "quota-exhausted"
    if isinstance(kind, str) and kind in ERROR_KIND_REASONS:
        return ERROR_KIND_REASONS[kind]
    text = result.get("error") or ""
    return next((reason for reason, pattern in FAILURE_PATTERNS if pattern.search(text)), "unknown")


def _retry_with(reason: str | None, attempts: list[dict], material: str) -> str | None:
    """下一次用哪份材料（full / short）；不再试时为 None。"""
    if len(attempts) > MAX_RETRIES:
        return None
    if reason == "transient":
        return material
    if reason == "too-long":
        # 已经是各 5 行的了：没有更短的可发
        return "short" if material == "full" else None
    if reason == "unknown" and not any(a["reason"] == "unknown" for a in attempts[:-1]):
        return material
    return None


def _merge(values: list[str], order: tuple[str, ...]) -> str:
    """几次尝试合起来：按 order 取最先出现的（例如有一次已发出就算已发出）。"""
    return next(v for v in order if v in values)


def _totals(attempts: list[dict]) -> dict:
    """各次尝试合计的用时与花费；有一次没报花费，costUnreported 为真（costUsd 只是报了的那几次之和）。"""
    costs = [a["costUsd"] for a in attempts if isinstance(a["costUsd"], (int, float))]
    return {
        "durationMs": sum(a["durationMs"] or 0 for a in attempts),
        "costUsd": sum(costs) if costs else None,
        "costUnreported": any(a["costUnreported"] or not isinstance(a["costUsd"], (int, float)) for a in attempts),
    }


def cmd_run(args: argparse.Namespace) -> dict:
    timeout = review_timeout()
    budget = review_budget_s()
    root = repo_root()
    out_dir = root / RUNTIME_SUBDIR / args.id
    manifest_path = out_dir / "manifest.json"
    if not manifest_path.is_file():
        raise ReviewError(f"找不到这次复查的材料：{_rel(root, out_dir)}（先跑 prepare）")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    log_review = manifest.get("kind") == "log-review"
    channels: list[str] = []
    channels_of: dict[int, list[str]] = {}
    atw = shutil.which("atw")
    started = time.monotonic()

    def remove_channel(ch: str) -> None:
        subprocess.run([atw or "atw", "channel", "rm", ch], cwd=root, capture_output=True, text=True)

    def attempt(i: int, r: dict, prompt: str, n: int, limit: str) -> tuple[dict, dict, bool]:
        """跑一次：第 n 次重试用自己的临时频道（`…-r<n>`）。返回结果对象、卡在哪一步等、channel 是否拒了参数。"""
        ch = f"xmr-{args.id}-{i + 1}" + (f"-r{n}" if n else "")
        channels.append(ch)
        channels_of.setdefault(i, []).append(ch)
        proc = subprocess.run(
            _channel_args(atw or "atw", root, ch, prompt, r, limit),
            cwd=root,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        res, returned = _parse_run_result(proc.stdout, proc.stderr)
        refused = _args_refused(proc.stdout, proc.stderr)
        handshake_unfinished = returned and r["tool"] in HANDSHAKE_BEFORE_PROMPT and not res.get("model")
        unread = log_not_read(res.get("text")) if log_review else not_read(res.get("text"), manifest)
        return res, _outcome(res, unread, refused, handshake_unfinished), refused

    def review(i: int, r: dict) -> dict:
        if not log_review:
            res, outcome, _ = attempt(i, r, manifest["prompt"], 0, timeout)
            return {**r, **outcome, "result": res}
        material, attempts, stopped_by = "full", [], None
        began = time.monotonic()
        limit = timeout
        while True:
            prompt = manifest["prompt"] if material == "full" else manifest["promptShort"]
            res, outcome, refused = attempt(i, r, prompt, len(attempts), limit)
            reason = classify_failure(res, refused)
            attempts.append({
                "material": material,
                "status": res.get("status"),
                "reason": reason,
                "error": res.get("error"),
                "durationMs": res.get("durationMs"),
                "costUsd": res.get("costUsd"),
                "costUnreported": bool(res.get("costUnreported")),
                "timeout": limit,
                "codeSent": outcome["codeSent"],
                "spent": outcome["spent"],
            })
            nxt = _retry_with(reason, attempts, material)
            if nxt is None:
                break
            # prd K 节：每个复查员最多 30 分钟，重试只用剩下的时间
            remaining = int(budget - (time.monotonic() - began))
            if remaining < max(1, budget // MIN_RETRY_SHARE):
                stopped_by = "time-limit"
                break
            # 没跑完的频道 channel 会留着、占着每个项目有限的在跑助手名额：重试前先删掉
            remove_channel(channels_of[i][-1])
            material, limit = nxt, f"{remaining}s"
        # 前几次可能已发出、已花钱：合起来算
        outcome["codeSent"] = _merge([a["codeSent"] for a in attempts], ("yes", "maybe", "no"))
        outcome["spent"] = _merge([a["spent"] for a in attempts], ("yes", "unreported", "no"))
        return {**r, **outcome, "result": res, "failureReason": reason, "retries": len(attempts) - 1,
                "retryStoppedBy": stopped_by, "attempts": attempts, "total": _totals(attempts)}

    try:
        if atw is None:
            raise ReviewError("找不到 atw 命令（PATH 里没有）")
        results: list[dict] = [{} for _ in manifest["reviewers"]]

        def collect(i: int, r: dict) -> None:
            results[i] = review(i, r)

        threads = [threading.Thread(target=collect, args=(i, r)) for i, r in enumerate(manifest["reviewers"])]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
    finally:
        # 跑完的频道 channel 自己删了；没跑完的被留着查看，这里一并删掉（原始报错已在结果里）
        if atw is not None:
            for ch in channels:
                remove_channel(ch)
        shutil.rmtree(out_dir, ignore_errors=True)
    if log_review:
        return {
            "id": args.id,
            "kind": "log-review",
            "durationMs": int((time.monotonic() - started) * 1000),
            "reviewers": results,
        }
    return {
        "id": args.id,
        # 重试或换人时交给 prepare 的 --expect-base / --expect-patch，核对材料没变
        "baseCommit": manifest["baseCommit"],
        "patchHash": manifest["patchHash"],
        # 复查报告里写上它，复核时交给 prepare --recheck
        "snapshot": manifest.get("snapshot"),
        "durationMs": int((time.monotonic() - started) * 1000),
        "reviewers": results,
    }


# 打码规则（prd N 节首批）：先认有固定样子的，再认赋给 api_key、secret、token、password 一类名字的长串
_PEM_BLOCK = (
    r"-----BEGIN[A-Z0-9 ]*PRIVATE KEY-----"
    # 有结尾标记就整块到结尾；半截回答没有结尾时，连同后面整行都像密钥内容的（可带补丁的 +、- 或引用的 >），
    # 到空行或别的文字为止，最后一行再短也算
    r"(?:.*?-----END[A-Z0-9 ]*PRIVATE KEY-----|(?:\n[ \t>+\-]*[A-Za-z0-9+/=]+(?=\n|\Z))*)"
)
SECRET_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("私钥", re.compile(_PEM_BLOCK, re.DOTALL)),
    ("JWT", re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}")),
    ("Anthropic 密钥", re.compile(r"\bsk-ant-[A-Za-z0-9_-]{20,}")),
    ("sk- 密钥", re.compile(r"\bsk-[A-Za-z0-9_-]{20,}")),
    ("GitHub 令牌", re.compile(r"\b(?:ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,})")),
    # xoxb-、xoxp-、xoxe-、xoxe.xoxp- 等，xox 开头的都算
    ("Slack 令牌", re.compile(r"\bxox[A-Za-z0-9.]*-[A-Za-z0-9-]{10,}")),
    ("AWS 访问密钥", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("Google API 密钥", re.compile(r"\bAIza[0-9A-Za-z_-]{35}")),
)
_NAMED_SECRET = re.compile(
    r"\b(?P<name>[A-Za-z0-9_.-]*?(?:api[_-]?key|secret|token|passw(?:or)?d)[A-Za-z0-9_]*)[\"']?"
    r"[ \t]*(?:=>|:=|:|=)[ \t]*"
    # 引号里的到引号为止，没引号的到空白或标点为止；后面紧跟 ( 的是函数调用
    r"(?:(?P<q>[\"'])(?P<quoted>[^\"'\s]{16,})(?P=q)|(?P<bare>[^\s\"'`,;()\[\]{}<>]{16,})(?![(\w]))",
    re.IGNORECASE,
)
# 赋值右边是代码而不是值的：点连起来的引用、网址、${…} 模板、全大写下划线常量名
_CODE_LIKE = re.compile(
    r"[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+"
    r"|[A-Za-z][A-Za-z0-9+.-]*://\S*"
    r"|\$\{?[\w.]+\}?"
    r"|[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+"
)
_HEADING = re.compile(r"^#{1,6}[ \t]+(.+?)[ \t#]*$")


def _named_secret_type(name: str) -> str:
    low = name.lower()
    if "passw" in low:
        return "密码"
    return "令牌" if "token" in low else "密钥"


def _secret_value(value: str) -> bool:
    """赋给密钥类名字的长串是不是值：要有字母，还要有数字或 -_. 以外的符号；像代码的不算。"""
    if _CODE_LIKE.fullmatch(value) or not re.search(r"[A-Za-z]", value):
        return False
    return bool(re.search(r"[0-9]|[^A-Za-z0-9_.\-]", value))


def redact(text: str, before: str = "") -> tuple[str, list[dict]]:
    """像密钥的内容整段换成「[已打码：<类型>]」；返回打码后的文字与每处的类型、行号、所在小节。

    值很短、像代码（`process.env.X`、`os.environ.API_KEY_V2`、网址、常量名）、只有字母或一串数字的不算，
    免得误伤普通变量。`before` 是接在它前面、已经打过码的文字（追加时的原报告）：行号与小节接着它算。
    """
    types: list[str] = []
    return _place_marks(_mark_secrets(text, types), types, before)


def _mark_secrets(text: str, types: list[str]) -> str:
    """打码第一步：每处像密钥的换成一行内的记号（类型追加进 `types`），由 `_place_marks` 换成占位。

    分两步是为日志复查材料：先整条打码、再截短，最后照截短后的材料算行号（prd F 节）。
    """

    def mark(kind: str) -> str:
        types.append(kind)
        return f"\x00{len(types) - 1}\x00"

    for kind, pattern in SECRET_PATTERNS:
        text = pattern.sub(lambda m, k=kind: mark(k), text)

    def named(m: re.Match[str]) -> str:
        part = "quoted" if m.group("quoted") is not None else "bare"
        if not _secret_value(m.group(part)):
            return m.group(0)
        start, end = m.start(part) - m.start(), m.end(part) - m.start()
        whole = m.group(0)
        return whole[:start] + mark(_named_secret_type(m.group("name"))) + whole[end:]

    return _NAMED_SECRET.sub(named, text)


def _place_marks(text: str, types: list[str], before: str = "") -> tuple[str, list[dict]]:
    """打码第二步：记号换成「[已打码：<类型>]」，记下每处的类型、行号、所在小节。"""
    found: list[dict] = []
    section = None
    in_fence = False
    prior = before.split("\n")[:-1]
    for line in prior:
        if line.lstrip().startswith(("```", "~~~")):
            in_fence = not in_fence
        heading = None if in_fence else _HEADING.match(line)
        if heading:
            section = heading.group(1)
    out_lines = []
    for number, line in enumerate(text.split("\n"), start=len(prior) + 1):
        marks = [types[int(i)] for i in re.findall(r"\x00(\d+)\x00", line)]
        line = re.sub(r"\x00(\d+)\x00", lambda m: f"[已打码：{types[int(m.group(1))]}]", line)
        if line.lstrip().startswith(("```", "~~~")):
            in_fence = not in_fence
        heading = None if in_fence else _HEADING.match(line)
        if heading:
            section = heading.group(1)
        found += [{"type": kind, "line": number, "section": section} for kind in marks]
        out_lines.append(line)
    return "\n".join(out_lines), found


REPORT_SUBDIR = "cross-model-review"
# 日志复查的报告单独放（prd K 节、访谈 Q13）：放进 cross-model-review/ 会压掉验收时的跨模型复查提醒
LOG_REVIEW_SUBDIR = "log-review"


def _report_path(task: Path, subdir: str = REPORT_SUBDIR) -> Path:
    """任务目录下 `<subdir>/<日期>-<时分秒>.md`；同一秒已有就加 `-2`、`-3`。"""
    folder = task / subdir
    stem = time.strftime("%Y-%m-%d-%H%M%S")
    path, n = folder / f"{stem}.md", 2
    while path.exists():
        path, n = folder / f"{stem}-{n}.md", n + 1
    return path


def cmd_report(args: argparse.Namespace) -> dict:
    draft = Path(args.file)
    # 出错时草稿（打码前的原文）留着：修好后重跑同一条命令，或不再跑就删掉它
    kept = f"；草稿 {draft} 没删，里面是打码前的原文：修好后重跑同一条命令，不再跑就删掉它"
    if args.task and args.append:
        raise ReviewError("--task 与 --append 只能给一个" + kept)
    if args.log_review and not args.task:
        raise ReviewError("--log-review 要与 --task 一起给：报告存进那个任务的 log-review/" + kept)
    try:
        text = draft.read_text(encoding="utf-8")
    except OSError as e:
        raise ReviewError(f"读不了报告草稿 {draft}：{e}") from e
    before = ""
    target: Path | None = None
    if args.append:
        target = Path(args.append)
        try:
            before = target.read_text(encoding="utf-8")
        except OSError as e:
            raise ReviewError(f"读不了要追加的报告 {target}：{e}{kept}") from e
        if before and not before.endswith("\n"):
            text = "\n" + text
    elif args.task:
        task = Path(args.task)
        if not task.is_dir():
            raise ReviewError(f"任务目录不存在：{task}{kept}")
        target = _report_path(task, LOG_REVIEW_SUBDIR if args.log_review else REPORT_SUBDIR)
    text, found = redact(text, before)
    saved = None
    if target is not None:
        try:
            target.parent.mkdir(exist_ok=True)
            with target.open("a" if args.append else "x", encoding="utf-8") as f:
                f.write(text)
        except OSError as e:
            raise ReviewError(f"写不了复查报告 {target}：{e}{kept}") from e
        saved = str(target)
    # 打码后的文字已存好（或不用存）才删草稿
    draft.unlink()
    return {"text": text, "redactedCount": len(found), "redactions": found, "saved": saved}


def _hook_notice_path() -> Path | None:
    """`.atw/` 所在目录（与钩子 show-notice.py 同一个找法），不是 `repo_root()` 的 git 顶层；不在 ATW 项目里为 None。"""
    root = get_repo_root()
    return root / HOOK_NOTICE if (root / ".atw").is_dir() else None


def clear_hook_notice() -> None:
    """删掉上一次写给钩子的交代：这次停下、出错或参数不对时，钩子不会把旧的当成这次的显示。"""
    path = _hook_notice_path()
    if path is None:
        return
    try:
        path.unlink(missing_ok=True)
    except OSError as e:
        print(f"提醒：删不了上一次给钩子的交代 {path}：{e}", file=sys.stderr)


def write_hook_notice(command: str, result: dict, lang: str | None) -> None:
    """有 `notice` 时写给钩子：给了 `--lang` 只写那一种语言，不给时中、英两段（中文在前，空一行）。

    带上这次对话的 ATW 会话编号（`resolve_context_key`，Claude Code 上来自 `CLAUDE_CODE_SESSION_ID`），
    钩子只在同一个对话里显示；拿不到编号时为 null，钩子照旧显示。
    """
    path = _hook_notice_path()
    notice = result.get("notice")
    if path is None or not notice:
        return
    text = notice[lang] if lang else f"{notice['zh']}\n\n{notice['en']}"
    saved = {"command": command, "lang": lang, "session": resolve_context_key(), "text": text}
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(saved, ensure_ascii=False), encoding="utf-8")
    except OSError as e:
        # 钩子没东西可显示，也就不会告诉 AI 已显示过：AI 照 skill 自己原样贴出
        print(f"提醒：写不了给钩子的交代 {path}：{e}", file=sys.stderr)


def main(argv: list[str] | None = None) -> int:
    configure_encoding()
    argv = sys.argv[1:] if argv is None else argv
    # 解析参数之前就删：参数不对退出 2 时也不留上一次的
    if argv and argv[0] in NOTICE_COMMANDS:
        clear_hook_notice()
    p = argparse.ArgumentParser(description="ATW 跨模型复查：冻结补丁、组材料、同时跑全部复查员")
    sub = p.add_subparsers(dest="command", required=True)
    pp = sub.add_parser("prepare", help="冻结补丁、组材料与题目")
    pp.add_argument("--since", help="用户给的起点（提交、分支或标签）；不给时取任务的 base_branch 或仓库默认主线")
    pp.add_argument("--path", action="append", help="只看这个文件夹或文件，可多次")
    pp.add_argument("--whole", action="store_true", help="超过 500 行时用户选了整段看")
    pp.add_argument("--group", action="append", help='用户选了分开看：一组一个，"<文件夹或文件>,<文件夹或文件>"')
    pp.add_argument("--questions", required=True, help="题目文件")
    pp.add_argument("--reviewer", action="append", required=True, help='"<工具> model=<模型> [effort=<强度>]"')
    pp.add_argument("--task", help="任务目录")
    pp.add_argument("--intent-file", help="没有 prd.md 时的意图")
    pp.add_argument("--recheck", help="复核：上次复查报告里的快照编号，只看那之后的改动")
    pp.add_argument("--picked-file", help="复核：上次报告里用户选去改的条目（与 --recheck 一起给）")
    pp.add_argument("--expect-base", help="重试或换人时：第一次 run 给出的 baseCommit")
    pp.add_argument("--expect-patch", help="重试或换人时：第一次 run 给出的 patchHash")
    pp.add_argument("--pick", help="这一轮 pick 输出的 JSON 对象，原样照抄；开跑前交代据它写同家、跳过与点名的提醒")
    pp.add_argument("--lang", choices=("zh", "en"), help="Claude Code：钩子原样显示给用户的那段用哪种语言（用户的语言，其他语言给 en）；不给时中英两段都显示")
    pl = sub.add_parser("prepare-log", help="日志复查：组决定日志与聊天记录的材料并打码（不冻结补丁）")
    pl.add_argument("--questions", required=True, help="日志复查的题目文件")
    pl.add_argument("--reviewer", action="append", required=True, help='"<工具> model=<模型> [effort=<强度>]"')
    pl.add_argument("--task", required=True, help="任务目录（决定日志在里面）")
    pl_scope = pl.add_mutually_exclusive_group()
    pl_scope.add_argument("--whole", action="store_true", help="用户要求时看整份日志与各次运行的聊天记录；默认只看最近一次运行")
    pl_scope.add_argument(
        "--session", nargs="?", const=CURRENT_SESSION, metavar="对话编号",
        help="只看这个对话的运行；不带值时是这次对话（无人值守收尾用）；日志里没有它的运行时停下（stop: no-run）",
    )
    pl.add_argument("--pick", help="同 prepare：这一轮 pick 输出的 JSON 对象，原样照抄")
    pl.add_argument("--lang", choices=("zh", "en"), help="同 prepare")
    pr = sub.add_parser("run", help="同时跑全部复查员，收完结果后清理")
    pr.add_argument("id", help="prepare 给出的编号")
    pf = sub.add_parser("family", help="按模型名字认家")
    pf.add_argument("model", help="模型名")
    pf.add_argument("--tool", choices=TOOLS, help="模型所在的工具（Claude Code 的简称只在 claude 时算）")
    sub.add_parser("probe", help="不调模型地查四个工具")
    sub.add_parser("settings", help="读复查员设置（~/.atw/reviewers.yaml，ATW_REVIEWERS_FILE 可改）")
    for name, desc in (("check", "不写设置，只验证复查员能不能用"), ("save", "验证全部能用后写入设置（设成默认）")):
        pc = sub.add_parser(name, help=desc)
        pc.add_argument("--reviewer", action="append", required=True, help='"<工具> [model=<模型>] [effort=<强度>]"')
    pk = sub.add_parser("pick", help="判宿主与当前 AI，定复查员（点名优先，否则自动挑一个）")
    pk.add_argument("--reviewer", action="append", help='当场点名的 "<工具> [model=<模型>] [effort=<强度>]"')
    pk.add_argument("--model-line", help="Claude Code 与 omp：系统提示里写模型的那一行，原样照抄")
    pk.add_argument("--author", action="append", help="用户说明的作者：家名或模型名，可多次")
    pk.add_argument("--auto", action="store_true", help="不看设置，直接自动挑一个")
    pk.add_argument(
        "--settings-only", action="store_true",
        help="无人值守的日志复查：只用设置里的复查员，不自动挑、不换人、不弹向导；用不成时在 unavailable 给原因",
    )
    pk.add_argument(
        "--failed", action="append", choices=TOOLS,
        help="这次跑不起来的复查员的工具，可多次：自动挑出的给出下一个合格的，点名或设置里的不自动换人",
    )
    pa = sub.add_parser("afk-notice", help="--afk 开跑提醒：同 pick --settings-only，另给写好的提醒全文")
    pa.add_argument("--skill", required=True, choices=("atw-implement-all", "atw-implement-spec"), help="哪个连做命令")
    pa.add_argument("--branch", required=True, help="这次运行的分支（atw-implement-spec 为集成分支）")
    pa.add_argument("--new-branch", action="store_true", help="分支是这次运行新开的")
    pa.add_argument("--max", type=int, help="用户给的 --max N（只属于 atw-implement-all），写进重新开跑的命令")
    pa.add_argument("--task", required=True, help="任务目录（「等你处理」清单在里面）")
    pa.add_argument("--model-line", help="同 pick")
    pa.add_argument("--author", action="append", help="同 pick")
    pa.add_argument("--lang", choices=("zh", "en"), help="同 prepare")
    pa.set_defaults(settings_only=True, reviewer=None, auto=False, failed=None)
    prp = sub.add_parser("report", help="给复查报告打码；有任务时存进任务目录的 cross-model-review/")
    prp.add_argument("--file", required=True, help="报告草稿（存好后删掉；出错时留着）")
    prp.add_argument("--task", help="任务目录；不给时只打码、不写文件")
    prp.add_argument("--append", help="已存的复查报告：打码后追加到它末尾（用户选去改的条目）")
    prp.add_argument("--log-review", action="store_true", help="日志复查的报告：存进任务目录的 log-review/（要与 --task 一起给）")
    sub.add_parser("host", help="主 AI 的命令在不在宿主的围栏里、能否申请到围栏外跑")
    pw = sub.add_parser("wizard", help="设置向导要列的：四个工具能不能用、哪家、是否与作者同家、推荐哪个")
    pw.add_argument("--model-line", help="同 pick")
    pw.add_argument("--author", action="append", help="同 pick")
    args = p.parse_args(argv)
    commands = {
        "pick": cmd_pick,
        "afk-notice": cmd_afk_notice,
        "prepare": cmd_prepare,
        "prepare-log": cmd_prepare_log,
        "run": cmd_run,
        "family": lambda a: {"model": a.model, "families": families_of(a.model, a.tool)},
        "probe": lambda a: {"tools": [probe_tool(t) for t in AUTO_PICK_ORDER]},
        "settings": lambda a: read_settings(),
        "check": lambda a: {"reviewers": [verify_reviewer(_parse_wanted(s)) for s in a.reviewer]},
        "save": cmd_save,
        "wizard": cmd_wizard,
        "host": lambda a: host_sandbox(),
        "report": cmd_report,
    }
    try:
        result = commands[args.command](args)
    except ReviewError as e:
        print(f"错误：{e}", file=sys.stderr)
        return EXIT_ERROR
    if args.command in NOTICE_COMMANDS:
        write_hook_notice(args.command, result, args.lang)
    print(json.dumps(result, ensure_ascii=False))
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
