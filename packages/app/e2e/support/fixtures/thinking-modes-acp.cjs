// ACP agent that only answers the catalog probe: two models, one shared set of thinking levels
// (ACP reports them per session, not per model) and two modes.
const readline = require("node:readline");

const session = {
  sessionId: "thinking-modes-catalog",
  models: {
    currentModelId: "acp-swift",
    availableModels: [
      { modelId: "acp-swift", name: "Swift" },
      { modelId: "acp-deep", name: "Deep" },
    ],
  },
  modes: {
    currentModeId: "ask",
    availableModes: [
      { id: "ask", name: "Ask" },
      { id: "code", name: "Code" },
    ],
  },
  configOptions: [
    {
      id: "thought_level",
      name: "Thinking",
      type: "select",
      category: "thought_level",
      currentValue: "medium",
      options: [
        { value: "low", name: "Low" },
        { value: "medium", name: "Medium" },
        { value: "high", name: "High" },
      ],
    },
  ],
};

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  let result = {};
  if (request.method === "initialize")
    result = { protocolVersion: 1, agentCapabilities: {}, authMethods: [] };
  if (request.method === "session/new") result = session;
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\n");
});
