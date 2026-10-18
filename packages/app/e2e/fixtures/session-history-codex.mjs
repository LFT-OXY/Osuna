import { readFileSync } from "node:fs";
import readline from "node:readline";

// 假 Codex：会话历史要的 thread/list 读 SESSION_HISTORY_CODEX_THREADS 指向的夹具文件（每次现读，
// 用例在 daemon 起来后才写入工作区路径），并照 Codex 的规则按服务商过滤：不传 modelProviders 只列
// 当前服务商 openai，传空数组列全部，传列表只列这些。
const model = {
  id: "gpt-6.1-sol",
  model: "gpt-6.1-sol",
  displayName: "GPT-6.1 Sol",
  isDefault: true,
  defaultReasoningEffort: "medium",
  supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "Medium" }],
};

function readThreads() {
  try {
    return JSON.parse(readFileSync(process.env.SESSION_HISTORY_CODEX_THREADS, "utf8"));
  } catch {
    return [];
  }
}

function respond(method, params) {
  switch (method) {
    case "initialize":
      return {};
    case "model/list":
      return { data: [model] };
    case "config/read":
      return { config: { model: model.id, model_reasoning_effort: "medium" } };
    case "collaborationMode/list":
    case "skills/list":
    case "thread/loaded/list":
      return { data: [] };
    case "thread/list": {
      const providers = params.modelProviders;
      const listed = readThreads().filter((thread) => {
        if (providers === undefined || providers === null) return thread.modelProvider === "openai";
        if (providers.length === 0) return true;
        return providers.includes(thread.modelProvider);
      });
      return { data: listed, nextCursor: null };
    }
    default:
      throw new Error(`Unsupported Codex fixture request: ${method}`);
  }
}

if (process.argv.includes("--version")) {
  console.log("codex-cli 0.163.0");
} else {
  readline.createInterface({ input: process.stdin }).on("line", (line) => {
    const request = JSON.parse(line);
    if (request.id === undefined) return;
    try {
      process.stdout.write(
        JSON.stringify({ id: request.id, result: respond(request.method, request.params ?? {}) }) +
          "\n",
      );
    } catch (error) {
      process.stdout.write(
        JSON.stringify({ id: request.id, error: { code: -32601, message: error.message } }) + "\n",
      );
    }
  });
}
