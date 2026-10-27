#!/usr/bin/env python3
# floor-guard: opt-out — 这个文件的工作就是定义标记表，表里每一行都会被当成标记
"""防降级守卫 —— 安装到 .atw/scripts/floor_guard.py。

    floor_guard.py <patch>   扫一份冻结好的补丁文件，报出「放低门槛」的动作
    floor_guard.py <patch> --waiting-on-you <清单> --decision-log <日志>
                             同上，另外放行「等你处理」清单里按三条写明的占位

输入是审查技能第 1 步冻结的补丁（`git diff --binary` 加 `git diff --no-index`
拼出来的统一格式），本脚本不自己跑 git：审查子代理禁止跑 git，而且三方看的
必须是同一份改动。

只看新增行、删除行与被删文件，报七类规则（规则名即输出首列；标记类的三条
不看 Markdown 等纯文本文件，文档里提到标记名只是字面提及）：
    skip-marker        新增的无条件跳过标记（it.skip / xit / it.todo / @pytest.mark.skip …）；
                       带条件的跳过不报：.skipIf(、pytest.mark.skipif、@unittest.skipIf，
                       以及写在 `if …:` 同一行或紧随其后的 pytest.skip(
    suppress-comment   新增的压制注释（ts-ignore / eslint-disable / noqa / type: ignore …）
    test-file-deleted  被整个删掉的测试文件
    assertion-removed  保留的测试文件里被删掉的断言——从 expect / assert / should 起到
                       行尾的表达式在同文件新增行里找不到才算（只是被改动的不报）
    ignore-entry       忽略文件与配置里新增的 ignore / allowlist / exclude 条目
    placeholder        新增的桩（not implemented、单行 def: pass / ...）、
                       体里只有注释的 catch、except: pass / ...、TODO
    guard-opt-out      文件开头声明了「floor-guard: opt-out — 原因」的文件：只报这一行
                       （文件、原因），不逐行报；没有原因的声明不认。本脚本和它的测试
                       样例就靠它——它们的工作是定义和测试标记。这是唯一不只看补丁的
                       地方：工作区里有这个文件就读它的文件头（改动没碰文件头时补丁里
                       看不到声明），没有才看补丁新侧的文件头

放行（两个参数要一起给，传任务目录的 waiting-on-you.md 与 decision-log.md，都由
decision_log.py 的读法读）：只看 placeholder 这一类。清单里有一条同时满足三条才放行——
类别是「外部账号·密钥·付费」；条目还没勾掉，点名这个占位的 `文件:行`，写了缺什么
（「要你做什么」）和补上后怎么接上（「回来后可以输入」的命令）；决定日志里条目记的时间上
正是记进这一条的那一行，且没被顶替。放行的照样列出，行尾加「放行：等你处理第 N 条」。清单在守卫跑的那一刻读，
所以审查第 1 步就跑，审查开始后才写的条目放行不了。

退出码：
    0  干净，或报出的每一条都已放行
    1  有没放行的发现
    2  没跑起来（文件不存在、读不出来、不是补丁格式、hunk 行数对不上、
       清单或日志认不出、两个参数只给了一个、脚本自身异常）—— 2 绝不等于 0，审查技能把 2 当硬违规而不是当干净

输出每条一行：规则名、文件:行号、标记名或片段开头（截到一行、不超过
SNIPPET_MAX 个字符，不完整回显——报告要可读，也不把行里的敏感值带出去）。
行号：新增行取新文件的行号，删除行取旧文件的行号。
文件名按 git 引号转义还原后显示，其中的控制字符写成 \\t、\\n、\\r、\\xNN，保持一条一行。

第一版覆盖 JS/TS 与 Python 写法；标记都在下面的常量里，加新语言往列表里追加。
"""
from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

from common import configure_encoding
from decision_log import LANGS, WAIT_LANGS, LogError, WaitItem, read_log, read_waiting, superseded_times

EXIT_CLEAN = 0
EXIT_FOUND = 1
EXIT_ERROR = 2

SNIPPET_MAX = 60

# ---------------------------------------------------------------------------
# 可扩的标记表。每项 (显示名, 正则)：显示名进报告，正则在一行内匹配
# ---------------------------------------------------------------------------

