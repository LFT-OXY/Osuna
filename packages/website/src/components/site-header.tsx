import "~/styles.css";

const NAV_LINK_CLASS = "text-sm text-muted-foreground hover:text-foreground transition-colors";

export function SiteHeader() {
  return (
    <header className="flex flex-col items-center gap-4 md:flex-row md:justify-between">
      <a href="/" className="flex items-center gap-3">
        <img src="/logo.png" alt="" width={24} height={24} className="w-6 h-6" />
        <span className="text-lg font-medium">Osuna</span>
      </a>
      <div className="flex flex-wrap items-center justify-center gap-4">
        <a href="/docs" className={NAV_LINK_CLASS}>
          文档
        </a>
        <a href="/changelog" className={NAV_LINK_CLASS}>
          更新日志
        </a>
        <a href="/download" className={NAV_LINK_CLASS}>
          下载
        </a>
      </div>
    </header>
  );
}
