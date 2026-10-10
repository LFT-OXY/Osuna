import { createFileRoute } from "@tanstack/react-router";
import { LegalContactLink, LegalPage, OsunaLegalIdentity } from "~/components/legal-page";
import { pageMeta } from "~/meta";

export const Route = createFileRoute("/privacy")({
  head: () =>
    pageMeta("隐私政策 - Osuna", "哪些数据留在你的机器上，加密中继又能看到什么。", "/privacy"),
  component: Privacy,
});

function Privacy() {
  return (
    <LegalPage title="隐私政策" lastUpdated="2026 年 10 月 10 日">
      <p>
        Osuna 以本地优先的方式工作。安装或使用这款开源软件，不会把你的代码、提示词、文件、终端输出或
        Agent 对话发给我们。本政策分别说明本地运行的 Osuna、可选的官方中继，以及 osuna.chinhae.cc
        各自涉及哪些数据。
      </p>

      <section>
        <h2>谁负责</h2>
        <OsunaLegalIdentity />
        <p>
          LFT-OXY
          负责官方网站与官方中继所处理的个人数据。自行托管的守护进程与中继由各自的运营者负责，不在本政策范围内。
        </p>
      </section>

      <section>
        <h2>本地的 Osuna 应用与守护进程</h2>
        <p>Osuna 运行在你自己的机器上，不向我们发送统计、遥测、广告标识或崩溃报告。</p>
        <p>
          打包的桌面端会向 GitHub Releases 检查更新。GitHub
          会按它自己的隐私政策，收到响应这次请求所需的常规网络信息。
        </p>
        <p>
          Claude Code、Codex、OpenCode 等提供方使用你机器上的凭据与各自的服务通信。Osuna
          不管理也不拦截这些 API 调用。
        </p>
      </section>

      <section>
        <h2>官方中继</h2>
        <p>中继是可选的。为了把你的客户端和守护进程连起来，它会处理：</p>
        <ul>
          <li>IP 地址与连接时间</li>
          <li>会话标识与握手用的公钥</li>
          <li>消息大小与总流量</li>
          <li>临时的连接与路由状态</li>
        </ul>
        <p>
          你的客户端与守护进程之间用 NaCl box
          做端到端加密。中继只转发密文，读不到你的代码、提示词、终端输出或 Agent
          对话。数据只在转发期间存在于中继的内存里，我们不存储消息内容。基础设施可能为安全、容量规划和排查问题保留有限的运行日志与汇总指标。
        </p>
      </section>

      <section>
        <h2>为什么处理这些数据</h2>
        <p>处理这些数据是为了：</p>
        <ul>
          <li>提供中继连接</li>
          <li>防止滥用并保护服务</li>
        </ul>
        <p>
          在要求说明处理依据的地区（例如适用 GDPR
          的地区），提供中继连接的依据是履行你所请求的服务，防止滥用与保护服务的依据是我们维护服务安全的正当利益。
        </p>
      </section>

      <section>
        <h2>服务提供方</h2>
        <p>
          官方网站、网页端与官方中继托管在 Cloudflare 上；软件版本通过 GitHub
          发布。它们各自按自己的隐私政策处理数据。
        </p>
        <p>我们不出售个人数据，不与广告商共享，也不用它训练 AI 模型。</p>
      </section>

      <section>
        <h2>保留与删除</h2>
        <p>Osuna 没有账户，我们不保存用户资料。中继不存储消息内容。</p>
        <p>
          中继与官网的运行日志保存在 Cloudflare，按其平台期限自动过期，最长
          7&nbsp;天。我们不另行导出或长期保存这些日志。
        </p>
      </section>

      <section>
        <h2>Cookie</h2>
        <p>官方网站不使用统计或广告 Cookie。</p>
      </section>

      <section>
        <h2>你的权利</h2>
        <p>
          根据适用法律，你可以要求访问、更正、删除你的个人数据，或限制、反对对它的处理。请发邮件至{" "}
          <LegalContactLink />。
        </p>
        <p>
          如果你认为我们处理你个人数据的方式不符合适用法律，请先联系我们；你也可以向你居住地的数据保护监管机构投诉。
        </p>
      </section>

      <section>
        <h2>安全</h2>
        <p>
          任何在线服务都无法保证绝对安全。Osuna 的安全模型见{" "}
          <a
            href="https://github.com/LFT-OXY/Osuna/blob/main/SECURITY.md"
            target="_blank"
            rel="noopener noreferrer"
          >
            SECURITY.md
          </a>
          ；发现漏洞请私下报告至 <LegalContactLink />。
        </p>
      </section>

      <section>
        <h2>儿童</h2>
        <p>官方服务面向开发者，不面向儿童。</p>
      </section>

      <section>
        <h2>变更</h2>
        <p>服务或数据处理方式发生实质变化时，我们会更新本页及其日期。</p>
      </section>
    </LegalPage>
  );
}