# 带条件的跳过不算：`.skipIf(`、`pytest.mark.skipif`、`@unittest.skipIf/skipUnless`
# 自带条件；`pytest.skip(` 本身无条件，写在 `if …:` 同一行、或所在块的块头是 `if …:`
# （上方最近一行缩进更浅的非空行）才算带条件
SKIP_MARKERS: list[tuple[str, re.Pattern[str]]] = [
    # JS/TS：vitest / jest / mocha（`\.skip\s*\(` 不匹配 `.skipIf(`）
    ("it.skip", re.compile(r"\b(?:it|test|describe|suite|context)\.skip\s*\(")),
    ("it.only", re.compile(r"\b(?:it|test|describe|suite|context)\.only\s*\(")),
    ("it.todo", re.compile(r"\b(?:it|test)\.todo\s*\(")),
    ("xit", re.compile(r"\bx(?:it|test|describe|context|specify)\s*\(")),
    # Python：pytest / unittest（`skip\b` 不匹配 `skipif` / `skipIf` / `skipUnless`）
    ("pytest.mark.skip", re.compile(r"pytest\.mark\.(?:skip|xfail)\b")),
    ("pytest.skip", re.compile(r"\bpytest\.(?:skip|xfail)\s*\(")),
    ("unittest.skip", re.compile(r"@(?:unittest\.)?(?:skip|expectedFailure)\b")),
]
RE_IF_LINE = re.compile(r"^\s*(?:if|elif)\b")
RE_IF_HEADER = re.compile(r"^\s*(?:if|elif)\b.*:\s*(?:#.*)?$")

SUPPRESS_MARKERS: list[tuple[str, re.Pattern[str]]] = [
    ("ts-ignore", re.compile(r"@ts-ignore\b")),
    ("ts-nocheck", re.compile(r"@ts-nocheck\b")),
    ("eslint-disable", re.compile(r"\beslint-disable\b")),
    ("biome-ignore", re.compile(r"\bbiome-ignore\b")),
    ("istanbul ignore", re.compile(r"\bistanbul ignore\b")),
    ("nosemgrep", re.compile(r"\bnosemgrep\b")),
    ("gitleaks:allow", re.compile(r"\bgitleaks:allow\b")),
    ("Stryker disable", re.compile(r"\bStryker disable\b")),
    ("noqa", re.compile(r"#\s*noqa\b")),
    ("type: ignore", re.compile(r"#\s*type:\s*ignore\b")),
    ("pyright: ignore", re.compile(r"#\s*pyright:\s*ignore\b")),
    ("pylint: disable", re.compile(r"#\s*pylint:\s*disable\b")),
]

PLACEHOLDER_MARKERS: list[tuple[str, re.Pattern[str]]] = [
    ("TODO", re.compile(r"\b(?:TODO|FIXME)\b")),
    ("not implemented", re.compile(r"not implemented|NotImplementedError", re.IGNORECASE)),
    # 单行空 catch / except / def：体里只有空白、注释、pass 或 ...
    ("empty catch", re.compile(r"\bcatch\b[^{]*\{\s*(?:/\*.*?\*/\s*)*\}")),
    ("except: pass", re.compile(r"^\s*except\b[^:]*:\s*(?:pass|\.\.\.)\s*(?:#.*)?$")),
    ("def: pass", re.compile(r"^\s*(?:async\s+)?def\s+\w+\s*\(.*\)\s*(?:->\s*[^:]+)?:\s*(?:pass|\.\.\.)\s*(?:#.*)?$")),
]
# 多行空 catch / except：这一行开了块，跳过只有注释的行，紧接着就收。
# 只认 catch / except，`() => {}` 这类空回调合法用法太多，不算
RE_CATCH_OPEN = re.compile(r"\bcatch\b[^{]*\{\s*$")
RE_BLOCK_CLOSE = re.compile(r"^\s*\}")
RE_JS_COMMENT = re.compile(r"^\s*(?://|/\*|\*)")
RE_EXCEPT_OPEN = re.compile(r"^\s*except\b[^:]*:\s*(?:#.*)?$")
RE_BARE_PASS = re.compile(r"^\s*(?:pass|\.\.\.)\s*(?:#.*)?$")
RE_PY_COMMENT = re.compile(r"^\s*#")

# 断言：删掉这些行就是在放低测试的门槛
ASSERTION_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"\bexpect\s*\("),
    re.compile(r"\bassert\b"),
    re.compile(r"\bself\.assert\w*\s*\("),
    re.compile(r"\bpytest\.raises\s*\("),
    re.compile(r"\.should\b"),
]

