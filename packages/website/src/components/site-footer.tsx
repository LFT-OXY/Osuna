interface SiteFooterProps {
  width?: "default" | "prose";
}

const FOOTER_LINK_CLASS = "block text-muted-foreground hover:text-foreground transition-colors";

export function SiteFooter({ width = "default" }: SiteFooterProps) {
  const widthClasses =
    width === "prose" ? "max-w-prose p-6 md:p-12 md:pt-0" : "max-w-5xl p-6 md:p-20 md:pt-0";
  return (
    <footer className={`${widthClasses} mx-auto`}>
      <div className="border-t border-white/10 pt-8 pb-4 grid grid-cols-2 sm:grid-cols-3 gap-8 text-sm">
        <div className="space-y-3">
          <p className="text-white/60 font-medium">产品</p>
          <div className="space-y-2">
            <a href="/docs" className={FOOTER_LINK_CLASS}>
              文档
            </a>
            <a href="/changelog" className={FOOTER_LINK_CLASS}>
              更新日志
            </a>
            <a href="/download" className={FOOTER_LINK_CLASS}>
              下载
            </a>
          </div>
        </div>
        <div className="space-y-3">
          <p className="text-white/60 font-medium">法律</p>
          <div className="space-y-2">
            <a href="/privacy" className={FOOTER_LINK_CLASS}>
              隐私
            </a>
            <a href="/terms" className={FOOTER_LINK_CLASS}>
              条款
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
