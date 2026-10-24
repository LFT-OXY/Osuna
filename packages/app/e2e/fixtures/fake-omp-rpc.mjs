// 浏览器测试里扮演 OMP：答 --version（daemon 据此决定 models.yml 收不收 max），起来时说 ready，
// 列模型等 RPC 一律回空结果。从不读写任何配置。
import readline from "node:readline";

if (process.argv.includes("--version")) {
  process.stdout.write("omp/18.12.6\n");
  process.exit(0);
}

process.stdout.write(`${JSON.stringify({ type: "ready" })}\n`);

const lines = readline.createInterface({ input: process.stdin });

for await (const line of lines) {
  const command = JSON.parse(line);
  let data = {};
  if (command.type === "get_available_models") {
    data = { models: [{ provider: "e2e", id: "omp-profile-model", name: "OMP profile model" }] };
  } else if (command.type === "get_state") {
    data = {
      sessionId: "e2e-omp-session",
      thinkingLevel: "medium",
      isStreaming: false,
      isCompacting: false,
    };
  }

  process.stdout.write(
    `${JSON.stringify({
      id: command.id,
      type: "response",
      command: command.type,
      success: true,
      data,
    })}\n`,
  );
}