# 文件级退出声明：文件开头 OPT_OUT_HEAD_LINES 行内一行「floor-guard: opt-out — 原因」，
# 注释形式随语言（`# …`、`// …`、JSDoc 里的 ` * …` 都行）。有效声明的文件只报一行
# guard-opt-out（文件、原因），不逐行报；破折号后没有原因就无效，照常逐行报。
# 工作区里有这个文件就以它的文件头为准（审查在仓库根目录跑，补丁新侧就是工作区；
# 改动没碰文件头时补丁里看不到声明），没有（在别处重放补丁）才看补丁新侧的文件头
OPT_OUT_HEAD_LINES = 10
RE_OPT_OUT = re.compile(r"floor-guard:\s*opt-out\b\s*(?:[—–-]+\s*(?P<reason>.*))?$")

# 纯文本文件里提到 TODO、eslint-disable 只是字面提及，不是桩也不是压制——
# 标记类规则（skip / suppress / placeholder）跳过这些扩展名
PROSE_EXTENSIONS = (".md", ".markdown", ".txt", ".rst")  # .mdx 能嵌真代码，不在此列

# 哪些路径算测试文件
TEST_FILE_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"\.(?:test|spec)\.[cm]?[jt]sx?$"),
    re.compile(r"(?:^|/)(?:test|tests|__tests__|spec)/"),
    re.compile(r"(?:^|/)test_[^/]*\.py$"),
    re.compile(r"_test\.py$"),
    re.compile(r"(?:^|/)conftest\.py$"),
]

# 忽略文件：每一条非空、非注释的新增行都是一个放行条目
RE_IGNORE_FILE = re.compile(r"(?:^|/)\.[\w.-]*ignore$")
# 配置文件：只在这些文件里认 ignore / allowlist / exclude 键
CONFIG_FILE_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"\.config\.[cm]?[jt]s$"),
    re.compile(r"\.(?:json|jsonc|json5|ya?ml|toml|ini|cfg)$"),
    re.compile(r"(?:^|/)\.(?:eslintrc|babelrc|pylintrc|flake8|coveragerc|prettierrc|stylelintrc)(?:\.\w+)?$"),
    re.compile(r"(?:^|/)(?:setup|tox|pytest)\.(?:cfg|ini)$"),
]
# 键名按族认：含这些词的键都算（ignores、ignorePatterns、exclude_lines、
# exclude_also…）。裸 `allow` / `skip` 不算——`.claude/settings.json` 的
# `permissions.allow` 每加一条都会报，接进审查后就是常态噪音
IGNORE_KEY_FAMILIES = ("ignore", "exclude", "allowlist", "allow_list", "allow-list")
_IGNORE_KEY_NAME = r"[\w.-]*(?:%s)[\w.-]*" % "|".join(re.escape(k) for k in IGNORE_KEY_FAMILIES)
RE_IGNORE_KEY = re.compile(
    r"""^\s*(?:"%s"|'%s'|%s)\s*[:=]\s*(?P<value>.*)$""" % ((_IGNORE_KEY_NAME,) * 3),
    re.IGNORECASE,
)
# 任何「键 = / 键 :」形状的行：遇到别的键就说明离开了 ignore 列表块。
# 带引号的键必须整对闭合，否则列表项 `"pragma: no cover",` 会被当成键
RE_ANY_KEY = re.compile(r"""^\s*(?:"[^"]+"|'[^']+'|[\w.$-]+)\s*[:=]""")
RE_LIST_CLOSE = re.compile(r"^\s*[\]\})]")


# ---------------------------------------------------------------------------
# 补丁解析
# ---------------------------------------------------------------------------

@dataclass
class Line:
    kind: str       # "+" / "-" / " "
    text: str       # 去掉前缀后的内容
    old_no: int     # 旧文件行号（新增行为 0）
    new_no: int     # 新文件行号（删除行为 0）


@dataclass
class FileDiff:
    path: str
    deleted: bool = False
    lines: list[Line] = field(default_factory=list)


class PatchError(Exception):
    """文件不存在、读不出来、不是补丁 —— main 统一转成退出码 2。"""


RE_HUNK = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")

