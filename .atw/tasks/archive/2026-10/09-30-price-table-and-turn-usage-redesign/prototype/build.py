# PROTOTYPE — 把 src/ 合成单文件原型 price-and-usage.html
import pathlib
here = pathlib.Path(__file__).parent
src = here / "src"
html = f"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>价格表分组 + 每轮用量面板 · 原型</title>
<style>
{(src / "base.css").read_text()}
{(src / "styles.css").read_text()}
</style>
</head>
<body class="proto">
<div id="root"></div>
<script>
{(src / "icons.js").read_text()}
{(src / "data.js").read_text()}
{(src / "render.js").read_text()}
</script>
</body>
</html>
"""
(here / "price-and-usage.html").write_text(html)
print("ok", len(html))
