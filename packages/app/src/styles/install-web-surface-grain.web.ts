const STYLE_ID = "paseo-web-surface-grain";

// t3code 的表面颗粒：256px 分形噪点瓦片，不透明度 0.035 写在 SVG 的 rect 上。
const GRAIN_TILE = `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.035'/%3E%3C/svg%3E")`;

/**
 * 全窗口噪点：一层不接收指针的固定覆盖层，盖在所有表面（含菜单与对话框）之上。
 * t3code 把颗粒烘进各表面的背景以省 GPU；这里的表面多是各自不透明的 View，
 * 烘进背景要逐个表面接入，所以先用覆盖层。若 Electron 空闲 GPU 占用上涨，改成逐表面接入。
 */
export function installWebSurfaceGrain(): () => void {
  if (document.getElementById(STYLE_ID)) return () => {};

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
body::after {
  content: "";
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  pointer-events: none;
  background-image: ${GRAIN_TILE};
  background-repeat: repeat;
  background-size: 256px 256px;
}
`;
  document.head.append(style);

  return () => style.remove();
}