# git 给含中文、引号、制表符、反斜杠等的路径加双引号，按 C 风格转义；
# 非 ASCII 字节写成三位八进制（中文即 UTF-8 字节的 \ooo）
RE_GIT_ESCAPE = re.compile(r'\\([0-7]{3}|[abtnvfr"\\])')
GIT_ESCAPES = {"a": 7, "b": 8, "t": 9, "n": 10, "v": 11, "f": 12, "r": 13, '"': 34, "\\": 92}


def _unquote_git_path(body: str) -> str:
    """还原 git 加了引号的路径；没加引号的原样返回。"""
    if len(body) < 2 or not (body.startswith('"') and body.endswith('"')):
        return body
    out = bytearray()
    for i, part in enumerate(RE_GIT_ESCAPE.split(body[1:-1])):
        if i % 2 == 0:
            out += part.encode("utf-8")
        elif len(part) == 3:
            out.append(int(part, 8))
        else:
            out.append(GIT_ESCAPES[part])
    return out.decode("utf-8", errors="replace")


def _header_path(line: str) -> str | None:
    """从 `--- a/x` / `+++ b/x` 取路径（先还原引号转义）；/dev/null 返回 None。"""
    body = line[4:].rstrip("\n")
    # 路径里有空格时 git 在末尾补一个制表符
    body = _unquote_git_path(body.rstrip("\t"))
    if body == "/dev/null":
        return None
    if body.startswith(("a/", "b/")):
        body = body[2:]
    return body


def parse_patch(text: str) -> list[FileDiff]:
    files: list[FileDiff] = []
    current: FileDiff | None = None
    old_path: str | None = None
    new_path: str | None = None
    old_left = new_left = 0
    old_no = new_no = 0
    in_binary = False

    def start_file() -> None:
        nonlocal current
        current = FileDiff(path="")
        files.append(current)

    def check_hunk_closed(where: str) -> None:
        # 行数对不上就是补丁被截断或改过——漏看后面的文件比报错糟得多
        if old_left > 0 or new_left > 0:
            raise PatchError(f"补丁格式有误：{where}，hunk 比头部声明的行数少（{current.path if current else '?'}）")

    for lineno, raw in enumerate(text.splitlines(), 1):
        in_hunk = old_left > 0 or new_left > 0
        if in_hunk and current is not None:
            if raw.startswith("\\"):
                continue  # "\ No newline at end of file"
            kind = raw[:1] or " "
            body = raw[1:]
            if kind not in "+- ":
                raise PatchError(f"补丁格式有误：第 {lineno} 行不是 hunk 内容行（{current.path}）")
            if kind == "+":
                new_no += 1
                new_left -= 1
                current.lines.append(Line("+", body, 0, new_no))
            elif kind == "-":
                old_no += 1
                old_left -= 1
                current.lines.append(Line("-", body, old_no, 0))
            else:
                old_no += 1
                new_no += 1
                old_left -= 1
                new_left -= 1
                current.lines.append(Line(" ", body, old_no, new_no))
            continue

        if raw.startswith("diff --git "):
            check_hunk_closed(f"第 {lineno} 行开始下一个文件时")
            start_file()
            old_path = new_path = None
            in_binary = False
            continue
        if current is None:
            continue
        if in_binary:
            continue
        if raw.startswith("GIT binary patch") or raw.startswith("Binary files "):
            in_binary = True
            continue
        if raw.startswith("deleted file mode"):
            current.deleted = True
            continue
        if raw.startswith("--- "):
            old_path = _header_path(raw)
            continue
        if raw.startswith("+++ "):
            new_path = _header_path(raw)
            # 新文件没有旧路径、删除的文件没有新路径——取有的那一侧
            current.path = new_path or old_path or current.path
            if new_path is None and old_path is not None:
                current.deleted = True
            continue
        m = RE_HUNK.match(raw)
        if m:
            old_no = int(m.group(1)) - 1
            old_left = int(m.group(2)) if m.group(2) is not None else 1
            new_no = int(m.group(3)) - 1
            new_left = int(m.group(4)) if m.group(4) is not None else 1
            continue
        if raw[:1] in ("+", "-") and not raw.startswith(("+++ ", "--- ")):
            raise PatchError(f"补丁格式有误：第 {lineno} 行在 hunk 之外出现 {raw[:1]} 行，hunk 头部声明的行数偏少（{current.path}）")

    check_hunk_closed("到文件末尾时")
    files = [f for f in files if f.path]
    if not files:
        raise PatchError("不是补丁格式：没有找到任何 `diff --git` 文件头")
    return files


