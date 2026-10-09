import { createFileRoute } from "@tanstack/react-router";
import { LandingPage } from "~/components/landing-page";
import { pageMeta } from "~/meta";

export const Route = createFileRoute("/")({
  head: () =>
    pageMeta(
      "Osuna – 编程 Agent 的统一界面",
      "在自己的机器上并行运行 Claude Code、Codex、Copilot、OpenCode 和 Pi，用桌面端、手机或浏览器随时接管。自托管，开源。",
      "/",
    ),
  component: Home,
});

function Home() {
  return (
    <LandingPage
      title={
        <>
          编程 Agent 的
          <br />
          统一界面
        </>
      }
      subtitle={
        <>
          在自己的机器上并行运行编程 Agent，
          <br />
          在桌前或手机上都能推进交付
        </>
      }
    />
  );
}
