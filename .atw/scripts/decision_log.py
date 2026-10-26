#!/usr/bin/env python3
"""决定日志脚本 —— 安装到 .atw/scripts/decision_log.py。

    decision_log.py start [--lang zh|en]
        写这次运行的 start 行：证据格是对话编号，结果格是它前面、不是这次对话写的
        那几行的时间范围（第一次写「这份日志从这里开始」）。写之前打印最后几行，
        以及有没有别的对话在这次对话写过之后插写。同一个对话已经是最后一段时不重复写。
        日志还没有时按 --lang 建标题与表头，之后沿用；中英两套表头都认
    decision_log.py add --phase <阶段> --decision <决定> --why <理由>
                        --evidence <证据> --result <结果> [--mark needs-you|unsure]
        记一行；--mark 在结果格开头写「待你确认：」或「拿不准：」（英文日志写
        `needs-you:`、`unsure:`）。--result 开头连着的同一种标记（中英哪套都认，可以混排）
        全部去掉、只留一个日志写法的；以另一种标记开头时照样加在前面、原文不动，这一行按
        --mark 算。supersede、ack 同样
    decision_log.py supersede --time <时间> <同 add 的栏>
        追加顶替行：决定格以「顶替 <时间> 那一行：」（英文 `supersedes <时间>:`）开头。
        顶替之后日志与长期指令表新对不上时照样记下，在标准错误提醒怎么写
    decision_log.py ack --time <时间> [--time <时间> ...] <同 add 的栏>
        追加认可行：决定格以「认可 <时间> 那一行：」（几行时「那几行」；英文
        `acknowledges <时间>, <时间>:`）开头
    decision_log.py run [--json]
        只读，取这次运行那一段：这次对话从它第一条 start 行起写的行（别的对话插写的
        不算），带对话编号与起止时间，供日志自查与日志复查用。查不到这次对话的编号时
        不猜：只在最后一条 start 行的证据格也写着查不到时取它起的那一段（那段正是没有
        编号的对话写的），并标明这样取；最后一条 start 行带着编号就退出 2。--json 给
        {session, picked_by, start, end, rows, evidence, transcript}：session 查不到为 null，picked_by 为
        `session`（按编号取）或 `last-segment-without-session`（按没有编号的最后一段取）。
        还按行列出这次运行各行的证据指针，供日志自查第 3 步照着逐个打开（start 行与自查行不列）：
        evidence 是 [{time, phase, pointers: [{text, checkable}]}]，拆法与 checkable 见下面自查行一段。
        另给日志自查读聊天记录的那条命令（`atw mem extract --context <编号> --tools --after <起>`，
        填好）与它此刻输出的总行数（参考数：自查行「读了聊天记录 X/N 行」的 N 照 AI 自己那次读取的
        输出写）：transcript 是 {command, lines, problem}。编号查不到、手动设置的原样值、atw mem 读不了
        的平台、--tools 读法没验证过的平台（只数 Claude Code、Codex、pi、omp）不调 atw，command 为
        null（文本「聊天记录读不了」）；atw 不在 PATH 上、起不来、超时（ATW_DECISION_LOG_MEM_TIMEOUT_S，
        缺省 60 秒）、退出非零（退出 2 且报 no session matches 才算编号对不上）时 lines 为 null（文本
        「聊天记录数不出行数」）；两种都照读不了聊天记录处理，problem 写原因，退出码仍是 0
    decision_log.py unsure [--json]
        只读，列出整份日志里的「拿不准」行（不分哪次对话），已被顶替的不算、被认可的照样列；
        供验收与用户亲自要求的代码审查结尾判断要不要提跨模型复查。没有时说没有、
        退出 0。--json 给 {rows}，每行六栏同 run
    decision_log.py wait --title <标题> --ask <要你做什么> --why <为什么卡在你这儿>
                         --options <选项> --default <AI 先按哪个做了> --category <类别>
                         [--if-ignored <不处理会怎样>] [--prereq <要先做什么>]
                         [--irreversible <哪一步撤不回>] [--placeholder <文件:行> ...]
                         [--command <回来后可输入的命令> ...] [--ticket <在等它的工单> ...]
                         --phase <阶段> --evidence <证据>
        记进「等你处理」一条（编号接着往下），同一条命令里先写对应的日志行：决定格是标题、
        理由格是 --why、结果格「进「等你处理」第 N 条」（英文 `added to waiting-on-you as
        item N`），不加标记；日志写不成（日志还没有等）清单也不写。清单那一步没写成时退出 2，日志里
        多出的登记行由 pending 对账报出，顶替它再重新 wait 就对上。类别只收 account-key-paid
        （外部账号·密钥·付费）、design-choice、manual-test、legal、your-step（留给你的一步）、
        unresolved-review、skipped-ticket、log-review-failed、other；没给的三项写「不知道」。
        --command 是 skill 命令（`/skill:atw-…`、`/atw-…`、`$atw-…`）时照宿主改成当前工具的写法
        （认宿主同 cross_model_review.py；pi、omp 是 `/skill:`），改了在标准错误里说；认不出宿主时原样
    decision_log.py resolve --item <N> --reply <答复> --phase <阶段> --evidence <证据>
                            [--result <结果>]
        勾掉第 N 条、在它末尾写答复，同时追加日志行（决定格「勾掉「等你处理」第 N 条：标题」、
        理由格是答复、结果格缺省「已处理」）；条目不删。已勾掉或没有这一条就退出 2。先写日志再勾清单：
        清单那一步没写成时这一条还开着，退出 2，pending 对账报出，再跑一次同一条命令就对上——日志里已有
        没被顶替的勾掉第 N 条的行时只勾清单、不写第二行。wait 与 resolve 都先写日志，中途断掉只会留下
        「日志里有、清单里对不上」这一种
    decision_log.py pending [--json]
        只读，供汇报与验收用：清单里还没处理的条目，以及整份日志里还没被认可、也没被顶替的
        「待你确认」行与「拿不准」行（口径与 unsure 不同：unsure 只排除被顶替的）。日志与
        清单都没有时各项为空、退出 0。还列出任务目录 `log-review/` 里日志复查报告中还没处理的
        「要改」：报告里「要改」/「Must fix」标题下每条写成 `### N. 标题`，处理过的由
        `cross_model_review.py report --append` 在报告末尾追加「已处理」/「Handled」一节、
        一行一条 `- 要改 N：答复`（`- Must fix N: reply`）。还对账日志与清单的两个方向，对不上的逐条
        列出、按没处理算：登记按条目的「对应日志行」对上结果格是登记写法的行，勾掉按编号对上决定格是
        勾掉写法的行，被顶替的行不算（日志里多出的登记行顶替掉就不再报）。--json 给
        {waiting, needs_you, unsure, log_review_must_fix, mismatches}：waiting 每条
        {number, done, title, ask, why, options, default, if_ignored, prereq, irreversible,
        placeholders, commands, tickets, category, log_time, reply}（category 是上面的英文
        类别名），needs_you 与 unsure 每行六栏同 run，log_review_must_fix 每条
        {report（任务目录相对路径）, number, title}，mismatches 每处 {kind, number, title, log_time}，kind 是
        log-only-added（日志说登记了、清单里没有对应这一行的条目）、list-only-added（条目在日志里没有
        对应的登记行）、log-only-resolved（日志说勾掉了、清单里没有勾上的这一条）、list-only-resolved
        （条目勾上了、日志里没有勾掉它的行），还有长期指令表的两种：log-only-standing（日志说进了长期指令
        第 N 条、表里没有第 N 条）、list-only-standing（表里第 N 条在日志里没有对应的行），title 是那条指令；
        顶替行结果格没写编号时承接被顶替那一行说的、表里确有的第 N 条；
        log_time 在 log-only 三种是那一行的时间、list-only-added 是条目写的对应日志行（没写为 null）、
        list-only-resolved 与 list-only-standing 为 null。文本与 --report 第一块同样逐处列出、各带修法；小白模式开着时多一项 terms：前四项各一句大白话
        （键同上，措辞跟着日志的语言），供验收汇报在这些说法第一次出现时附上；关着时没有这一项
    decision_log.py pending --report
        只读，给汇报底稿（prd L 节，用户说「汇报一下」时照着贴）：四块按顺序——等你处理（没处理的
        条目：标题、要你做什么、AI 先按哪个做了、回来后输入什么；日志与清单对不上的逐处列出、按没处理算；
        加 `ready-for-human` 还没做的工单）、日志复查挑出的问题（log-review/ 里的报告与还没处理的「要改」）、待你确认的条目
        （时间、决定、理由）、每张工单的状态（每张一行：编号与标题、做完 / 进行中 / 跳过（「等你处理」
        第几条，按 `tickets.py skip` 写进 `## Comments` 的日志行时间对条目，对不上再找 `--ticket` 写着
        它的跳过条目）/ 等人做 / 没动，再加合计）；措辞全跟着日志的语言（没有日志时跟着清单，都没有
        用中文），任务目录里没有的（提交号、审查结论、分支……）标成「（补：…）」留给 AI 补。
        小白模式开着时前三块标题下各先附一句大白话（同 --json 的 terms），第三块再加「拿不准」那句；关着时不附。
        没有当前任务时用 --task-dir 指定。与 --json 不能同时给
    decision_log.py standing --order <指令> --why <理由> --phase <阶段> --evidence <证据> [--lang zh|en]
        追加一条长期指令（absorb-gaps-round-2 工单 07）：同一条命令先记一行日志（决定格是指令、
        结果格「进长期指令第 N 条」/ `added to standing orders as item N`、不加标记），再往长期指令表
        末尾加一行；日志还没有时照 start 先开日志（要给 --lang）；日志与表对不上时不追加、退出 2 并给出修法。
        只由主对话跑

日志是任务目录里的 `decision-log.md`：一行标题加一张六栏表（时间、阶段、决定、
理由、证据、结果），只往后加，旧行任何时候都不改不删。只由主对话写。
时间是本地时间带时区、到秒，同一份日志里严格递增（同一秒再写顺延一秒）；一行由
它的时间唯一指称，顶替、认可指向的时间必须是日志里已有的行。格子只占一行：换行
合成空格、竖线转义、去首尾空白。

「等你处理」清单是同一目录的 `waiting-on-you.md`：一行标题（「# 等你处理」/
`# Waiting on you`）加一段说明（怎么答复：拍板的、动手的都在对话里告诉 AI，不用一直跑），每条是
`- [ ] **N. 标题**` 接着每个字段一行 `  - 字段名：值`（英文 `  - Field: value`），占位与命令每个值一行、
包在反引号里；命令前注明在哪儿输：skill 命令是「在和 AI 的对话里输入」，其余是「自己在终端里运行」
（英文 `type in the chat with the AI` / `run yourself in a terminal`），读回时去掉。
清单还没有时跟着日志的语言建，之后沿用；中英两套都认，标题认不出就退出 2。

长期指令表是同一目录的 `standing-orders.md`：只有一条条 `N. 指令`、不带标题（整份原样贴进派活单，
不带进标题和日志的语言），编号从 1 起递增、一行一条，只往后加，旧行不改不删。只由主对话经 standing
写；连做工单时每次派活整份原样贴进派活单。写入顺序同 wait：先写日志再写表，表没写成时报错里给出修法
（顶替那一行再 standing）。pending 按编号对账两个方向（日志说进了第 N 条、表里没有；表里第 N 条、
日志里没有对应的行，被顶替的行不算），对不上时 standing 不追加、退出 2 并给出修法，编号不会被另一条占用。

阶段格跟着用户的语言：中文日志里写纯英文的阶段格（有英文字母、没有汉字）时，add / supersede /
ack / wait / resolve / standing 在标准错误里提醒，照样记下。

自查行（决定格以「日志自查」/ `log self-check` 开头）的结果格写了「逐行」「全部对照」一类的笼统字样，
或没写「自查时打开：」「没打开：」（`opened during the check:`、`not opened:`）时，add / supersede / ack
在标准错误里提醒，照样记下；结果格写着没有对照聊天记录的也一样。
自查行写了这两个标签之一时，还对照这次运行在它之前写的各行的证据指针（同 run 列出的）：认得出的指针
在结果格里从第一个标签起到末尾都没出现的，逐个提醒（同一个指针几行都有时一条点出那几行），照样记下。
证据格先按分号（；;）拆；顿号、逗号（、，, ）只在拆出的每段都认得出时再拆，「第 1、2 条」整段不拆。
认得出（checkable）的是三种：提交号（7–40 位小写十六进制、字母数字都有，前后紧挨 `-` 的是 UUID 的一段、
不算），对照时互为前缀就算出现；文件——扩展名得是常见的代码、文档、配置、补丁扩展名（FILE_EXTS；`e.g`、
`v2.x`、`done.Next`、域名不算），不带目录时主名不能是一个首字母大写的词（`Node.js` 这类框架名不算；
代价是 `Main.java` 这类不带目录的写法认不出、少提醒），写出路径或文件名就算（行号不管怎么写）；
「等你处理第 N 条」/ `waiting-on-you`，写到「等你处理」/ `waiting-on-you` 就算。一段里有一个认得出的指针出现就算这段出现了。认不出的段（审查报告
第几条、测试命令等）不提醒：拆不准时宁可少提醒，不把整段当漏列。
自查行的「没打开：」那一段（从标签起，到它后面的「自查时打开：」为止）按分号（；;）拆成一项项，注明了已顶替的项
（写到「顶替」/ `supersed`）不看；其余项里写了「已当场复核」一类说法（「当场复核/核实/核对/核过/验证/重跑」、
「已复核/核实/核对/核过」、`on the spot`、`already verified/checked/rechecked`），或列了子代理的报告（「实现者报告」
「审查报告」「Spec 报告」这类带角色的报告、「来自报告」、`implementer's report`、`review report`、`per the report`）
而这次运行在自查行之前写的行里有证据格带报告指针（认法同上）、自己结果格没写「来自报告」/ `per the report`、也没被
结果格这样写的顶替行顶替的，再提醒一句：只来自报告、当场核不了的结论要追加「来自报告」顶替行，列进「没打开：」或
写「已当场复核」都不算（点不出是哪一行），照样记下；同时有漏列提醒时，漏列那段收尾不再重复「来自报告」那句。
所以照规矩做了仍会提醒的只有两种：「没打开：」里写了核过了的说法而那一项没注明已顶替；报告指针所在的行都顶替了，
但又有别的行带报告指针没顶替（报告不分是哪一份）。「已当场复核」只在「没打开：」那段里认：写在「自查时打开：」里、
带着核它的命令的当场复核正是该有的写法；只在「没打开：」里说核过了，等于没给命令，也代替不了顶替行。

每次运行写的第一行必须是 start 行：add / supersede / ack / wait / resolve / standing 发现最后一段
不是这次对话的，就照 start 先补一行 start 行，同样先打印最后几行与有没有别的对话插写：
这次对话还没写过 start 时接着写这一行；这次对话写过、别的对话在这之后插写过时只补 start 行、
这一行不写、退出 2，读完再跑一次同一条命令。这一行本身不合规（参数不对、指向的时间不存在等）
就 start 行也不补。没东西要记的对话因此不留下孤零零的 start 行。日志还没有时不补，要先跑
start --lang。查不到对话编号时，最后一段的 start 行记的是某个具体对话就先补一行证据格写明查不到的
start 行再写（免得这一行算到那个对话名下）；最后一段的 start 行已经写着查不到、或日志里还没有 start
行时不补。

所有命令都接受 `--task-dir <仓库相对的任务目录>`（缺省问 `task.py current`）与
`--session <对话编号>`（缺省取 ATW 的对话标识：`ATW_CONTEXT_ID` 或平台给的会话编号）。

写日志、清单或长期指令表的命令（start、add、supersede、ack、wait、resolve、standing）从读文件、检查、补 start 行、
算时间到写完，整段拿着这个任务的锁：`.atw/.runtime/decision-log-locks/<任务目录名>.lock`，
独占创建、写完删掉。拿不到时每隔一会儿重试，最多等 ATW_DECISION_LOG_LOCK_TIMEOUT_S 秒（缺省 10），
超时报错、文件不动。锁里记着持锁的进程号：那个进程已不在，就当作异常退出留下的、接管；
进程还在时锁再旧也不接管。Windows 上不查进程、或进程号认不出时，锁比 LOCK_STALE_S 秒还旧
才接管。文件都先写同目录临时文件再整体换上，写到一半被打断时文件是写前或写后的完整样子。

退出码：0 成功；2 没写成或没取到（没有任务、日志表头或清单标题认不出、参数不对、日志里
没有这次对话的 start 行、写行命令遇到别的对话插写过（只补了 start 行）、清单里没有那一条或已勾掉、
等锁超时）。
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
import uuid
from contextlib import contextmanager, nullcontext
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

from common import configure_encoding
from common.active_task import DIR_RUNTIME, resolve_context_key
from common.io import write_text_atomic
from common.noob_mode import is_noob_mode_on
from common.paths import DIR_SCRIPTS, DIR_WORKFLOW, get_repo_root

EXIT_OK = 0
EXIT_ERROR = 2

LOG_NAME = "decision-log.md"
START_PHASE = "start"
# start 时给出的最后几行
TAIL_ROWS = 5
# 顶替行决定格的开头（写法见 LANGS 的 supersedes），取出被顶替的时间
SUPERSEDES_RE = re.compile(r"^顶替 (\S+) 那一行：|^supersedes (\S+): ")
# 认可行决定格的开头（写法见 LANGS 的 ack_one / ack_many），取出被认可的那几个时间
ACKS_RE = re.compile(r"^认可 (\S+) 那[一几]行：|^acknowledges (.+?): ")
ACK_TIME_SEP_RE = re.compile(r"、|, ")
# 对账认的两种行（工单 04）：登记行的结果格、勾掉行的决定格（写法见 LANGS 的 wait_added / wait_resolved）
WAIT_ADDED_RE = re.compile(r"^进「等你处理」第 (\d+) 条$|^added to waiting-on-you as item (\d+)$")
WAIT_RESOLVED_RE = re.compile(r"^勾掉「等你处理」第 (\d+) 条：(.*)$|^checked off waiting-on-you item (\d+): (.*)$")
# 对账认的长期指令行（工单 07）：追加那一行的结果格（写法见 LANGS 的 standing_added）
STANDING_ADDED_RE = re.compile(r"^进长期指令第 (\d+) 条$|^added to standing orders as item (\d+)$")


@dataclass(frozen=True)
class Lang:
    title: str
    header: tuple[str, ...]
    start_decision: str
    start_why: str
    log_begins: str
    prior_range: str  # {a} {b}
    no_session: str
    no_transcript: str  # 读不了聊天记录时自查行结果格的开头
    marks: dict[str, str]
    supersedes: str  # {t}
    ack_one: str  # {t}
    ack_many: str  # {ts}
    time_sep: str
    wait_added: str  # {n}：记进清单那一行的结果格
    wait_resolved: str  # {n} {title}：勾掉那一行的决定格
    wait_resolved_result: str
    standing_added: str  # {n}：追加长期指令那一行的结果格


LANGS: dict[str, Lang] = {
    "zh": Lang(
        title="# 决定日志",
        header=("时间", "阶段", "决定", "理由", "证据", "结果"),
        start_decision="这次运行接着记",
        start_why="标出哪段是这次运行写的",
        log_begins="这份日志从这里开始",
        prior_range="前面 {a} 至 {b} 不是这次运行写的",
        no_session="对话编号查不到",
        no_transcript="没有对照聊天记录：<原因>",
        marks={"needs-you": "待你确认：", "unsure": "拿不准："},
        supersedes="顶替 {t} 那一行：",
        ack_one="认可 {t} 那一行：",
        ack_many="认可 {ts} 那几行：",
        time_sep="、",
        wait_added="进「等你处理」第 {n} 条",
        wait_resolved="勾掉「等你处理」第 {n} 条：{title}",
        wait_resolved_result="已处理",
        standing_added="进长期指令第 {n} 条",
    ),
    "en": Lang(
        title="# Decision log",
        header=("time", "phase", "decision", "why", "evidence", "result"),
        start_decision="this run continues the log",
        start_why="marks which rows this run wrote",
        log_begins="the log starts here",
        prior_range="rows {a} to {b} were not written by this run",
        no_session="session id unavailable",
        no_transcript="not checked against the transcript: <reason>",
        marks={"needs-you": "needs-you: ", "unsure": "unsure: "},
        supersedes="supersedes {t}: ",
        ack_one="acknowledges {t}: ",
        ack_many="acknowledges {ts}: ",
        time_sep=", ",
        wait_added="added to waiting-on-you as item {n}",
        wait_resolved="checked off waiting-on-you item {n}: {title}",
        wait_resolved_result="handled",
        standing_added="added to standing orders as item {n}",
    ),
}


WAIT_NAME = "waiting-on-you.md"
# 长期指令表（absorb-gaps-round-2 工单 07）：只有一行行「N. 指令」，不带标题，整份原样贴进派活单
STANDING_NAME = "standing-orders.md"
STANDING_ITEM_RE = re.compile(r"^(\d+)\. (.*)$")
# 清单每条的字段，按写出的顺序；reply 只在勾掉时写
WAIT_FIELDS = (
    "ask", "why", "options", "default", "if_ignored", "prereq", "irreversible",
    "placeholders", "commands", "tickets", "category", "log_time", "reply",
)
# 照原样的多值字段：每个值一行、包在反引号里
CODE_LIST_FIELDS = ("placeholders", "commands")
# E 节的类别，按 E 节的顺序
CATEGORIES = (
    "account-key-paid", "design-choice", "manual-test", "legal", "your-step",
    "unresolved-review", "skipped-ticket", "log-review-failed", "other",
)
PLACEHOLDER_RE = re.compile(r"^\S.*:\d+$")
# 回来后输入的 skill 命令：三种工具的写法（`/skill:`、`/`、`$`）后接 atw-<名字>，再接空白或结尾
SKILL_INPUT_RE = re.compile(r"^(?:/skill:|/|\$)(atw-[a-z0-9-]+(?:\s.*)?)$")
# 阶段格跟着日志的语言（prd B 节）：中文日志里有英文字母、没有一个汉字的算纯英文
HAN_RE = re.compile(r"[\u3400-\u9fff\uf900-\ufaff]")
LATIN_RE = re.compile(r"[A-Za-z]")
# 自查行（工单 28、29，prd J 节）：结果格不写笼统字样，列出自查时打开了什么、没打开什么
SELF_CHECK_RE = re.compile(r"^(?:日志自查|log self-check)")
# 「逐条」「row by row」不在其中：自查第 3 步本来就逐条过日志行，说的是日志行、不是读了多少、打开了多少
THOROUGH_RE = re.compile(r"逐行|全部对照|全文|每行证据|各行证据|line by line|every line|in full|every row's evidence", re.I)
OPENED_RE = re.compile(r"自查时打开\s*[:：]|opened during the check\s*:", re.I)
NOT_OPENED_RE = re.compile(r"没打开\s*[:：]|not opened\s*:", re.I)
# 「没打开：」里的报告类指针与「已当场复核」一类说法（工单 32）：只来自报告的结论要追加「来自报告」顶替行，
# 列进「没打开：」或说核过了都不算。报告只认带角色的（实现者、审查、复查、子代理、Spec、Standards）与
# 「来自报告」/ per the report；说法只认「当场复核」「已核实」一类，英文认 on the spot 与 already verified 一类
FROM_REPORT_RE = re.compile(
    r"(?:实现者?|审查员?|复查员?|子代理|Spec|Standards)\s*(?:的\s*)?(?:审查\s*)?报告|来自报告"
    r"|\b(?:implementer|implementation|review|reviewer|sub-?agent|spec|standards)(?:'s|s')?\s+(?:review\s+)?reports?\b"
    r"|\b(?:per|from) the report\b", re.I)
CHECKED_CLAIM_RE = re.compile(
    r"当场(?:复核|核实|核对|核过|验证|重跑)|已(?:经)?(?:复核|核实|核对|核过)"
    r"|\bon the spot\b|\balready (?:verified|re-?checked|checked)\b", re.I)
# 行的结果格写明了结论来自报告；「没打开：」那一项注明了已顶替
FROM_REPORT_MARK_RE = re.compile(r"来自报告|\bper the report\b", re.I)
SUPERSEDED_NOTE_RE = re.compile(r"顶替|supersed", re.I)
# 证据格拆指针（工单 31）：先按分号拆；顿号、逗号只在拆出的每段都认得出时再拆（「第 1、2 条」不拆）
POINTER_SEP_RE = re.compile(r"[；;]")
POINTER_LIST_SEP_RE = re.compile(r"、|，|, ")
# 认得出的三种指针：提交号（7–40 位十六进制、字母数字都有；前后紧挨 `-` 的是 UUID 的一段，不算）、
# 文件（扩展名在 FILE_EXTS 里）、「等你处理」第几条
SHA_RE = re.compile(r"(?<![0-9A-Za-z_\-])[0-9a-f]{7,40}(?![0-9A-Za-z_\-])")
PATH_RE = re.compile(r"(?<![A-Za-z0-9_.\-/])[A-Za-z0-9_.\-/]*[A-Za-z0-9_\-]\.([A-Za-z][A-Za-z0-9]*)(?![A-Za-z0-9_\-/])")
# 只认常见代码、文档、配置、补丁的扩展名：`e.g`、`v2.x`、`done.Next`、域名（`chinhae.cc`、`.com`）都不是文件
FILE_EXTS = frozenset((
    "py pyi ts tsx mts cts js jsx mjs cjs json jsonl md mdx txt yaml yml toml ini cfg lock sh bash zsh "
    "patch diff log csv tsv sql html htm css scss vue svelte go rs java kt swift rb php c h cpp hpp xml svg"
).split())
# 不带目录、主名是一个首字母大写的词（`Node.js`、`Next.js`、`Vue.js`）的是框架名，不是文件
BARE_WORD_STEM_RE = re.compile(r"[A-Z][a-z0-9]*")
WAITING_ITEM_RE = re.compile(r"等你处理(?:清单)?\s*第|waiting-on-you", re.I)
# 自查行的清单里写到「等你处理」就算提到了第几条
WAITING_MENTION_RE = re.compile(r"等你处理|waiting-on-you", re.I)
# atw mem 的 --tools 读法验证过的四个平台（Claude Code、Codex、pi、omp），只给这几个数行数（prd P 节）
VERIFIED_TOOLS_PLATFORMS = ("claude", "codex", "pi", "omp")
# run 数聊天记录行数时等 atw mem extract 的秒数（同 cross_model_review 的 PROBE_TIMEOUT_S 写法，测试可缩短）
MEM_TIMEOUT_S = float(os.environ.get("ATW_DECISION_LOG_MEM_TIMEOUT_S") or 60)
# 写命令的锁（prd D 节）：放在不进版本记录的 .atw/.runtime/ 下，一个任务一把
LOCK_DIR = "decision-log-locks"
WRITE_COMMANDS = ("start", "add", "supersede", "ack", "wait", "resolve", "standing")
# 拿不到锁时总共等的秒数（测试可缩短）与重试间隔
LOCK_TIMEOUT_S = float(os.environ.get("ATW_DECISION_LOG_LOCK_TIMEOUT_S") or 10)
LOCK_POLL_S = 0.05
# 认不出持锁进程（Windows、进程号没写上）时按年龄判断：锁里的活几毫秒就做完，比这还旧的锁当作异常退出留下的
LOCK_STALE_S = 10
ITEM_RE = re.compile(r"^- \[([ xX])\] \*\*(\d+)\. (.*)\*\*$")
SUB_VALUE_RE = re.compile(r"^    - (.*)$")


@dataclass(frozen=True)
class WaitLang:
    title: str
    intro: str
    labels: dict[str, str]
    # 「回来后可以输入」每条命令前注明在哪儿输：skill 命令在和 AI 的对话里输，其余自己在终端里运行
    command_kinds: dict[str, str]
    field_sep: str
    unknown: str
    none: str
    list_sep: str
    categories: dict[str, str]


WAIT_LANGS: dict[str, WaitLang] = {
    "zh": WaitLang(
        title="# 等你处理",
        intro=(
            "AI 替不了、要你来办的事。怎么答复：\n\n"
            "- 要你拍板的：直接在对话里告诉 AI 你选哪个，例如「第 1 条按 B」。\n"
            "- 要你动手的（填账号密钥、真机核对之类）：做完在对话里告诉 AI，它核对过再勾掉。\n"
            "- 不用一直跑下去，也不用自己改这份清单。答复完想让 AI 接着做剩下的，再输入标着「在和 AI 的对话里输入」"
            "的那条命令；标着「自己在终端里运行」的，要你自己在终端里敲。\n\n"
            "处理完的条目会勾上并写下你的答复，不删。"
        ),
        labels={
            "ask": "要你做什么",
            "why": "为什么卡在你这儿",
            "options": "选项",
            "default": "默认（AI 先按这个做了）",
            "if_ignored": "不处理会怎样",
            "prereq": "要先做什么",
            "irreversible": "哪一步撤不回",
            "placeholders": "占位在哪",
            "commands": "回来后可以输入",
            "tickets": "在等它的工单",
            "category": "类别",
            "log_time": "对应日志行",
            "reply": "你的答复",
        },
        command_kinds={"chat": "在和 AI 的对话里输入 ", "terminal": "自己在终端里运行 "},
        field_sep="：",
        unknown="不知道",
        none="无",
        list_sep="、",
        categories={
            "account-key-paid": "外部账号·密钥·付费",
            "design-choice": "设计或产品选择",
            "manual-test": "手动测试",
            "legal": "法律决定",
            "your-step": "留给你的一步",
            "unresolved-review": "没解决的审查问题",
            "skipped-ticket": "跳过的工单",
            "log-review-failed": "日志复查没做成",
            "other": "其他",
        },
    ),
    "en": WaitLang(
        title="# Waiting on you",
        intro=(
            "Things the AI cannot do for you. How to answer:\n\n"
            "- Something for you to decide: tell the AI in the chat which option you pick, e.g. \"item 1: go with B\".\n"
            "- Something for you to do (an account key to fill in, a check on the real device): do it, then tell "
            "the AI in the chat; it checks and then ticks it off.\n"
            "- Nothing has to keep running, and you do not edit this list yourself. Once you have answered, if you "
            "want the AI to carry on with the rest, type the command marked \"type in the chat with the AI\"; "
            "one marked \"run yourself in a terminal\" is for you to type in a terminal.\n\n"
            "Handled items get checked off with your reply and stay here."
        ),
        labels={
            "ask": "What you need to do",
            "why": "Why it is on you",
            "options": "Options",
            "default": "Default (what the AI went with)",
            "if_ignored": "If you leave it",
            "prereq": "What has to happen first",
            "irreversible": "What cannot be undone",
            "placeholders": "Placeholders",
            "commands": "Commands to run when you are back",
            "tickets": "Tickets waiting on it",
            "category": "Category",
            "log_time": "Log row",
            "reply": "Your reply",
        },
        command_kinds={"chat": "type in the chat with the AI ", "terminal": "run yourself in a terminal "},
        field_sep=": ",
        unknown="unknown",
        none="none",
        list_sep=", ",
        categories={
            "account-key-paid": "external account · key · payment",
            "design-choice": "design or product choice",
            "manual-test": "manual test",
            "legal": "legal decision",
            "your-step": "a step left for you",
            "unresolved-review": "unresolved review finding",
            "skipped-ticket": "skipped ticket",
            "log-review-failed": "log review not done",
            "other": "other",
        },
    ),
}


class LogError(Exception):
    """main 统一转成退出码 2。"""


@dataclass
class WaitItem:
    number: int
    done: bool
    title: str
    fields: dict[str, object]
    start: int  # 标题那一行的下标
    end: int  # 这一条最后一个非空行的下标 + 1


@dataclass
class Row:
    time: datetime
    raw_time: str
    phase: str
    decision: str
    why: str
    evidence: str
    result: str


# ---------------------------------------------------------------------------
# 读与写
# ---------------------------------------------------------------------------

def split_cells(line: str) -> list[str]:
    """一行表格拆成格子：只按没转义的竖线切。"""
    body = line.strip()
    if body.startswith("|"):
        body = body[1:]
    if body.endswith("|") and not body.endswith("\\|"):
        body = body[:-1]
    cells: list[str] = []
    cur = ""
    i = 0
    while i < len(body):
        ch = body[i]
        if ch == "\\" and i + 1 < len(body) and body[i + 1] == "|":
            cur += "\\|"
            i += 2
            continue
        if ch == "|":
            cells.append(cur.strip())
            cur = ""
        else:
            cur += ch
        i += 1
    cells.append(cur.strip())
    return cells


def one_line(text: str) -> str:
    """换行合成空格、去首尾空白。"""
    return " ".join(text.replace("\r\n", "\n").replace("\r", "\n").split("\n")).strip()


def cell(text: str) -> str:
    """格子只占一行：换行合成空格、转义竖线、去首尾空白。"""
    return one_line(text).replace("|", "\\|")


def format_row(cells: list[str]) -> str:
    return "| " + " | ".join(cells) + " |"


def read_log(path: Path) -> tuple[str, list[Row]] | None:
    """日志不存在返回 None；存在则返回 (语言, 数据行)。表头认不出就报错，不往坏文件里写。"""
    if not path.is_file():
        return None
    lines = path.read_text(encoding="utf-8").splitlines()
    lang: str | None = None
    header_at = -1
    for i, line in enumerate(lines):
        if not line.strip().startswith("|"):
            continue
        cells = tuple(split_cells(line))
        for code, spec in LANGS.items():
            if cells == spec.header:
                lang = code
                header_at = i
        break
    if lang is None:
        raise LogError(f"{path} 里认不出决定日志的表头（中文或英文六栏），不往里写")
    rows: list[Row] = []
    for line in lines[header_at + 2:]:
        if not line.strip().startswith("|"):
            continue
        cells = split_cells(line)
        if len(cells) != 6:
            raise LogError(f"{path} 里有一行不是六栏：{line.strip()[:60]}")
        try:
            when = datetime.fromisoformat(cells[0])
        except ValueError:
            raise LogError(f"{path} 里有一行的时间认不出：{cells[0]}")
        rows.append(Row(when, cells[0], *cells[1:]))
    return lang, rows


def next_time(rows: list[Row]) -> str:
    """本地时间带时区、到秒；不晚于上一行时取上一行加一秒，保证严格递增。"""
    now = datetime.now().astimezone().replace(microsecond=0)
    if rows:
        floor = rows[-1].time + timedelta(seconds=1)
        if now < floor:
            now = floor.astimezone(now.tzinfo)
    return now.isoformat(timespec="seconds")


def append_row(path: Path, rows: list[Row], cells: list[str]) -> str:
    """往已有的日志追加一行，返回它的时间。"""
    when = next_time(rows)
    line = format_row([when] + [cell(c) for c in cells])
    text = path.read_text(encoding="utf-8")
    if not text.endswith("\n"):
        text += "\n"
    write_file(path, text + line + "\n")
    return when


def write_file(path: Path, text: str) -> None:
    """先写同目录临时文件再整体换上；没写成就报错，原文件不动。"""
    if not write_text_atomic(path, text):
        raise LogError(f"{path} 没写成（临时文件写不了或换不上），原文件没动")


def read_lock(path: Path) -> str | None:
    """锁文件的内容；锁已不在返回 None，读不了返回空串（按认不出进程号处理）。"""
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return None
    except OSError:
        return ""


def holder_pid(seen: str) -> int | None:
    """锁里记的持锁进程号；没写或认不出返回 None。"""
    first = seen.split()[0] if seen.split() else ""
    return int(first) if first.isdigit() and 0 < int(first) < 2 ** 31 else None


def pid_alive(pid: int) -> bool:
    """进程还在返回 True；没权限给它发信号也说明它在。只在非 Windows 上用。"""
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def lock_is_stale(path: Path, seen: str) -> bool:
    """持锁进程已不在，或认不出持锁进程时锁太旧：当作异常退出留下的。"""
    try:
        age = time.time() - path.stat().st_mtime
    except FileNotFoundError:
        return False
    pid = holder_pid(seen)
    # 认得出进程号时只看进程在不在：被挂起、休眠的持锁进程醒来还会接着写，不按年龄抢。
    # Windows 上 os.kill(pid, 0) 会发 Ctrl-C，不拿它查进程，只看锁的新旧
    if os.name != "nt" and pid is not None:
        return not pid_alive(pid)
    return age > LOCK_STALE_S


def take_over(path: Path, seen: str) -> None:
    """挪走判定为死锁的那把锁；挪走的若已是别人刚拿到的新锁，放回去，放不回去就报错。

    不是绝对互斥：两个进程都把同一把死锁判为该接管时，先挪的拿到新锁，后挪的会挪走这把新锁再放回；
    放回之前若又有第三个进程建了锁，就放不回去——这时报错不写，但刚拿到锁的那个进程已失去锁文件，
    可能和第三个进程同时写。三方交错在几毫秒内才会发生，需求不要求绝对互斥。
    """
    aside = path.with_name(f"{path.name}.{os.getpid()}.stale")
    try:
        os.replace(path, aside)
    except FileNotFoundError:
        return
    try:
        if aside.read_text(encoding="utf-8") != seen:
            try:
                os.link(aside, path)
            except OSError as e:
                raise LogError(f"接管锁 {path} 时挪走了别的进程刚拿到的锁，放不回去（{e}）："
                               "没写，稍后再跑同一条命令")
    finally:
        aside.unlink(missing_ok=True)


def create_lock(path: Path) -> int | None:
    """独占创建锁文件，返回文件描述符；锁已在返回 None（Windows 上正被删的锁文件报 PermissionError，同样算在）。"""
    try:
        return os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except (FileExistsError, PermissionError):
        return None


@contextmanager
def log_lock(root: Path, task: Path) -> Iterator[None]:
    """这个任务的决定日志与「等你处理」清单的写锁：独占创建锁文件，等不到就报错。"""
    path = root / DIR_WORKFLOW / DIR_RUNTIME / LOCK_DIR / f"{task.name}.lock"
    path.parent.mkdir(parents=True, exist_ok=True)
    deadline = time.monotonic() + LOCK_TIMEOUT_S
    while True:
        fd = create_lock(path)
        if fd is not None:
            break
        seen = read_lock(path)
        if seen is not None and lock_is_stale(path, seen):
            take_over(path, seen)
            continue
        # 锁不在却建不成（刚被释放，或锁目录没写权限）同样受等待上限约束、隔一会儿再试，不空转
        if time.monotonic() >= deadline:
            if seen is None:
                raise LogError(f"建不了锁文件 {path}：等了 {LOCK_TIMEOUT_S:g} 秒，锁不在却一直建不成，"
                               "看看这个目录能不能写")
            raise LogError(f"决定日志正被别的进程写：锁 {path} 等了 {LOCK_TIMEOUT_S:g} 秒还在。稍后再跑同一条命令；"
                           "确认没有别的进程在写时可以删掉这个锁文件")
        time.sleep(LOCK_POLL_S)
    token = f"{os.getpid()} {uuid.uuid4().hex}\n"
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(token)
    try:
        yield
    finally:
        # 只删自己的锁：这把锁被当作死锁接管过时不删别人的
        if read_lock(path) == token:
            path.unlink(missing_ok=True)


def create_log(path: Path, lang_code: str) -> None:
    spec = LANGS[lang_code]
    head = f"{spec.title}\n\n{format_row(list(spec.header))}\n{format_row(['---'] * 6)}\n"
    write_file(path, head)


def read_waiting(path: Path) -> tuple[str, list[str], list[WaitItem]] | None:
    """清单不存在返回 None；存在则返回 (语言, 各行, 条目)。标题认不出就报错，不往坏文件里写。"""
    if not path.is_file():
        return None
    lines = path.read_text(encoding="utf-8").splitlines()
    first = next((l.strip() for l in lines if l.strip()), "")
    lang = next((code for code, spec in WAIT_LANGS.items() if first == spec.title), None)
    if lang is None:
        raise LogError(f"{path} 的标题认不出（「# 等你处理」或「# Waiting on you」），不往里写")
    spec = WAIT_LANGS[lang]
    categories = {text: slug for slug, text in spec.categories.items()}
    items: list[WaitItem] = []
    cur: WaitItem | None = None
    last_key: str | None = None
    for i, line in enumerate(lines):
        m = ITEM_RE.match(line)
        if m:
            cur = WaitItem(int(m.group(2)), m.group(1) != " ", m.group(3), {}, i, i + 1)
            items.append(cur)
            last_key = None
            continue
        if cur is None or not line.strip():
            continue
        sub = SUB_VALUE_RE.match(line)
        if sub and last_key in CODE_LIST_FIELDS:
            values = cur.fields[last_key]
            assert isinstance(values, list)
            value = sub.group(1).strip()
            if last_key == "commands":
                value = next((value[len(p):] for p in spec.command_kinds.values() if value.startswith(p)), value)
            values.append(value.removeprefix("`").removesuffix("`"))
            cur.end = i + 1
            continue
        for key, label in spec.labels.items():
            head = f"  - {label}{spec.field_sep}"
            if line.rstrip() != head.rstrip() and not line.startswith(head):
                continue
            value = line[len(head):].strip() if line.startswith(head) else ""
            if key in CODE_LIST_FIELDS:
                cur.fields[key] = [] if value in ("", spec.none) else [value.strip("`")]
            elif key == "tickets":
                cur.fields[key] = [] if value == spec.none else value.split(spec.list_sep)
            elif key == "category":
                cur.fields[key] = categories.get(value, value)
            else:
                cur.fields[key] = value
            last_key = key
            cur.end = i + 1
            break
    return lang, lines, items


def command_text(spec: WaitLang, command: str) -> str:
    """一条回来后可输入的命令，前面注明在和 AI 的对话里输入（skill 命令）还是自己在终端里运行。"""
    kind = "chat" if SKILL_INPUT_RE.match(command) else "terminal"
    return f"{spec.command_kinds[kind]}`{command}`"


def render_item(spec: WaitLang, number: int, title: str, fields: dict[str, object]) -> list[str]:
    """清单的一条：勾选框、编号、标题，接着每个字段一行；多值字段每个值一行照原样，命令前注明在哪儿输。"""
    out = [f"- [ ] **{number}. {title}**"]
    for key in WAIT_FIELDS:
        if key not in fields:
            continue
        head = f"  - {spec.labels[key]}{spec.field_sep}"
        value = fields[key]
        if key in CODE_LIST_FIELDS:
            assert isinstance(value, list)
            if value:
                out.append(head.rstrip())
                out.extend(f"    - {command_text(spec, str(v)) if key == 'commands' else f'`{v}`'}" for v in value)
            else:
                out.append(head + spec.none)
        elif key == "tickets":
            assert isinstance(value, list)
            out.append(head + (spec.list_sep.join(value) if value else spec.none))
        elif key == "category":
            out.append(head + spec.categories[str(value)])
        else:
            out.append(head + str(value))
    return out


# ---------------------------------------------------------------------------
# 命令
# ---------------------------------------------------------------------------

def owners(rows: list[Row]) -> list[str | None]:
    """每行归哪次运行：最近一条 start 行（含它自己）的对话编号；第一条 start 之前的归 None。"""
    out: list[str | None] = []
    current: str | None = None
    for r in rows:
        if r.phase == START_PHASE:
            current = r.evidence
        out.append(current)
    return out


def trailing_others(rows: list[Row], session: str | None) -> list[Row]:
    """末尾连续不是这次对话写的那几行；查不到对话编号时算全部。"""
    if session is None:
        return list(rows)
    owner = owners(rows)
    i = len(rows)
    while i > 0 and owner[i - 1] != session:
        i -= 1
    return rows[i:]


def print_tail(path: Path) -> None:
    lines = [l for l in path.read_text(encoding="utf-8").splitlines() if l.strip().startswith("|")]
    tail = lines[2:][-TAIL_ROWS:]
    print(f"最后 {len(tail)} 行：" if tail else "日志里还没有行")
    for line in tail:
        print(line)


def cmd_start(path: Path, lang_code: str | None, session: str | None) -> int:
    existing = read_log(path)
    if existing is None:
        if lang_code is None:
            raise LogError("日志还没有，首次写入要给 --lang zh 或 --lang en（跟着用户的语言）")
        create_log(path, lang_code)
        existing = (lang_code, [])
    lang = LANGS[existing[0]]
    rows = existing[1]
    owner = owners(rows)
    if session is not None and rows and owner[-1] == session:
        start_at = next(r.raw_time for r in reversed(rows) if r.phase == START_PHASE)
        print(f"这次对话已经写过 start 行（{start_at}），不再写")
        print_tail(path)
        print("别的对话插写：没有")
        return EXIT_OK
    write_start(path, lang, rows, session)
    return EXIT_OK


def write_start(path: Path, lang: Lang, rows: list[Row], session: str | None) -> None:
    """写 start 行：先打印最后几行与有没有别的对话插写，结果格写前面不是这次对话写的那几行。"""
    owner = owners(rows)
    others = trailing_others(rows, session)
    if session is None:
        interleave = "别的对话插写：对话编号查不到，没法判断"
    elif others and session in owner:
        interleave = f"别的对话插写：有，{others[0].raw_time} 至 {others[-1].raw_time}"
    else:
        interleave = "别的对话插写：没有"
    print_tail(path)
    print(interleave)
    if others:
        result = lang.prior_range.format(a=others[0].raw_time, b=others[-1].raw_time)
    else:
        result = lang.log_begins
    when = append_row(path, rows, [
        START_PHASE, lang.start_decision, lang.start_why, session or lang.no_session, result,
    ])
    print(f"已写 start 行：{when}")


def cmd_add(path: Path, session: str | None, fields: list[str], mark: str | None,
            refers: str = "", targets: list[str] | None = None) -> int:
    """记一行；refers 为 supersede / ack 时在决定格前写指向 targets 的开头。"""
    when = write_row(path, session, fields, mark, refers, targets)
    print(f"已记：{when}")
    return EXIT_OK


def write_row(path: Path, session: str | None, fields: list[str], mark: str | None,
              refers: str = "", targets: list[str] | None = None) -> str:
    """追加一行并返回它的时间；没写成就抛 LogError、日志不动。"""
    existing = read_log(path)
    if existing is None:
        raise LogError("日志还没有：这次对话先跑 start（带 --lang）")
    lang = LANGS[existing[0]]
    rows = existing[1]
    phase, decision, why, evidence, result = fields
    if targets:
        known = {r.raw_time for r in rows}
        missing = [t for t in targets if t not in known]
        if missing:
            raise LogError(f"日志里没有这个时间的行：{'、'.join(missing)}")
        if refers == "supersede":
            prefix = lang.supersedes.format(t=targets[0])
        elif len(targets) == 1:
            prefix = lang.ack_one.format(t=targets[0])
        else:
            prefix = lang.ack_many.format(ts=lang.time_sep.join(targets))
        decision = prefix + decision.strip()
    if mark:
        result = result.strip()
        # 开头连着的同一种标记（中英哪套都认，可以混排）全部去掉再加一个，免得写成「拿不准：拿不准：」
        # （工单 33）；以另一种标记开头的不动，照样加在前面，这一行按 --mark 算
        same = mark_prefixes(mark)
        while result.startswith(same):
            result = result[len(next(m for m in same if result.startswith(m))):].strip()
        result = lang.marks[mark] + result
    # 每次运行写的第一行必须是 start 行：这次对话没写过、或别的对话在这之后插写过，就照 start
    # 先补一行（工单 24）；放在所有检查之后，没写成的命令不留下孤零零的 start 行
    owner = owners(rows)
    no_session = {spec.no_session for spec in LANGS.values()}
    if session is None and owner and owner[-1] is not None and owner[-1] not in no_session:
        # 查不到编号而最后一段记的是某个具体对话：先补一行「查不到」的 start 行，免得这一行被算到
        # 那个对话名下（工单 05）；最后一段已经是「查不到」的就不补，几次没有编号的运行本就分不开
        write_start(path, lang, rows, None)
        reread = read_log(path)
        assert reread is not None
        rows = reread[1]
    elif session is not None and (not rows or owner[-1] != session):
        write_start(path, lang, rows, session)
        if session in owner:
            # 插写过：先让 AI 读完最后几行与插写报告再写（C 节），这一行不写
            raise LogError("别的对话在这次对话写过之后插写过，已补 start 行：读完上面的最后几行与插写报告，"
                           "再跑一次同一条命令")
        reread = read_log(path)
        assert reread is not None
        rows = reread[1]
    when = append_row(path, rows, [phase, decision, why, evidence, result])
    if refers == "supersede":
        standing_after_supersede(path, existing[0], rows)
    # 只提醒、不拒绝，同工单 22
    for problem in self_check_problems(fields[1], result):
        print(problem, file=sys.stderr)
    if SELF_CHECK_RE.match(fields[1].strip()):
        # 对照的是这一行之前这次运行写的各行（工单 31、32）；两种提醒都出时「来自报告」那句只说一次
        report = from_report_problems(rows, session, result)
        for problem in unlisted_pointers(rows, session, result, mention_report=not report) + report:
            print(problem, file=sys.stderr)
    if existing[0] == "zh" and LATIN_RE.search(phase) and not HAN_RE.search(phase):
        # 只提醒、不拒绝（工单 22）；行写进去之后才说，没写成的不提
        print(f"提醒：阶段格「{one_line(phase)}」是纯英文；这份日志是中文的，阶段格跟着用户的语言写"
              "（如「03 审查」「开跑」）。这一行照样记下了。", file=sys.stderr)
    return when


def standing_after_supersede(path: Path, lang: str, before: list[Row]) -> None:
    """顶替之后长期指令新对不上的，在 stderr 提醒怎么写；只提醒、不拒绝（工单 26）。"""
    orders = read_standing(path.with_name(STANDING_NAME))
    reread = read_log(path)
    assert reread is not None
    old = reconcile_standing(before, orders)
    new = [m for m in reconcile_standing(reread[1], orders) if m not in old]
    if new:
        print("\n".join([REPORT_LANGS[lang].superseded_standing] + [mismatch_text(lang, m) for m in new]),
              file=sys.stderr)


def self_check_problems(decision: str, result: str) -> list[str]:
    """自查行结果格的提醒：写了笼统字样；没列自查时打开了什么、没打开什么。不是自查行的不看。"""
    if not SELF_CHECK_RE.match(decision.strip()):
        return []
    problems = []
    if THOROUGH_RE.search(result):
        problems.append("提醒：自查行的结果格写了「逐行」「全部对照」一类的笼统字样：不写这类字样，"
                        "只写读了聊天记录 X/N 行、自查时打开了什么、没打开什么。这一行照样记下了。")
    if not (OPENED_RE.search(result) and NOT_OPENED_RE.search(result)):
        problems.append("提醒：自查行的结果格没写「自查时打开：」或「没打开：」：列出自查时打开证据跑的命令"
                        "（或打开的证据），再写没打开哪些（都打开了写「没打开：无」）。这一行照样记下了。")
    return problems


def not_opened_list(result: str) -> str:
    """结果格里「没打开：」那一段：从标签起，到它后面的「自查时打开：」（若有）为止；没写标签就是空的。"""
    m = NOT_OPENED_RE.search(result)
    if m is None:
        return ""
    opened = OPENED_RE.search(result, m.end())
    return result[m.end():opened.start() if opened else len(result)]


def unsuperseded_report_rows(rows: list[Row], session: str | None) -> bool:
    """这次运行里有没有证据格带报告指针、结论又没写明来自报告（自己或顶替它的行）的行；分不出这次运行就当没有。"""
    try:
        picked = this_run(rows, session)[0]
    except LogError:
        return False
    marked = {r.raw_time for r in rows if FROM_REPORT_MARK_RE.search(r.result)}
    for r in rows:
        m = SUPERSEDES_RE.match(r.decision)
        if m and FROM_REPORT_MARK_RE.search(r.result):
            marked.add(m.group(1) or m.group(2))
    return any(r.raw_time not in marked and any(FROM_REPORT_RE.search(p) for p in pointers)
               for r, pointers in evidence_pointers(picked))


def from_report_problems(rows: list[Row], session: str | None, result: str) -> list[str]:
    """写自查行时：「没打开：」里说核过了，或列了报告而这次运行还有带报告指针的行没顶替成来自报告，提醒一句（工单 32）。"""
    items = [i for i in POINTER_SEP_RE.split(not_opened_list(result)) if not SUPERSEDED_NOTE_RE.search(i)]
    claimed = any(CHECKED_CLAIM_RE.search(i) for i in items)
    listed = any(FROM_REPORT_RE.search(i) for i in items)
    if not (claimed or (listed and unsuperseded_report_rows(rows, session))):
        return []
    return ["提醒：自查行的「没打开：」里列了子代理的报告，或写了「已当场复核」一类的话：结论只来自报告、"
            "当场核不了的，要追加顶替行写「来自报告」，列进「没打开：」或写「已当场复核」都不算；当场核过的，"
            "在「自查时打开：」里写出核它的那条命令。脚本点不出是哪一行，自己对照。这一行照样记下了。"]


def is_sha(text: str) -> bool:
    return bool(re.search(r"\d", text)) and bool(re.search(r"[a-f]", text))


def is_file(token: str, ext: str) -> bool:
    if ext.lower() not in FILE_EXTS:
        return False
    return "/" in token or not BARE_WORD_STEM_RE.fullmatch(token.rsplit(".", 1)[0])


def pointer_keys(text: str) -> list[tuple[str, str]]:
    """一段证据里认得出的指针：(种类, 值)，种类是 sha、path、waiting；认不出就是空的。"""
    keys = [("sha", m.group(0)) for m in SHA_RE.finditer(text) if is_sha(m.group(0))]
    keys += [("path", m.group(0)) for m in PATH_RE.finditer(text) if is_file(m.group(0), m.group(1))]
    if WAITING_ITEM_RE.search(text):
        keys.append(("waiting", ""))
    return keys


def split_pointers(evidence: str) -> list[str]:
    """证据格拆成一个个指针（工单 31），照原样的写法；拆不准时不拆，整段算一个。"""
    out: list[str] = []
    for piece in POINTER_SEP_RE.split(evidence.replace("\\|", "|")):
        piece = piece.strip()
        if not piece:
            continue
        parts = [p.strip() for p in POINTER_LIST_SEP_RE.split(piece)]
        if len(parts) > 1 and all(pointer_keys(p) for p in parts):
            out += parts
        else:
            out.append(piece)
    return out


def is_self_check_row(decision: str) -> bool:
    """日志里的自查行，顶替、认可自查行的那几行也算。"""
    return bool(SELF_CHECK_RE.match(ACKS_RE.sub("", SUPERSEDES_RE.sub("", decision)).strip()))


def evidence_pointers(picked: list[Row]) -> list[tuple[Row, list[str]]]:
    """这次运行各行的证据指针，供自查第 3 步照着打开；start 行与自查行自己的证据不列。"""
    return [(r, split_pointers(r.evidence)) for r in picked
            if r.phase != START_PHASE and not is_self_check_row(r.decision)]


def mentioned(keys: list[tuple[str, str]], text: str) -> bool:
    """指针在清单文字里出现过没有：提交号互为前缀就算，文件写出路径或文件名就算（行号怎么写都不管），
    「等你处理」写到就算。宁可少提醒：一段里认得出的指针有一个出现就算这一段出现了。"""
    shas = [m.group(0) for m in SHA_RE.finditer(text)]
    for kind, value in keys:
        if kind == "sha" and any(s.startswith(value) or value.startswith(s) for s in shas):
            return True
        if kind == "path" and (value in text or value.rsplit("/", 1)[-1] in text):
            return True
        if kind == "waiting" and WAITING_MENTION_RE.search(text):
            return True
    return False


def unlisted_pointers(rows: list[Row], session: str | None, result: str, mention_report: bool = True) -> list[str]:
    """写自查行时：这次运行各行认得出的证据指针，既不在「自查时打开：」也不在「没打开：」里的，逐个提醒。
    两个标签都没写时不对照（另有提醒）；分不出这次运行的行时也不对照。"""
    labels = [m.start() for rx in (OPENED_RE, NOT_OPENED_RE) for m in [rx.search(result)] if m]
    if not labels:
        return []
    lists = result[min(labels):]
    try:
        picked = this_run(rows, session)[0]
    except LogError:
        return []
    missing: dict[str, list[str]] = {}
    for r, pointers in evidence_pointers(picked):
        for p in pointers:
            keys = pointer_keys(p)
            if keys and not mentioned(keys, lists):
                missing.setdefault(p, []).append(r.raw_time)
    problems = [
        f"提醒：证据「{p}」（{'、'.join(times)} 那{'一' if len(times) == 1 else '几'}行）既不在「自查时打开：」"
        "也不在「没打开：」里。"
        for p, times in missing.items()
    ]
    if problems:
        report = ("结论只来自子代理报告、当场核不了的，追加顶替行写「来自报告」，只列进「没打开：」不算。"
                  if mention_report else "")
        problems.append("提醒：上面的指针自查时打开了就写进「自查时打开：」，没打开就列进「没打开：」；" + report
                        + "脚本只对照认得出的指针（提交号、文件、「等你处理」第几条），其余的自己对照。这一行照样记下了。")
    return problems


def host_form(command: str) -> str:
    """skill 命令改成当前宿主的写法（pi、omp 是 `/skill:`）；不是 skill 命令或认不出宿主时原样。"""
    m = SKILL_INPUT_RE.match(command)
    if m is None:
        return command
    # 延迟导入：cross_model_review 在模块顶层导入了本脚本
    from cross_model_review import detect_host, skill_input
    fixed = skill_input(m.group(1), detect_host()[0]) or command
    if fixed != command:
        print(f"提醒：--command「{command}」改成当前工具的写法「{fixed}」", file=sys.stderr)
    return fixed


def cmd_wait(log_path: Path, wait_path: Path, session: str | None, title: str,
             item: dict[str, object], phase: str, evidence: str) -> int:
    """记进「等你处理」一条，同一条命令里先写对应的日志行（日志写不成就清单也不写）。

    先写日志再写清单（工单 04）：清单那一步没写成时日志里多一行登记，pending 对账报出，
    顶替那一行再重新登记就对上；反过来先写清单的话，断掉后清单里那条没有命令能清。
    """
    existing = read_log(log_path)
    if existing is None:
        raise LogError("日志还没有：这次对话先跑 start（带 --lang），清单的每一条都要有对应的日志行")
    placeholders = item["placeholders"]
    assert isinstance(placeholders, list)
    bad = [p for p in placeholders if not PLACEHOLDER_RE.match(p)]
    if bad:
        raise LogError(f"占位要写成「文件:行」：{'、'.join(bad)}")
    waiting = read_waiting(wait_path)
    # 清单还没有时跟着日志的语言，之后沿用
    lang_code = waiting[0] if waiting else existing[0]
    spec = WAIT_LANGS[lang_code]
    number = max((it.number for it in waiting[2]), default=0) + 1 if waiting else 1
    for key in ("if_ignored", "prereq", "irreversible"):
        if not item[key]:
            item[key] = spec.unknown
    when = write_row(log_path, session, [
        phase, title, str(item["why"]), evidence, LANGS[existing[0]].wait_added.format(n=number),
    ], None)
    item["log_time"] = when
    block = render_item(spec, number, title, item)
    if waiting is None:
        text = f"{spec.title}\n\n{spec.intro}\n"
    else:
        text = "\n".join(waiting[1]).rstrip("\n") + "\n"
    try:
        write_file(wait_path, text + "\n" + "\n".join(block) + "\n")
    except LogError as e:
        raise LogError(f"日志行 {when} 已写，「等你处理」第 {number} 条没写进清单（{e}）：先用 "
                       f"`decision_log.py supersede --time {when}` 顶替那一行，再重新 wait") from e
    print(f"已记「等你处理」第 {number} 条；对应日志行：{when}")
    return EXIT_OK


def cmd_resolve(log_path: Path, wait_path: Path, session: str | None, number: int,
                reply: str, phase: str, evidence: str, result: str | None) -> int:
    """勾掉一条、在末尾写答复，同时追加日志行；条目不删。"""
    waiting = read_waiting(wait_path)
    if waiting is None:
        raise LogError("这个任务还没有「等你处理」清单")
    lang_code, lines, items = waiting
    item = next((it for it in items if it.number == number), None)
    if item is None:
        raise LogError(f"「等你处理」里没有第 {number} 条")
    if item.done:
        raise LogError(f"「等你处理」第 {number} 条已经处理过了，不重复写答复")
    existing = read_log(log_path)
    if existing is None:
        raise LogError("日志还没有：这次对话先跑 start（带 --lang）")
    log_lang = LANGS[existing[0]]
    reply = one_line(reply)
    # 先写日志再勾清单（工单 04）：清单那一步没写成时这一条还开着，pending 对账报出，再跑一次同一条命令；
    # 重跑时日志里已有没被顶替的勾掉行，就只勾清单、不写第二行
    logged = resolved_rows(existing[1]).get(number)
    if logged is not None:
        when = logged[1].raw_time
        print(f"日志里已有勾掉第 {number} 条的行（{when}），不再写，只勾清单")
    else:
        when = write_row(log_path, session, [
            phase, log_lang.wait_resolved.format(n=number, title=item.title), reply, evidence,
            result if result is not None else log_lang.wait_resolved_result,
        ], None)
    spec = WAIT_LANGS[lang_code]
    lines[item.start] = lines[item.start].replace("- [ ]", "- [x]", 1)
    lines.insert(item.end, f"  - {spec.labels['reply']}{spec.field_sep}{reply}")
    try:
        write_file(wait_path, "\n".join(lines) + "\n")
    except LogError as e:
        raise LogError(f"日志行 {when} 已写，「等你处理」第 {number} 条没勾上（{e}）：再跑一次同一条命令") from e
    print(f"已勾掉「等你处理」第 {number} 条；对应日志行：{when}")
    return EXIT_OK


def cmd_standing(log_path: Path, orders_path: Path, session: str | None, order: str,
                 why: str, phase: str, evidence: str, lang_code: str | None) -> int:
    """追加一条长期指令，同一条命令里先写对应的日志行；日志还没有时照 start 先开日志。

    先写日志再写表（同 wait 的写入顺序，工单 04）：表那一步没写成时日志里多一行，pending 按编号对账报出；
    日志与表对不上时不追加、退出 2 并给出修法，免得新的一条占用日志里那一行已经说过的编号。
    """
    order = one_line(order)
    if not order:
        raise LogError("--order 是空的：长期指令要写成一句话")
    existing = read_log(log_path)
    orders = read_standing(orders_path)
    problems = reconcile_standing(existing[1] if existing else [], orders)
    if problems:
        lang = existing[0] if existing else "zh"
        raise LogError("日志与长期指令表对不上，先照修法处理再追加：\n"
                       + "\n".join(f"- {mismatch_text(lang, m)}" for m in problems))
    if existing is None:
        if lang_code is None:
            raise LogError("日志还没有，首次写入要给 --lang zh 或 --lang en（跟着用户的语言）")
        cmd_start(log_path, lang_code, session)
        existing = read_log(log_path)
        assert existing is not None
    number = max(orders, default=0) + 1
    when = write_row(log_path, session, [
        phase, order, why, evidence, LANGS[existing[0]].standing_added.format(n=number),
    ], None)
    text = orders_path.read_text(encoding="utf-8") if orders_path.is_file() else ""
    if text and not text.endswith("\n"):
        text += "\n"
    try:
        write_file(orders_path, text + f"{number}. {order}\n")
    except LogError as e:
        raise LogError(f"日志行 {when} 已写，长期指令第 {number} 条没写进表（{e}）：先用 "
                       f"`decision_log.py supersede --time {when}` 顶替那一行，再重新 standing") from e
    print(f"已记进长期指令第 {number} 条；对应日志行：{when}")
    return EXIT_OK


def row_json(r: Row) -> dict[str, str]:
    keys = ("time", "phase", "decision", "why", "evidence", "result")
    # 文件里转义过的竖线还原成原字
    return {k: v.replace("\\|", "|") for k, v in zip(keys, (
        r.raw_time, r.phase, r.decision, r.why, r.evidence, r.result,
    ))}


def superseded_times(rows: list[Row]) -> set[str]:
    out: set[str] = set()
    for r in rows:
        m = SUPERSEDES_RE.match(r.decision)
        if m:
            out.add(m.group(1) or m.group(2))
    return out


def acked_times(rows: list[Row]) -> set[str]:
    out: set[str] = set()
    for r in rows:
        m = ACKS_RE.match(r.decision)
        if m:
            out.update(ACK_TIME_SEP_RE.split(m.group(1) or m.group(2)))
    return out


def mark_prefixes(mark: str) -> tuple[str, ...]:
    """某种标记的中英两种写法（去掉尾随空格），认标记时都用它。"""
    return tuple(spec.marks[mark].strip() for spec in LANGS.values())


def marked_rows(rows: list[Row], mark: str) -> list[Row]:
    """结果格以某种标记开头的行，中英两种写法都认。"""
    return [r for r in rows if r.result.startswith(mark_prefixes(mark))]


def print_rows(header: tuple[str, ...], rows: list[Row]) -> None:
    print(format_row(list(header)))
    print(format_row(["---"] * 6))
    for r in rows:
        print(format_row([r.raw_time, r.phase, r.decision, r.why, r.evidence, r.result]))


def resolved_rows(rows: list[Row]) -> dict[int, tuple[str, Row]]:
    """没被顶替的勾掉行，按条目编号：(标题, 最后那一行)。对账与重跑 resolve 共用。"""
    gone = superseded_times(rows)
    out: dict[int, tuple[str, Row]] = {}
    for r in rows:
        m = WAIT_RESOLVED_RE.match(r.decision)
        if m and r.raw_time not in gone:
            out[int(m.group(1) or m.group(3))] = ((m.group(2) or m.group(4) or "").replace("\\|", "|"), r)
    return out


def reconcile(rows: list[Row], items: list[WaitItem]) -> list[dict[str, object]]:
    """日志与「等你处理」清单对账（工单 04，prd E 节），对不上的逐条给出 {kind, number, title, log_time}。

    登记按条目的「对应日志行」对上结果格是登记写法的那一行，勾掉按编号对上决定格是勾掉写法的行；
    被顶替的行不算。四种：log-only-added（日志说登记了、清单里没有对应这一行的条目）、
    list-only-added（条目在日志里没有对应的登记行）、log-only-resolved（日志说勾掉了、清单里没有
    勾上的这一条）、list-only-resolved（条目勾上了、日志里没有勾掉它的行）。
    """
    gone = superseded_times(rows)
    added: dict[str, tuple[int, Row]] = {}
    for r in rows:
        m = WAIT_ADDED_RE.match(r.result)
        if m and r.raw_time not in gone:
            added[r.raw_time] = (int(m.group(1) or m.group(2)), r)
    resolved = resolved_rows(rows)
    item_times = {it.fields.get("log_time") for it in items}
    by_number = {it.number: it for it in items}
    out: list[dict[str, object]] = []

    def found(kind: str, number: int, title: str, log_time: object) -> None:
        out.append({"kind": kind, "number": number, "title": title, "log_time": log_time})

    for when, (number, r) in added.items():
        if when not in item_times:
            found("log-only-added", number, r.decision.replace("\\|", "|"), when)
    for it in items:
        if it.fields.get("log_time") not in added:
            found("list-only-added", it.number, it.title, it.fields.get("log_time") or None)
    for number, (title, r) in resolved.items():
        listed = by_number.get(number)
        if listed is None or not listed.done:
            found("log-only-resolved", number, title, r.raw_time)
    for it in items:
        if it.done and it.number not in resolved:
            found("list-only-resolved", it.number, it.title, None)
    return out


def read_standing(path: Path) -> dict[int, str]:
    """长期指令表的各条，按编号；表还没有时为空。"""
    if not path.is_file():
        return {}
    found = (STANDING_ITEM_RE.match(line) for line in path.read_text(encoding="utf-8").splitlines())
    return {int(m.group(1)): m.group(2) for m in found if m}


def reconcile_standing(rows: list[Row], orders: dict[int, str]) -> list[dict[str, object]]:
    """日志与长期指令表按编号对账（工单 07），形状同 reconcile；被顶替的行不算。两种：
    log-only-standing（日志说进了第 N 条、表里没有第 N 条）、list-only-standing（表里第 N 条在日志里没有对应的行）。
    顶替行结果格没写编号时，若被顶替那一行（顺着顶替链）说的第 N 条表里确有，就承接第 N 条的登记（工单 26）；
    表里没有的不承接，「顶替这一行再重新 standing」的修法照旧。
    """
    gone = superseded_times(rows)
    by_time = {r.raw_time: r for r in rows}

    def standing_number(r: Row, seen: set[str]) -> int | None:
        m = STANDING_ADDED_RE.match(r.result)
        if m:
            return int(m.group(1) or m.group(2))
        s = SUPERSEDES_RE.match(r.decision)
        target = by_time.get(s.group(1) or s.group(2)) if s else None
        if target is None or target.raw_time in seen:
            return None
        n = standing_number(target, seen | {r.raw_time})
        return n if n in orders else None

    logged: dict[int, Row] = {}
    for r in rows:
        n = standing_number(r, set())
        if n is not None and r.raw_time not in gone:
            logged[n] = r
    out: list[dict[str, object]] = []
    for number, r in logged.items():
        if number not in orders:
            out.append({"kind": "log-only-standing", "number": number,
                        "title": r.decision.replace("\\|", "|"), "log_time": r.raw_time})
    for number, text in orders.items():
        if number not in logged:
            out.append({"kind": "list-only-standing", "number": number, "title": text, "log_time": None})
    return out


def mismatch_text(lang: str, m: dict[str, object]) -> str:
    """对不上的一处，措辞跟着 lang；没有对应日志行时写「无」。"""
    when = m["log_time"] or WAIT_LANGS[lang].none
    return REPORT_LANGS[lang].mismatch[str(m["kind"])].format(time=when, n=m["number"], title=m["title"])


def item_json(item: WaitItem) -> dict[str, object]:
    out: dict[str, object] = {"number": item.number, "done": item.done, "title": item.title}
    for key in WAIT_FIELDS:
        default: object = [] if key in CODE_LIST_FIELDS or key == "tickets" else None
        out[key] = item.fields.get(key, default)
    return out


LOG_REVIEW_DIR = "log-review"
REPORT_HEADING_RE = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")
FINDING_HEADING_RE = re.compile(r"^#{2,6}\s+(\d+)[.、]\s*(.+?)\s*$")
HANDLED_ITEM_RE = re.compile(r"(?:要改|must fix)\s*第?\s*(\d+)", re.IGNORECASE)


def log_review_findings(text: str) -> tuple[list[tuple[int, str]], set[int]]:
    """一份日志复查报告：「要改」标题下的 `### N. 标题`，以及末尾「已处理」一节里写到的编号。"""
    findings: list[tuple[int, str]] = []
    handled: set[int] = set()
    section: str | None = None
    level = 0
    in_fence = False
    for line in text.splitlines():
        if line.lstrip().startswith(("```", "~~~")):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        head = REPORT_HEADING_RE.match(line)
        if head and (section is None or len(head.group(1)) <= level):
            title = head.group(2).strip().lower()
            if title.startswith(("要改", "must fix")):
                section, level = "must", len(head.group(1))
            elif title.startswith(("已处理", "handled")):
                section, level = "handled", len(head.group(1))
            else:
                section, level = None, 0
            continue
        if section == "must":
            m = FINDING_HEADING_RE.match(line)
            if m:
                findings.append((int(m.group(1)), m.group(2).strip("*_ ")))
        elif section == "handled":
            handled.update(int(n) for n in HANDLED_ITEM_RE.findall(line))
    return findings, handled


def open_must_fix(task: Path) -> list[dict[str, object]]:
    """任务目录 log-review/ 里各份报告还没处理的「要改」，按报告文件名排。"""
    folder = task / LOG_REVIEW_DIR
    out: list[dict[str, object]] = []
    for f in sorted(folder.glob("*.md")) if folder.is_dir() else []:
        findings, handled = log_review_findings(f.read_text(encoding="utf-8"))
        out += [
            {"report": f"{LOG_REVIEW_DIR}/{f.name}", "number": n, "title": title}
            for n, title in findings if n not in handled
        ]
    return out


@dataclass(frozen=True)
class ReportLang:
    headings: tuple[str, str, str, str]  # prd L 节四块，顺序固定
    item: str  # {n} {title}
    mismatches: str  # 第一块里对不上的那一项（工单 04）
    mismatch: dict[str, str]  # reconcile 的四种 kind，各带 {time} {n} {title}；pending 文本也用它
    superseded_standing: str  # supersede 之后长期指令新对不上时 stderr 提醒的开头（工单 26）
    human_tickets: str
    reports: str
    must_fix: str
    must_fix_item: str  # {report} {n} {title}
    fill: str  # {what}：底稿里留给 AI 补的地方
    review_fill: str
    states: dict[str, str]  # 工单状态的写法；skipped 带 {n}
    skipped_unmatched: str
    totals: str  # {n} 与 states 的各个键
    tickets_fill: str
    closing_fill: str
    terms: dict[str, str]  # 小白模式开着时每个流程说法的一句大白话；键同 pending --json 的四项


REPORT_LANGS: dict[str, ReportLang] = {
    "zh": ReportLang(
        headings=("等你处理", "日志复查挑出的问题", "待你确认的条目", "每张工单的状态"),
        item="第 {n} 条：{title}",
        mismatches="日志与清单对不上（按没处理算）",
        mismatch={
            "log-only-added": "日志 {time} 那一行说进了「等你处理」第 {n} 条「{title}」，清单里没有对应这一行的条目；"
                              "修法：`decision_log.py supersede --time {time}` 顶替这一行，再用 `decision_log.py wait` 重新登记",
            "list-only-added": "清单第 {n} 条「{title}」在日志里没有对应的登记行（对应日志行：{time}）",
            "log-only-resolved": "日志 {time} 那一行说勾掉了「等你处理」第 {n} 条「{title}」，清单里没有勾上的第 {n} 条；"
                                 "修法：再跑一次 `decision_log.py resolve --item {n}`",
            "list-only-resolved": "清单第 {n} 条「{title}」已勾掉，日志里没有勾掉它的行",
            "log-only-standing": "日志 {time} 那一行说进了长期指令第 {n} 条「{title}」，长期指令表里没有第 {n} 条；"
                                 "修法：`decision_log.py supersede --time {time}` 顶替这一行，再用 `decision_log.py standing` 重新记",
            "list-only-standing": "长期指令表第 {n} 条「{title}」在日志里没有对应的行；"
                                  "修法：用 `decision_log.py add` 补一行，决定格写这条指令、结果格写「进长期指令第 {n} 条」",
        },
        superseded_standing="提醒：顶替之后日志与长期指令表对不上（这一行照样记下了）。顶替长期指令那一行时，结果格可以写说明、"
                            "不写编号，顶替行承接被顶替那一行的编号；结果格写「进长期指令第 N 条」时，N 照被顶替那一行的编号。"
                            "现在对不上的：",
        human_tickets="要人做、还没做的工单",
        reports="报告",
        must_fix="还没处理的「要改」",
        must_fix_item="{report} 第 {n} 条：{title}",
        fill="（补：{what}）",
        review_fill="照报告先写「要改」「值得考虑」；没做成时写明为什么、怎么补",
        states={"done": "做完", "doing": "进行中", "skipped": "跳过（「等你处理」第 {n} 条）",
                "human": "等人做", "untouched": "没动"},
        skipped_unmatched="跳过（清单里没对上条目）",
        totals="共 {n} 张：做完 {done}、进行中 {doing}、跳过 {skipped}、等人做 {human}、没动 {untouched}",
        tickets_fill="每张的提交号与各轴审查结论；跳过（清单第几条）没对上的，照工单 `## Comments` 补上第几条",
        closing_fill="改动在哪条分支、什么都没推送也没并进主线；下一步：先在对话里答复上面哪几条（例如「第 1 条按 B」），"
                     "答复完想让 AI 接着做剩下的再输入哪条命令，不用一直跑下去",
        terms={
            "waiting": "「等你处理」是 AI 自己办不了、得你来的事（比如缺密码、要你拍板），每条写着要你做什么、"
                       "AI 先按哪个做了；你处理完一条就勾掉一条。",
            "needs_you": "「待你确认」是 AI 替你做的、你自己就能判断的选择（比如需求说得含糊时选了推荐的做法），"
                         "请你看一眼：没问题就不用管，不同意就直接说。",
            "unsure": "「拿不准」是 AI 自己心里没底的技术判断，你未必好判断，可以请另一家公司的 AI 再看一遍。",
            "log_review_must_fix": "「日志复查」是另请一家公司的 AI 只看这次的决定日志（AI 边干边记的做了什么、为什么、"
                                   "证据在哪）和聊天记录，挑说做了其实没做、证据站不住的地方；"
                                   "其中「要改」是它认为不改就不该合进正式代码的问题。",
        },
    ),
    "en": ReportLang(
        headings=("Waiting on you", "What the log review found", "Waiting for your confirmation", "Each ticket"),
        item="Item {n}: {title}",
        mismatches="The log and the waiting-on-you list do not match (counted as not handled)",
        mismatch={
            "log-only-added": "the log row {time} says item {n} \"{title}\" was added to waiting-on-you, "
                              "but the list has no item for that row; to fix: `decision_log.py supersede --time {time}` "
                              "that row, then `decision_log.py wait` again",
            "list-only-added": "list item {n} \"{title}\" has no matching row in the log (its log row: {time})",
            "log-only-resolved": "the log row {time} says waiting-on-you item {n} \"{title}\" was checked off, "
                                 "but the list has no checked-off item {n}; to fix: run `decision_log.py resolve --item {n}` again",
            "list-only-resolved": "list item {n} \"{title}\" is checked off, but the log has no row checking it off",
            "log-only-standing": "the log row {time} says standing order {n} \"{title}\" was added, but standing-orders.md "
                                 "has no line {n}; to fix: `decision_log.py supersede --time {time}` that row, "
                                 "then `decision_log.py standing` again",
            "list-only-standing": "standing order {n} \"{title}\" in standing-orders.md has no matching row in the log; "
                                  "to fix: `decision_log.py add` a row whose decision is that order and whose result is "
                                  "`added to standing orders as item {n}`",
        },
        superseded_standing="note: after this supersede the log and standing-orders.md do not match (the row was logged "
                            "anyway). When superseding a standing-order row, the result may be any note without a number: "
                            "the new row takes over the number of the row it supersedes; if the result says "
                            "`added to standing orders as item N`, N must be that row's number. Now not matching:",
        human_tickets="Tickets waiting on a person, not done yet",
        reports="Reports",
        must_fix="Must fix not yet handled",
        must_fix_item="{report} item {n}: {title}",
        fill="(fill in: {what})",
        review_fill="Must fix and Worth considering first, from the report; when it was not done, why and how to make it up",
        states={"done": "done", "doing": "in progress", "skipped": "skipped (waiting-on-you item {n})",
                "human": "waiting on a person", "untouched": "untouched"},
        skipped_unmatched="skipped (no waiting-on-you item matched)",
        totals="{n} tickets: {done} done, {doing} in progress, {skipped} skipped, {human} waiting on a person, {untouched} untouched",
        tickets_fill="each ticket's commit SHAs and review verdict per axis; a skip with no item matched gets its waiting-on-you item N from the ticket's `## Comments`",
        closing_fill="which branch the changes are on, that nothing was pushed or merged into the base branch; "
                     "what to do next: which items above to answer first, right here in the chat (e.g. \"item 1: go with B\"), "
                     "then which command to type once answered if the AI should carry on with the rest — nothing has to keep running",
        terms={
            "waiting": "\"Waiting on you\" means things the AI could not do without you (a missing key, a choice only you "
                       "can make): each says what you need to do and what the AI went ahead with meanwhile; "
                       "tick one off once it is handled.",
            "needs_you": "\"Waiting for your confirmation\" means a choice the AI made for you that you can judge yourself "
                         "(say, picking the recommended reading of a vague request): look it over; if it is fine there "
                         "is nothing to do, if not, just say so.",
            "unsure": "\"Unsure\" means a technical call the AI is not confident about and you may not be able to judge "
                      "either; an AI from another company can take a second look.",
            "log_review_must_fix": "\"The log review\" means an AI from another company read only this run's decision log "
                                   "(the AI's running notes of what it did, why, and where the proof is) and the chat, "
                                   "looking for things said to be done that were not and proof that does not hold up; "
                                   "\"Must fix\" is what it says has to change before this goes into the main code.",
        },
    ),
}


TICKET_HEADING_RE = re.compile(r"^# \d+\s*[—-]\s*(.+?)\s*$", re.MULTILINE)


def ticket_states(task: Path, items: list[WaitItem]) -> list[tuple[str, str, str, int | None]]:
    """每张工单：(文件名, 编号与标题, 状态, 跳过时对上的清单条目)。解析、状态名与跳过评论的写法都取自工单脚本。

    跳过 = `tickets.py skip` 留下的样子：Status 是 ready-for-human、还没做完、`## Comments` 里有它写的
    跳过评论。条目先按评论里日志行的时间对清单条目的「对应日志行」，对不上再找 `--ticket` 写着这张、
    类别是跳过的条目。
    """
    import tickets  # tickets.py 在模块顶层 import 本脚本，放到这里免得循环导入

    try:
        found = tickets.load_tickets(task / "issues")
    except tickets.TicketError as e:
        raise LogError(f"工单读不出：{e}") from e
    skip_res = [
        re.compile(re.escape(texts["skip"]).replace(re.escape("{reason}"), ".*").replace(re.escape("{time}"), r"(\S+)"))
        for texts in tickets.COMMENT_TEXT.values()
    ]
    by_time = {it.fields.get("log_time"): it.number for it in items}
    out: list[tuple[str, str, str, int | None]] = []
    for t in found:
        text = t.path.read_text(encoding="utf-8")
        heading = TICKET_HEADING_RE.search(text)
        name = f"{t.num:02d} {heading.group(1) if heading else t.label}"
        times = [m.group(1) for r in skip_res for m in r.finditer(text)]
        if t.impl == "done":
            out.append((t.label, name, "done", None))
        elif t.impl == "doing":
            out.append((t.label, name, "doing", None))
        elif t.status == tickets.STATUS_HUMAN and times:
            number = next((by_time[x] for x in reversed(times) if x in by_time), None)
            if number is None:
                number = next((it.number for it in items
                               if it.fields.get("category") in ("skipped-ticket", "legal")
                               and any(v.strip().isdigit() and int(v) == t.num
                                       for v in it.fields.get("tickets") or [])), None)
            out.append((t.label, name, "skipped", number))
        elif t.status == tickets.STATUS_HUMAN:
            out.append((t.label, name, "human", None))
        else:
            out.append((t.label, name, "untouched", None))
    return out


def print_report(lang: str, all_items: list[WaitItem], header: tuple[str, ...], needs_you: list[Row],
                 must_fix: list[dict[str, object]], task: Path, noob: bool = False,
                 mismatches: list[dict[str, object]] | None = None) -> None:
    """汇报底稿：prd L 节的四块按顺序、措辞跟着日志的语言；任务目录里有的填上，其余标「补」。
    小白模式开着时前三块标题下各先附一句大白话，第三块再加「拿不准」那句（工单 23）。
    日志与清单对不上的列在第一块、按没处理算（工单 04）。"""
    rep, spec = REPORT_LANGS[lang], WAIT_LANGS[lang]
    sep = spec.field_sep
    items = [it for it in all_items if not it.done]
    states = ticket_states(task, all_items)
    human = [label for label, _, state, _ in states if state in ("human", "skipped")]
    folder = task / LOG_REVIEW_DIR
    reports = [f"{LOG_REVIEW_DIR}/{f.name}" for f in sorted(folder.glob("*.md"))] if folder.is_dir() else []
    def heading(i: int, *terms: str) -> list[str]:
        return [f"## {rep.headings[i]}", ""] + ([line for t in terms for line in (rep.terms[t], "")] if noob else [])

    out: list[str] = heading(0, "waiting")
    for it in items:
        commands = spec.list_sep.join(command_text(spec, str(c)) for c in it.fields.get("commands") or []) or spec.none
        out += [
            f"- {rep.item.format(n=it.number, title=it.title)}",
            f"  - {spec.labels['ask']}{sep}{it.fields.get('ask', '')}",
            f"  - {spec.labels['default']}{sep}{it.fields.get('default', '')}",
            f"  - {spec.labels['commands']}{sep}{commands}",
        ]
    if mismatches:
        out.append(f"- {rep.mismatches}{sep.rstrip()}")
        out += [f"  - {mismatch_text(lang, m)}" for m in mismatches]
    if not items and not mismatches:
        out.append(f"- {spec.none}")
    out.append(f"- {rep.human_tickets}{sep}{spec.list_sep.join(human) or spec.none}")
    out += ["", *heading(1, "log_review_must_fix")]
    out.append(f"- {rep.reports}{sep}{spec.list_sep.join(reports) or spec.none}")
    if must_fix:
        out.append(f"- {rep.must_fix}{sep.rstrip()}")
        out += [f"  - {rep.must_fix_item.format(report=f['report'], n=f['number'], title=f['title'])}"
                for f in must_fix]
    else:
        out.append(f"- {rep.must_fix}{sep}{spec.none}")
    out.append(f"- {rep.fill.format(what=rep.review_fill)}")
    # 底稿没有「拿不准」一块，它那句跟在同为日志标记的「待你确认」后面，汇报时提到它也有解释可用
    out += ["", *heading(2, "needs_you", "unsure")]
    if needs_you:
        out += [format_row([header[0], header[2], header[3]]), format_row(["---"] * 3)]
        out += [format_row([r.raw_time, r.decision, r.why]) for r in needs_you]
    else:
        out.append(f"- {spec.none}")
    out += ["", f"## {rep.headings[3]}", ""]
    for _, name, state, number in states:
        text = rep.skipped_unmatched if state == "skipped" and number is None else rep.states[state].format(n=number)
        out.append(f"- {name}{sep}{text}")
    if states:
        counts = {key: sum(1 for _, _, state, _ in states if state == key) for key in rep.states}
        out.append(f"- {rep.totals.format(n=len(states), **counts)}")
    else:
        out.append(f"- {spec.none}")
    out.append(f"- {rep.fill.format(what=rep.tickets_fill)}")
    out += ["", rep.fill.format(what=rep.closing_fill)]
    print("\n".join(out))


def cmd_pending(log_path: Path, wait_path: Path, as_json: bool, as_report: bool = False, noob: bool = False) -> int:
    """只读：还没处理的条目，以及还没被认可或顶替的「待你确认」「拿不准」行；供汇报与验收用。"""
    waiting = read_waiting(wait_path)
    open_items: list[WaitItem] = []
    lines: list[str] = []
    if waiting is not None:
        lines = waiting[1]
        open_items = [it for it in waiting[2] if not it.done]
    existing = read_log(log_path)
    header = LANGS[existing[0] if existing else "zh"].header
    rows = existing[1] if existing else []
    closed = superseded_times(rows) | acked_times(rows)
    needs_you = [r for r in marked_rows(rows, "needs-you") if r.raw_time not in closed]
    unsure = [r for r in marked_rows(rows, "unsure") if r.raw_time not in closed]
    must_fix = open_must_fix(log_path.parent)
    wait_mismatches = reconcile(rows, waiting[2] if waiting else [])
    standing_mismatches = reconcile_standing(rows, read_standing(log_path.with_name(STANDING_NAME)))
    mismatches = wait_mismatches + standing_mismatches
    lang = existing[0] if existing else (waiting[0] if waiting else "zh")
    if as_report:
        print_report(lang, waiting[2] if waiting else [], LANGS[lang].header, needs_you, must_fix, log_path.parent, noob,
                     mismatches)
        return EXIT_OK
    if as_json:
        out: dict[str, object] = {
            "waiting": [item_json(it) for it in open_items],
            "needs_you": [row_json(r) for r in needs_you],
            "unsure": [row_json(r) for r in unsure],
            "log_review_must_fix": must_fix,
            "mismatches": mismatches,
        }
        if noob:
            out["terms"] = REPORT_LANGS[lang].terms
        print(json.dumps(out, ensure_ascii=False, indent=2))
        return EXIT_OK
    if open_items:
        print(f"「等你处理」里还没处理的：共 {len(open_items)} 条")
        for it in open_items:
            print()
            print("\n".join(lines[it.start:it.end]))
    else:
        print("「等你处理」里还没处理的：没有")
    print()
    if wait_mismatches:
        print(f"日志与「等你处理」清单对不上的：共 {len(wait_mismatches)} 处，对不上的条目按没处理算")
        for m in wait_mismatches:
            print(f"- {mismatch_text(lang, m)}")
    else:
        print("日志与「等你处理」清单对不上的：没有")
    if standing_mismatches:
        print(f"日志与长期指令表对不上的：共 {len(standing_mismatches)} 处，修好前 standing 不追加")
        for m in standing_mismatches:
            print(f"- {mismatch_text(lang, m)}")
    for name, picked in (("待你确认", needs_you), ("拿不准", unsure)):
        print()
        if not picked:
            print(f"还没被认可或顶替的「{name}」行：没有")
            continue
        print(f"还没被认可或顶替的「{name}」行：共 {len(picked)} 行")
        print_rows(header, picked)
    print()
    if not must_fix:
        print("日志复查报告里还没处理的「要改」：没有")
        return EXIT_OK
    print(f"日志复查报告里还没处理的「要改」：共 {len(must_fix)} 条")
    for f in must_fix:
        print(f"- {f['report']} 第 {f['number']} 条：{f['title']}")
    return EXIT_OK


def cmd_unsure(path: Path, as_json: bool) -> int:
    existing = read_log(path)
    if existing is None:
        raise LogError("日志还没有：这个任务还没有决定日志")
    lang = LANGS[existing[0]]
    rows = existing[1]
    # 只排除被顶替的：用户认可不等于技术上的没底消除了
    superseded = superseded_times(rows)
    picked = [r for r in marked_rows(rows, "unsure") if r.raw_time not in superseded]
    if as_json:
        print(json.dumps({"rows": [row_json(r) for r in picked]}, ensure_ascii=False, indent=2))
        return EXIT_OK
    if not picked:
        print("没有「拿不准」的行（已被顶替的不算）")
        return EXIT_OK
    print(f"「拿不准」的行：共 {len(picked)} 行（已被顶替的不算）")
    print(format_row(list(lang.header)))
    print(format_row(["---"] * 6))
    for r in picked:
        print(format_row([r.raw_time, r.phase, r.decision, r.why, r.evidence, r.result]))
    return EXIT_OK


def transcript_lines(session: str | None, start: str, lang: Lang) -> dict[str, object]:
    """日志自查读聊天记录的那条命令与它此刻输出的总行数（工单 28），只是参考数；数不出时给原因、不猜。

    command 为 None 表示没去调 atw：编号查不到、手动设置的原样值、atw mem 读不了的平台、--tools
    读法没验证过的平台（分法照 cross_model_review 的 _chat_problem）。调了但没数出来时 lines 为 None。
    """
    if session is None:
        return {"command": None, "lines": None, "problem": lang.no_session}
    # 延迟导入：cross_model_review 在模块顶层导入了本脚本
    from cross_model_review import ATW_CONTEXT_PREFIXES, MEM_CONTEXT_PREFIXES, _MEM_NOT_FOUND, _context_from_override
    platform = session.partition("_")[0] if "_" in session else ""
    unread = None
    if platform not in ATW_CONTEXT_PREFIXES:
        unread = f"编号 {session} 不带 ATW 认得的平台前缀，多半是 ATW_CONTEXT_ID 手动设置的原样值"
    elif platform not in MEM_CONTEXT_PREFIXES:
        unread = f"编号 {session} 是 ATW 认得的平台 {platform}，但 atw mem 读不了它的会话"
    elif platform not in VERIFIED_TOOLS_PLATFORMS:
        unread = f"平台 {platform} 不在 atw mem 的 --tools 读法验证过的四个（Claude Code、Codex、pi、omp）之内"
    if unread:
        return {"command": None, "lines": None, "problem": unread}
    args = ["mem", "extract", "--context", session, "--tools", "--after", start]
    command = " ".join(["atw", *args])
    atw = shutil.which("atw")
    if atw is None:
        return {"command": command, "lines": None, "problem": "PATH 上没有 atw"}
    try:
        proc = subprocess.run([atw, *args], stdin=subprocess.DEVNULL, capture_output=True, text=True,
                              encoding="utf-8", errors="replace", timeout=MEM_TIMEOUT_S)
    except subprocess.TimeoutExpired:
        return {"command": command, "lines": None,
                "problem": f"`atw mem extract` {MEM_TIMEOUT_S:g} 秒内没跑完"}
    except OSError as e:
        return {"command": command, "lines": None, "problem": f"atw 起不来（{e.strerror or e}）"}
    if proc.returncode == 0:
        return {"command": command, "lines": len(proc.stdout.splitlines()), "problem": None}
    err = (proc.stderr.strip().splitlines() or [""])[-1]
    if proc.returncode == 2 and _MEM_NOT_FOUND in err:
        problem = f"编号 {session} 对不上任何会话"
        problem += "，多半是 ATW_CONTEXT_ID 手动设置的原样值" if _context_from_override(session) else f"（{err}）"
    else:
        problem = f"`atw mem extract` 退出 {proc.returncode}" + (f"（{err}）" if err else "")
    return {"command": command, "lines": None, "problem": problem}


def this_run(rows: list[Row], session: str | None) -> tuple[list[Row], str | None, str]:
    """这次运行那一段：(各行, 对话编号, 怎么取的)；取不到就抛 LogError。"""
    owner = owners(rows)
    no_session = {spec.no_session for spec in LANGS.values()}
    if session is None or session in no_session:
        # 没有编号的几次运行分不开：只认最后一段、且它的 start 行也没有编号，不拿别的对话充数
        starts = [i for i, r in enumerate(rows) if r.phase == START_PHASE]
        if not starts:
            raise LogError("日志里还没有 start 行")
        if rows[starts[-1]].evidence not in no_session:
            raise LogError(
                f"这次对话的编号查不到，而最后一条 start 行（{rows[starts[-1]].raw_time}）带着对话编号 "
                f"{rows[starts[-1]].evidence}：那一段不是没有编号的对话写的，不拿它充数"
            )
        picked = rows[starts[-1]:]
        session = None
        picked_by = "last-segment-without-session"
    elif session not in owner:
        raise LogError(f"日志里没有对话 {session} 的 start 行：这次对话还没写过日志")
    else:
        picked = [r for r, o in zip(rows, owner) if o == session]
        picked_by = "session"
    return picked, session, picked_by


def cmd_run(path: Path, session: str | None, as_json: bool) -> int:
    existing = read_log(path)
    if existing is None:
        raise LogError("日志还没有：这个任务还没有决定日志")
    lang = LANGS[existing[0]]
    picked, session, picked_by = this_run(existing[1], session)
    evidence = evidence_pointers(picked)
    transcript = transcript_lines(session, picked[0].raw_time, lang)
    if as_json:
        print(json.dumps({
            "session": session,
            "picked_by": picked_by,
            "start": picked[0].raw_time,
            "end": picked[-1].raw_time,
            "rows": [row_json(r) for r in picked],
            "evidence": [
                {"time": r.raw_time, "phase": r.phase,
                 "pointers": [{"text": p, "checkable": bool(pointer_keys(p))} for p in pointers]}
                for r, pointers in evidence
            ],
            "transcript": transcript,
        }, ensure_ascii=False, indent=2))
        return EXIT_OK
    if session is None:
        print("这次对话的编号查不到：按没有编号的最后一段取（最后一条 start 行的证据格也写着查不到）")
    print(f"对话编号：{session or '查不到'}")
    print(f"起：{picked[0].raw_time}")
    print(f"止：{picked[-1].raw_time}")
    print(f"共 {len(picked)} 行")
    if transcript["command"] is not None:
        print(f"聊天记录：`{transcript['command']}`")
    if transcript["lines"] is not None:
        print(f"聊天记录此刻共 {transcript['lines']} 行（参考数：自查行「读了聊天记录 X/N 行」的 N "
              "照你自己那次读取命令输出的总行数写）")
    else:
        what = "读不了" if transcript["command"] is None else "数不出行数"
        print(f"聊天记录{what}：{transcript['problem']}")
        # 数不出行数与读不了一样处理（prd J 节）：只对照证据，原因写进自查行
        print(f"照读不了聊天记录处理：只对照证据，自查行结果格写「{lang.no_transcript}」")
    print(format_row(list(lang.header)))
    print(format_row(["---"] * 6))
    for r in picked:
        print(format_row([r.raw_time, r.phase, r.decision, r.why, r.evidence, r.result]))
    print()
    print("各行的证据指针（自查第 3 步照着逐个打开；自查时没打开的都列进「没打开：」）：")
    for r, pointers in evidence:
        print(f"- {r.raw_time}（{r.phase}）")
        for p in pointers:
            note = "" if pointer_keys(p) else "（脚本认不出是哪个提交、文件或「等你处理」条目，写自查行时不替你对照）"
            print(f"  - {p}{note}")
        if not pointers:
            print("  - （证据格是空的）")
    return EXIT_OK


# ---------------------------------------------------------------------------
# 入口
# ---------------------------------------------------------------------------

def task_dir(root: Path, override: str | None) -> Path:
    """任务目录一律问 task.py，不自己解析 Session Pointer。"""
    if override:
        path = (root / override).resolve()
        if not path.is_dir():
            raise LogError(f"任务目录不存在：{override}")
        return path
    proc = subprocess.run(
        [sys.executable, str(root / DIR_WORKFLOW / DIR_SCRIPTS / "task.py"), "current", "--json"],
        capture_output=True, text=True, cwd=root,
    )
    rel = None
    if proc.returncode == 0:
        try:
            rel = (json.loads(proc.stdout).get("current_task") or {}).get("dir")
        except json.JSONDecodeError:
            rel = None
    if not rel:
        raise LogError("没有当前任务——决定日志要放在任务里；先建任务或用 --task-dir 指定")
    return (root / rel).resolve()


def main(argv: list[str] | None = None) -> int:
    configure_encoding()
    p = argparse.ArgumentParser(description="ATW 决定日志：只往后加的六栏表")
    sub = p.add_subparsers(dest="command", required=True)

    def common(sp: argparse.ArgumentParser) -> None:
        sp.add_argument("--task-dir", help="仓库相对的任务目录，缺省问 task.py current")
        sp.add_argument("--session", help="这次对话的编号，缺省取 ATW 的对话标识")

    sp = sub.add_parser("start", help="写这次运行的 start 行")
    common(sp)
    sp.add_argument("--lang", choices=sorted(LANGS), help="日志还没有时的表头语言，之后沿用")

    def row_fields(sp: argparse.ArgumentParser) -> None:
        common(sp)
        sp.add_argument("--phase", required=True, help="哪张工单、哪一步，如「03 审查」「开跑」")
        sp.add_argument("--decision", required=True)
        sp.add_argument("--why", required=True)
        sp.add_argument("--evidence", required=True, help="只写指针：提交号、文件:行、报告位置")
        sp.add_argument("--result", required=True)
        sp.add_argument("--mark", choices=["needs-you", "unsure"],
                        help="needs-you = 待你确认；unsure = 拿不准")

    row_fields(sub.add_parser("add", help="记一行"))
    sp = sub.add_parser("supersede", help="追加一行顶替某个时间的那一行")
    row_fields(sp)
    sp.add_argument("--time", required=True, help="被顶替那一行的时间")
    sp = sub.add_parser("ack", help="追加一行认可某个（或某几个）时间的行")
    row_fields(sp)
    sp.add_argument("--time", required=True, action="append", help="被认可那一行的时间，可给多次")
    sp = sub.add_parser("run", help="只读：取这次运行那一段的行与起止时间")
    common(sp)
    sp.add_argument("--json", action="store_true", help="给 JSON")
    sp = sub.add_parser("unsure", help="只读：列出没被顶替的「拿不准」行")
    common(sp)
    sp.add_argument("--json", action="store_true", help="给 JSON")
    sp = sub.add_parser("wait", help="记进「等你处理」一条，同时写对应的日志行")
    common(sp)
    sp.add_argument("--title", required=True, help="一句话标题")
    sp.add_argument("--ask", required=True, help="要用户做什么")
    sp.add_argument("--why", required=True, help="为什么卡在用户这儿；也是日志行的理由格")
    sp.add_argument("--options", required=True, help="有哪些选项")
    sp.add_argument("--default", required=True, help="没人回答时 AI 先按哪个做了")
    sp.add_argument("--if-ignored", default="", help="不处理会怎样，缺省写「不知道」")
    sp.add_argument("--prereq", default="", help="要先做什么，缺省写「不知道」")
    sp.add_argument("--irreversible", default="", help="哪一步撤不回，缺省写「不知道」")
    sp.add_argument("--placeholder", action="append", default=[], help="占位在哪，文件:行，可给多次")
    sp.add_argument("--command", dest="commands", action="append", default=[],
                    help="用户回来后可以直接输入的命令，照原样，可给多次")
    sp.add_argument("--ticket", action="append", default=[], help="在等它的工单，可给多次")
    sp.add_argument("--category", required=True, choices=CATEGORIES,
                    help="外部账号·密钥·付费 / 设计或产品选择 / 手动测试 / 法律决定 / "
                         "留给你的一步（推送、合并、发布等红线上的一步） / 没解决的审查问题 / "
                         "跳过的工单 / 日志复查没做成 / 其他")
    sp.add_argument("--phase", required=True, help="日志行的阶段，如「03 实现」")
    sp.add_argument("--evidence", required=True, help="日志行的证据，只写指针")
    sp = sub.add_parser("pending", help="只读：列出没处理的清单条目、还没被认可或顶替的两种标记行与日志复查里没处理的「要改」")
    common(sp)
    shape = sp.add_mutually_exclusive_group()
    shape.add_argument("--json", action="store_true", help="给 JSON")
    shape.add_argument("--report", action="store_true", help="给按四块排好的汇报底稿")
    sp = sub.add_parser("resolve", help="勾掉「等你处理」一条并写答复，同时写对应的日志行")
    common(sp)
    sp.add_argument("--item", required=True, type=int, help="清单条目的编号")
    sp.add_argument("--reply", required=True, help="用户的答复；也是日志行的理由格")
    sp.add_argument("--phase", required=True, help="日志行的阶段，如「验收」")
    sp.add_argument("--evidence", required=True, help="日志行的证据，只写指针")
    sp.add_argument("--result", help="日志行的结果格，缺省写「已处理」；核对过真东西时写核对结果")
    sp = sub.add_parser("standing", help="追加一条长期指令，同时写对应的日志行；只由主对话跑")
    common(sp)
    sp.add_argument("--order", required=True, help="长期指令，一句话；也是日志行的决定格")
    sp.add_argument("--why", required=True, help="日志行的理由：用户怎么说的，或发现自己在重复用户的话")
    sp.add_argument("--phase", required=True, help="日志行的阶段，如「03 实现」")
    sp.add_argument("--evidence", required=True, help="日志行的证据，只写指针")
    sp.add_argument("--lang", choices=sorted(LANGS), help="日志还没有时照 start 先开日志用的表头语言")
    args = p.parse_args(argv)

    try:
        root = get_repo_root()
        task = task_dir(root, args.task_dir)
        path = task / LOG_NAME
        session = args.session or resolve_context_key()
        # 写命令从读文件到写完整段拿着这个任务的锁（prd D 节）
        with log_lock(root, task) if args.command in WRITE_COMMANDS else nullcontext():
            if args.command == "start":
                return cmd_start(path, args.lang, session)
            if args.command == "run":
                return cmd_run(path, session, args.json)
            if args.command == "unsure":
                return cmd_unsure(path, args.json)
            if args.command == "wait":
                item: dict[str, object] = {
                    key: one_line(getattr(args, key))
                    for key in ("ask", "why", "options", "default", "if_ignored", "prereq", "irreversible")
                }
                item["placeholders"] = [one_line(v) for v in args.placeholder]
                item["commands"] = [host_form(one_line(v)) for v in args.commands]
                item["tickets"] = [one_line(v) for v in args.ticket]
                item["category"] = args.category
                return cmd_wait(path, path.with_name(WAIT_NAME), session, one_line(args.title),
                                item, args.phase, args.evidence)
            if args.command == "pending":
                return cmd_pending(path, path.with_name(WAIT_NAME), args.json, args.report, is_noob_mode_on(root))
            if args.command == "resolve":
                return cmd_resolve(path, path.with_name(WAIT_NAME), session, args.item, args.reply,
                                   args.phase, args.evidence, args.result)
            if args.command == "standing":
                return cmd_standing(path, path.with_name(STANDING_NAME), session, args.order, args.why,
                                    args.phase, args.evidence, args.lang)
            fields = [args.phase, args.decision, args.why, args.evidence, args.result]
            if args.command == "add":
                return cmd_add(path, session, fields, args.mark)
            if args.command == "supersede":
                return cmd_add(path, session, fields, args.mark, "supersede", [args.time])
            if args.command == "ack":
                return cmd_add(path, session, fields, args.mark, "ack", args.time)
    except LogError as e:
        print(f"错误：{e}", file=sys.stderr)
        return EXIT_ERROR
    return EXIT_ERROR


if __name__ == "__main__":
    sys.exit(main())