# ---------------------------------------------------------------------------
# 规则
# ---------------------------------------------------------------------------

@dataclass
class Finding:
    rule: str
    path: str
    line_no: int
    detail: str
    passed_by: int | None = None  # 放行它的「等你处理」条目号


def is_test_file(path: str) -> bool:
    return any(p.search(path) for p in TEST_FILE_PATTERNS)


def is_config_file(path: str) -> bool:
    return any(p.search(path) for p in CONFIG_FILE_PATTERNS)


RE_COMMENT_LINE = re.compile(r"^\s*(?:#|//|/\*|\*)")


def assertion_key(text: str) -> str | None:
    """断言表达式：从 expect / assert / should 起到行尾；不是断言行返回 None。

    删除行与新增行按它比对：一行断言只是被改动（前面加了跳过条件）时表达式还在，
    不另报「断言被删」；表达式本身变了或真删了才报。
    """
    # 注释里的「assert」不是断言，删掉它不放低任何门槛
    if RE_COMMENT_LINE.match(text):
        return None
    starts = [m.start() for m in (p.search(text) for p in ASSERTION_PATTERNS) if m]
    return text[min(starts):].strip() if starts else None


def snippet(text: str) -> str:
    """片段开头：去首尾空白、截到 SNIPPET_MAX，超出加省略号。"""
    s = text.strip()
    return s if len(s) <= SNIPPET_MAX else s[:SNIPPET_MAX] + "…"


def match_markers(text: str, markers: list[tuple[str, re.Pattern[str]]]) -> str | None:
    for name, pat in markers:
        if pat.search(text):
            return name
    return None


def _opt_out_in(head: list[tuple[int, str]]) -> tuple[int, str] | None:
    for no, text in head:
        m = RE_OPT_OUT.search(text)
        if not m:
            continue
        reason = (m.group("reason") or "").strip().removesuffix("*/").strip()
        if reason:
            return no, reason
    return None


def opt_out(f: FileDiff) -> tuple[int, str] | None:
    """有效退出声明的 (行号, 原因)；没有返回 None。"""
    disk = Path(f.path)
    if disk.is_file():
        try:
            head = disk.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            head = []
        return _opt_out_in(list(enumerate(head[:OPT_OUT_HEAD_LINES], 1)))
    return _opt_out_in(
        [(l.new_no, l.text) for l in f.lines if l.kind != "-" and l.new_no <= OPT_OUT_HEAD_LINES]
    )


def scan_file(f: FileDiff) -> list[Finding]:
    found: list[Finding] = []
    if f.deleted:
        if is_test_file(f.path):
            found.append(Finding("test-file-deleted", f.path, 0, "deleted"))
        # 被删文件里的每一行都是删除行，再逐行报断言只是噪音
        return found

    declared = opt_out(f)
    if declared is not None:
        return [Finding("guard-opt-out", f.path, declared[0], snippet(declared[1]))]

    added = [l for l in f.lines if l.kind == "+"]
    # 新文件视角的行序（新增 + 上下文），多行空 catch 要看「下一行」
    new_side = [l for l in f.lines if l.kind != "-"]
    test_file = is_test_file(f.path)
    ignore_file = bool(RE_IGNORE_FILE.search(f.path))
    config_file = is_config_file(f.path)
    prose = f.path.lower().endswith(PROSE_EXTENSIONS)

    for i, l in enumerate(new_side if not prose else []):
        if l.kind != "+":
            continue
        name = match_markers(l.text, SKIP_MARKERS)
        if name and not (name == "pytest.skip" and _under_if(new_side, i)):
            found.append(Finding("skip-marker", f.path, l.new_no, name))
        name = match_markers(l.text, SUPPRESS_MARKERS)
        if name:
            found.append(Finding("suppress-comment", f.path, l.new_no, name))
        name = match_markers(l.text, PLACEHOLDER_MARKERS)
        if name:
            found.append(Finding("placeholder", f.path, l.new_no, name))

    # 多行空 catch / except：开块那一行是新增的，体里只有注释，然后就收
    for i, l in enumerate(new_side):
        if l.kind != "+":
            continue
        if RE_CATCH_OPEN.search(l.text):
            body = _block_body(new_side, i, RE_JS_COMMENT)
            if body is not None and RE_BLOCK_CLOSE.match(body):
                found.append(Finding("placeholder", f.path, l.new_no, "empty catch"))
        elif RE_EXCEPT_OPEN.match(l.text):
            body = _block_body(new_side, i, RE_PY_COMMENT)
            if body is not None and RE_BARE_PASS.match(body):
                found.append(Finding("placeholder", f.path, l.new_no, "except: pass"))

    if test_file:
        added_keys = {k for k in (assertion_key(l.text) for l in added) if k}
        for l in f.lines:
            if l.kind != "-":
                continue
            key = assertion_key(l.text)
            if key and key not in added_keys:
                found.append(Finding("assertion-removed", f.path, l.old_no, snippet(l.text)))

    if ignore_file:
        for l in added:
            s = l.text.strip()
            if s and not s.startswith("#"):
                found.append(Finding("ignore-entry", f.path, l.new_no, snippet(l.text)))
    elif config_file:
        found.extend(scan_config(f, new_side))

    return found


