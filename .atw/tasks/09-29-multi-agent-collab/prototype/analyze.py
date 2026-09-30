# PROTOTYPE — 汇总 runs-*/ 下的实测记录。用法：python3 analyze.py runs-v1
import json, re, sys, pathlib

run_dir = pathlib.Path(sys.argv[1])
DISCOVERY = re.compile(r"(list_providers|list_models|inspect_provider|list_profiles)$")
NATIVE = re.compile(r"^(Task|Agent)$|spawn_agent|^subagent|delegate|collab", re.I)
FOLLOWUP = re.compile(r"(get_agent_status|get_agent_activity|send_agent_prompt|cancel_agent|wait)")
SCENARIO_FILES = {
    "single": [["sum.js"]],
    "same": [["sum.js"], ["format.js"]],
    "cross": [["sum.js"], ["format.js"]],
}


def tool_target(item):
    """返回 (叶子工具名, 入参)；兼容 pi-mcp-adapter 的代理工具。"""
    name = item.get("name", "")
    detail = item.get("detail") or {}
    inp = detail.get("input") if isinstance(detail, dict) else None
    if isinstance(inp, dict) and isinstance(inp.get("tool"), str) and "args" in inp:
        args = inp.get("args") or inp.get("arguments") or {}
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except ValueError:
                args = {}
        return re.sub(r"^paseo_", "", inp["tool"].split("__")[-1].split(".")[-1]), args
    leaf = re.split(r"__|\.", name)[-1]
    leaf = re.sub(r"^paseo_", "", leaf)
    return leaf, inp if isinstance(inp, dict) else {}


rows = []
for f in sorted(run_dir.glob("*-*-*.json")):
    r = json.loads(f.read_text())
    exp = r.get("expected", [])
    tl = r.get("timeline") or []
    creates, discovery, native, perm, followups = [], [], [], [], []
    first_other = None
    for idx, item in enumerate(tl):
        if item["type"] != "tool_call":
            if item["type"] == "assistant_message" and first_other is None and not creates:
                first_other = "assistant"
            continue
        leaf, args = tool_target(item)
        if leaf == "create_agent":
            creates.append({"idx": idx, "args": args, "status": item.get("status")})
        elif DISCOVERY.search(leaf):
            discovery.append(leaf)
        elif leaf == "respond_to_permission":
            perm.append(leaf)
        elif FOLLOWUP.search(leaf):
            followups.append(leaf)
        elif NATIVE.search(item.get("name", "")):
            native.append(item.get("name"))
        elif not creates and first_other is None and leaf not in ("ToolSearch",):
            first_other = item.get("name")
    # 取消子智能体后可能出现重派，按"前 N 次"判定照抄
    head = creates[: len(exp)]
    exact = sum(
        1
        for c, e in zip(head, exp)
        if c["args"].get("provider") == f"{e['provider']}/{e['model']}"
        and (c["args"].get("settings") or {}) == e["settings"]
    )
    files_ok = []
    for c, needles in zip(head, SCENARIO_FILES.get(r["scenario"], [])):
        prompt = c["args"].get("initialPrompt") or ""
        files_ok.append(all(n in prompt for n in needles))
    rows.append(
        {
            "run": r["runId"],
            "parentModel": r.get("parentModel"),
            "expected": len(exp),
            "creates": len(creates),
            "exact": exact,
            "dispatchFirst": first_other is None,
            "firstOther": first_other,
            "discovery": discovery,
            "native": native,
            "respondPerm": len(perm),
            "followups": followups,
            "filesInTask": files_ok,
            "promptLens": [len(c["args"].get("initialPrompt") or "") for c in head],
            "children": len(r.get("children") or []),
            "error": (r.get("error") or "").splitlines()[:1],
            "durationS": round((r.get("durationMs") or 0) / 1000),
        }
    )

print("| run | model | 期望 | create_agent | 照抄 | 先派发 | 发现类调用 | 原生子智能体 | 代批 | task 含文件 | task 长度 | 子智能体 | 后续轮询 | 秒 |")
print("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
for x in rows:
    print(
        f"| {x['run']} | {x['parentModel']} | {x['expected']} | {x['creates']} | {x['exact']}/{x['expected']} | "
        f"{'是' if x['dispatchFirst'] else '否（' + str(x['firstOther']) + '）'} | {','.join(x['discovery']) or '-'} | "
        f"{','.join(x['native']) or '-'} | {x['respondPerm'] or '-'} | {x['filesInTask']} | {x['promptLens']} | "
        f"{x['children']} | {len(x['followups'])} | {x['durationS']} |"
        + (f" ERROR {x['error']}" if x["error"] else "")
    )
