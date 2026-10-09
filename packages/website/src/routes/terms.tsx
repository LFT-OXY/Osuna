import { createFileRoute } from "@tanstack/react-router";
import {
  LegalContactLink,
  LegalPage,
  LegalPlaceholder,
  OsunaLegalIdentity,
} from "~/components/legal-page";
import { pageMeta } from "~/meta";

export const Route = createFileRoute("/terms")({
  head: () => pageMeta("服务条款 - Osuna", "Osuna 官方中继服务的使用条款。", "/terms"),
  component: Terms,
});

function Terms() {
  return (
    <LegalPage title="服务条款" lastUpdated="2026 年 10 月 9 日">
      <p>
        本条款适用于在 osuna.chinhae.cc 与 osuna-relay.chinhae.cc
        上运营的官方服务。使用官方中继即表示你同意本条款。这些服务如何处理数据，见
        <a href="/privacy">隐私政策</a>。
      </p>

      <section>
        <h2>谁提供服务</h2>
        <OsunaLegalIdentity />
      </section>

      <section>
        <h2>Osuna 的开源软件</h2>
        <p>
          Osuna 是以 Apache License 2.0
          许可的开源软件。你可以在该许可下安装、修改和自行托管它，不必使用官方中继。
        </p>
        <p>
          本条款不取代也不限制开源许可，只适用于 Osuna 运营的服务。自行托管的中继由托管它的人运营。
        </p>
      </section>

      <section>
        <h2>官方中继</h2>
        <p>
          中继是一项可选服务：它把 Osuna
          客户端连到你的守护进程，你不必把守护进程直接暴露出去。客户端与守护进程之间的流量端到端加密，中继只转发加密数据，读不到内容。
        </p>
        <p>
          中继以合理、公平的方式供大家使用。为了保持它可靠、安全，我们可能在必要时限制带宽、连接数量或滥用流量。
        </p>
      </section>

      <section>
        <h2>你的内容</h2>
        <p>
          你的提示词、配置、代码、消息和输出归你所有。你只授予 Osuna
          为运行你所请求的服务而传输这些内容所需的权限。
        </p>
        <p>我们不出售你的内容，不把它用于广告，也不用它训练 AI 模型。</p>
      </section>

      <section>
        <h2>可接受的使用</h2>
        <p>你不得利用这些服务：</p>
        <ul>
          <li>违反适用法律或侵犯他人权利</li>
          <li>攻击系统、传播恶意软件或规避访问控制</li>
          <li>未经授权访问他人的守护进程或服务</li>
          <li>干扰服务或绕过合理的使用限制</li>
          <li>未经我们书面许可转售官方服务</li>
        </ul>
      </section>

      <section>
        <h2>第三方服务</h2>
        <p>
          Osuna 可以运行 Claude Code、Codex 等第三方提供方，也可以连接 GitHub
          等服务。这些服务有各自的条款与隐私政策，Osuna 不对它们的可用性、输出或数据处理负责。
        </p>
      </section>

      <section>
        <h2>可用性与变更</h2>
        <p>
          我们尽力保持官方中继可用，但不承诺服务不中断，也不承诺任何服务等级，除非另有书面约定。为了安全、防止滥用、遵守法律或维持服务运行，我们可能调整功能、引入合理的限制，或暂停访问。
        </p>
      </section>

      <section>
        <h2>中止与终止</h2>
        <p>
          你可以随时停止使用这些服务。遇到严重滥用、安全威胁或对本条款的重大违反时，我们可能暂停你的访问；在可行的情况下，我们会说明原因并给你纠正的机会。
        </p>
      </section>

      <section>
        <h2>担保与责任</h2>
        <p>软件和自动化的 Agent 都可能出错。重要操作请自行复核，并做好备份。</p>
        <p>
          在法律允许的范围内，官方服务按现状提供，不附带任何默示担保。对于因 Agent
          输出、第三方服务或你的配置造成的间接损失或后果性损失，Osuna 不承担责任。
        </p>
        <p>本条款不限制法律上不可限制的责任或法定权利。</p>
      </section>

      <section>
        <h2>适用法律</h2>
        <p>
          <LegalPlaceholder>适用法律与争议解决地</LegalPlaceholder>
        </p>
        <p>如果你是消费者，你仍然享有居住地法律赋予的强制性保护。</p>
      </section>

      <section>
        <h2>变更与联系</h2>
        <p>
          服务变化时我们可能更新本条款，并在发生实质变化时更新本页及其日期。有问题请发邮件至{" "}
          <LegalContactLink />。
        </p>
      </section>
    </LegalPage>
  );
}