def _indent(text: str) -> int:
    return len(text) - len(text.lstrip())


def _under_if(lines: list[Line], idx: int) -> bool:
    """这一行自己以 `if …` 开头，或包住它的块头（上方最近一行缩进更浅的非空行）是 `if …:`。

    只看缩进更浅的那一行：同缩进的 `if x: y = 1` 是兄弟语句不是块头，不能借它免报。
    块头不在补丁里（hunk 没带到）就当无条件，照报。
    """
    here = lines[idx].text
    if RE_IF_LINE.match(here):
        return True
    for l in reversed(lines[:idx]):
        if not l.text.strip():
            continue
        if _indent(l.text) < _indent(here):
            return bool(RE_IF_HEADER.match(l.text))
    return False


def _block_body(lines: list[Line], start: int, comment: re.Pattern[str]) -> str | None:
    """开块行之后第一行实质内容（跳过空行与注释）；块到补丁尽头没收，返回 None。"""
    for l in lines[start + 1:]:
        if not l.text.strip() or comment.match(l.text):
            continue
        return l.text
    return None


def scan_config(f: FileDiff, new_side: list[Line]) -> list[Finding]:
    """配置里的放行条目：带值的 ignore 键本身，或 ignore 列表块里新增的项。

    块的边界靠形状判断：键行的值没有在本行闭合（`[`、`{` 或空）就进入块，
    遇到另一个「键 = / 键 :」或收尾括号就离开。够用于 JSON / YAML / TOML /
    JS 配置的常见写法，不做完整解析。
    """
    found: list[Finding] = []
    in_block = False
    for l in new_side:
        m = RE_IGNORE_KEY.match(l.text)
        if m:
            value = m.group("value").strip().rstrip(",").strip()
            closed = bool(value) and value[-1] not in "[{("
            if l.kind == "+" and closed and value not in ("[]", "{}", "''", '""'):
                found.append(Finding("ignore-entry", f.path, l.new_no, snippet(l.text)))
            in_block = not closed
            continue
        if in_block and (RE_LIST_CLOSE.match(l.text) or RE_ANY_KEY.match(l.text)):
            in_block = False
        if in_block and l.kind == "+" and l.text.strip() and not l.text.strip().startswith("#"):
            found.append(Finding("ignore-entry", f.path, l.new_no, snippet(l.text)))
    return found


def scan(files: list[FileDiff]) -> list[Finding]:
    found: list[Finding] = []
    for f in files:
        found.extend(scan_file(f))
    return found


RE_C0_CONTROL = re.compile(r"[\x00-\x1f]")
DISPLAY_ESCAPES = {"\t": "\\t", "\n": "\\n", "\r": "\\r"}


def display_path(path: str) -> str:
    """只用于显示：文件名里的控制字符转义，报告保持一条一行；匹配仍用还原后的原名。"""
    return RE_C0_CONTROL.sub(lambda m: DISPLAY_ESCAPES.get(m.group(), f"\\x{ord(m.group()):02x}"), path)


def format_finding(x: Finding) -> str:
    path = display_path(x.path)
    loc = f"{path}:{x.line_no}" if x.line_no else path
    line = f"{x.rule:<18} {loc}  {x.detail}"
    if x.passed_by is not None:
        line += f"  放行：等你处理第 {x.passed_by} 条"
    return line


