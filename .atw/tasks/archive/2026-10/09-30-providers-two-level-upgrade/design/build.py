import json, pathlib
here = pathlib.Path(__file__).parent
tokens = json.loads((here / "tokens.json").read_text())
icons = {k: v for k, v in tokens["icons"].items() if v}
tpl = (here / "mock-template.html").read_text()
dirs = {"a": "一张清单", "b": "详情做主", "c": "目录里开关"}
for key, title in dirs.items():
    html = tpl.replace("__DIR__", key).replace("__TITLE__", title).replace("__ICONS__", json.dumps(icons, ensure_ascii=False))
    (here / f"round-01-{key}.html").write_text(html)
print("ok")
