import type { ReactNode } from "react";
import { SiteShell } from "~/components/site-shell";

interface LegalPageProps {
  title: string;
  lastUpdated: string;
  children: ReactNode;
}

export const LEGAL_CONTACT_EMAIL = "autuhae@gmail.com";

export function LegalPage({ title, lastUpdated, children }: LegalPageProps) {
  return (
    <SiteShell width="prose">
      <article className="space-y-8 text-white/70 leading-relaxed [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:text-white [&_h2]:text-xl [&_h2]:font-medium [&_h2]:text-white [&_li]:pl-1 [&_section]:space-y-3 [&_ul]:ml-5 [&_ul]:list-disc [&_ul]:space-y-1">
        <header className="space-y-3">
          <h1 className="text-3xl font-medium text-white">{title}</h1>
          <p className="text-sm text-white/50">最后更新：{lastUpdated}</p>
        </header>
        {children}
      </article>
    </SiteShell>
  );
}

export function LegalContactLink() {
  return <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>;
}

export function OsunaLegalIdentity() {
  return (
    <address className="not-italic">
      <strong className="font-medium text-white">LFT-OXY</strong>，Osuna 的维护者
      <br />
      Osuna 由个人维护，没有注册公司或其他法人主体。
      <br />
      邮箱：
      <LegalContactLink />
      <br />
      仓库：
      <a href="https://github.com/LFT-OXY/Osuna" target="_blank" rel="noopener noreferrer">
        github.com/LFT-OXY/Osuna
      </a>
    </address>
  );
}
