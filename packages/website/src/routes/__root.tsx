import type { ReactNode } from "react";
import { createContext, useContext } from "react";
import {
  Outlet,
  createRootRoute,
  HeadContent,
  Scripts,
  useRouterState,
} from "@tanstack/react-router";
import type { ReleaseChannels, ReleaseInfo } from "~/latest-release";
import type { VisitorPlatform } from "~/platform";
import { getVisitorPlatform } from "~/platform";
import { getLatestRelease } from "~/release";

const ReleaseCtx = createContext<ReleaseChannels>({
  stable: {
    version: "",
    linuxAppImageAsset: null,
    windowsX64Asset: null,
    windowsArm64Asset: null,
    androidApkAsset: null,
  },
  beta: null,
});
const PlatformCtx = createContext<VisitorPlatform>("mac");

/** The latest stable release. Everything on the site points here by default. */
export function useRelease(): ReleaseInfo {
  return useContext(ReleaseCtx).stable;
}

/** The current beta, or null when there is no beta ahead of stable. */
export function useBetaRelease(): ReleaseInfo | null {
  return useContext(ReleaseCtx).beta;
}

/** The platform the visitor is browsing from, resolved from the request user agent during SSR. */
export function useVisitorPlatform(): VisitorPlatform {
  return useContext(PlatformCtx);
}

export const Route = createRootRoute({
  loader: async () => {
    const [release, platform] = await Promise.all([getLatestRelease(), getVisitorPlatform()]);
    return { release, platform };
  },
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "theme-color", content: "#101615" },
      { property: "og:site_name", content: "Osuna" },
      { property: "og:type", content: "website" },
      { property: "og:image", content: "https://osuna.chinhae.cc/og-image.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: "https://osuna.chinhae.cc/og-image.png" },
    ],
    links: [
      { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
      { rel: "icon", href: "/logo.png", type: "image/png" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  const data = Route.useLoaderData();
  return (
    <ReleaseCtx value={data.release}>
      <PlatformCtx value={data.platform}>
        <RootDocument>
          <Outlet />
        </RootDocument>
      </PlatformCtx>
    </ReleaseCtx>
  );
}

// 首页、下载页与法律页是中文；Public docs 和从 CHANGELOG 生成的更新日志保留英文。
function documentLanguage(pathname: string): "en" | "zh-CN" {
  return pathname.startsWith("/docs") || pathname.startsWith("/changelog") ? "en" : "zh-CN";
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return (
    <html lang={documentLanguage(pathname)}>
      <head>
        <HeadContent />
      </head>
      <body className="antialiased bg-background text-foreground">
        {children}
        <Scripts />
      </body>
    </html>
  );
}