# ---------------------------------------------------------------------------
# 放行「等你处理」清单里写明的占位
# ---------------------------------------------------------------------------

# 只有「外部账号·密钥·付费」这一类的条目能放行占位（decision_log.py 的英文类别名）
PASS_CATEGORY = "account-key-paid"


def pass_placeholders(findings: list[Finding], wait_path: str, log_path: str) -> None:
    """占位被清单里某一条按三条点名时，记下放行它的条目号。

    三条：类别是 PASS_CATEGORY；条目还没勾掉，点名这个占位的 `文件:行`、写了缺什么
    （「要你做什么」）和补上后怎么接上（「回来后可以输入」的命令）；决定日志里条目记的
    那个时间上，正是记进这一条的那一行，而且这一行没被顶替。两个文件都由 decision_log.py
    读，格式认不出就报错退 2。
    """
    try:
        waiting = read_waiting(Path(wait_path))
        log = read_log(Path(log_path))
    except LogError as e:
        raise PatchError(str(e))
    if waiting is None:
        raise PatchError(f"「等你处理」清单不存在：{wait_path}")
    if log is None:
        raise PatchError(f"决定日志不存在：{log_path}")
    lang, _, all_items = waiting
    unknown = WAIT_LANGS[lang].unknown
    superseded = superseded_times(log[1])
    rows = {r.raw_time: r for r in log[1] if r.raw_time not in superseded}

    def can_pass(item: WaitItem) -> bool:
        ask = str(item.fields.get("ask") or "")
        row = rows.get(str(item.fields.get("log_time") or ""))
        return (
            item.fields.get("category") == PASS_CATEGORY
            and not item.done
            and ask not in ("", unknown)
            and bool(item.fields.get("commands"))
            and row is not None
            and row.result in {spec.wait_added.format(n=item.number) for spec in LANGS.values()}
        )

    def named(item: WaitItem) -> list[str]:
        value = item.fields.get("placeholders")
        return [str(v) for v in value] if isinstance(value, list) else []

    items = [i for i in all_items if can_pass(i)]
    for x in findings:
        if x.rule != "placeholder":
            continue
        loc = f"{x.path}:{x.line_no}"
        x.passed_by = next((i.number for i in items if loc in named(i)), None)


# ---------------------------------------------------------------------------
# 入口
# ---------------------------------------------------------------------------

def read_patch(path_str: str) -> str:
    path = Path(path_str)
    if not path.is_file():
        raise PatchError(f"补丁文件不存在：{path}")
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError as e:
        raise PatchError(f"补丁文件读不出来：{path}（{e}）")
    if not text.strip():
        raise PatchError(f"补丁文件是空的：{path}")
    return text


def main(argv: list[str] | None = None) -> int:
    configure_encoding()
    p = argparse.ArgumentParser(description="ATW 防降级守卫：扫冻结补丁里放低门槛的动作")
    p.add_argument("patch", nargs="?", help="审查技能冻结好的补丁文件路径")
    p.add_argument("--waiting-on-you", help="任务的 waiting-on-you.md")
    p.add_argument("--decision-log", help="任务的 decision-log.md")
    args = p.parse_args(argv)
    try:
        if not args.patch:
            raise PatchError("需要补丁文件路径")
        if bool(args.waiting_on_you) != bool(args.decision_log):
            raise PatchError("--waiting-on-you 与 --decision-log 要一起给")
        findings = scan(parse_patch(read_patch(args.patch)))
        if args.waiting_on_you:
            pass_placeholders(findings, args.waiting_on_you, args.decision_log)
    except PatchError as e:
        print(f"错误：{e}", file=sys.stderr)
        return EXIT_ERROR
    except Exception as e:  # 没预料到的异常也是「没跑起来」，不能借默认退出码 1 冒充「有发现」
        print(f"错误：防降级守卫自身出错：{type(e).__name__}: {e}", file=sys.stderr)
        return EXIT_ERROR
    if not findings:
        print("(无发现)")
        return EXIT_CLEAN
    for x in findings:
        print(format_finding(x))
    return EXIT_FOUND if any(x.passed_by is None for x in findings) else EXIT_CLEAN


if __name__ == "__main__":
    sys.exit(main())
