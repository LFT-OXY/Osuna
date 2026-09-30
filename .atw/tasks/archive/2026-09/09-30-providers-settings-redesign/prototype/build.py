# 把 src/ 合成单文件原型：providers-redesign.html
import base64, pathlib
here = pathlib.Path(__file__).parent
src = here / "src"
def b64(p): return "data:image/jpeg;base64," + base64.b64encode((here / p).read_bytes()).decode()
assets = f'const ASSETS = {{ workspaceLight: "{b64("assets/workspace-light.jpg")}", workspaceDark: "{b64("assets/workspace-dark.jpg")}" }};'
html = f"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Providers 设置页重排 · 原型</title>
<style>
{(src / "styles.css").read_text()}
</style>
</head>
<body class="proto">
<div id="root"></div>
<script>
{(src / "icons.js").read_text()}
{assets}
{(src / "data.js").read_text()}
{(src / "render.js").read_text()}
</script>
</body>
</html>
"""
(here / "providers-redesign.html").write_text(html)
print("ok", len(html))
