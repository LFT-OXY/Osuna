// 假 Claude Code：会话历史只要它「装着」（--version 有回答），会话本身从 CLAUDE_CONFIG_DIR/projects 读，
// 不起真的 claude。其余调用一律直接退出。
if (process.argv.includes("--version")) {
  console.log("2.1.0 (Claude Code)");
}
process.exit(0);
