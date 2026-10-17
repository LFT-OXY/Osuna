import { describe, expect, test } from "vitest";
import { ChatDecoder } from "./chat.js";
import { ReplyCollector, emptyUsage, type Part, type Reply, type Tool } from "./ir.js";
import { textCallFilter } from "./text-calls.js";

/*
 * 模型写在文字里的工具调用（Hermes、DeepSeek DSML、GLM arg_key）转成真调用。例子照 magpie（MIT，THIRD_PARTY_NOTICES）的
 * textcalls_test.go、textcalls_glm_test.go、textcalls_param_test.go 与 textcalls_tail_test.go。
 */

function tool(name: string): Tool {
  return { name, description: "", schema: { type: "object" }, strict: false };
}

const TOOLS = [tool("bash"), tool("edit")];

function chunkOf(text: string): string {
  return JSON.stringify({
    id: "c1",
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
  });
}

const STOP_CHUNK = JSON.stringify({
  id: "c1",
  object: "chat.completion.chunk",
  choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
});

/** Chat 上游的这些片经过修补后攒成的整份回复。 */
function replyOf(input: { tools: Tool[]; chunks: string[] }): Reply {
  const collector = new ReplyCollector();
  const filter = textCallFilter({ tools: input.tools, emit: (event) => collector.add(event) });
  const decoder = new ChatDecoder();
  for (const chunk of input.chunks) decoder.decode(chunk, (event) => filter.event(event));
  decoder.decode("[DONE]", (event) => filter.event(event));
  decoder.end?.((event) => filter.event(event));
  filter.end();
  return collector.finish();
}

/** 转成的真调用：id 是中转站起的，只看前缀。 */
interface ExpectedCall {
  kind: "tool_call";
  id: unknown;
  name: string;
  args: string;
}

function called(name: string, args: unknown): ExpectedCall {
  return {
    kind: "tool_call",
    id: expect.stringMatching(/^call_text_/),
    name,
    args: JSON.stringify(args),
  };
}

function textReply(text: string): Reply {
  return { id: "c1", parts: [{ kind: "text", text }], stop: "stop", usage: emptyUsage() };
}

/** 期望的整份回复：调用的 id 只看前缀。 */
interface ExpectedReply extends Omit<Reply, "parts"> {
  parts: (Part | ExpectedCall)[];
}

function callReply(parts: (Part | ExpectedCall)[]): ExpectedReply {
  return { id: "c1", parts, stop: "tool", usage: emptyUsage() };
}

describe("a call written as Hermes' <tool_call> block", () => {
  test("split across chunks, it is the call it is, after the text before it", () => {
    const reply = replyOf({
      tools: TOOLS,
      chunks: [
        chunkOf("我先看看目录。\n\n<tool"),
        chunkOf('_call>{"name":"bash","arguments":{"command":"ls -la"}}'),
        chunkOf("</tool_call>"),
        STOP_CHUNK,
      ],
    });

    expect(reply).toEqual(
      callReply([
        { kind: "text", text: "我先看看目录。\n\n" },
        called("bash", { command: "ls -la" }),
      ]),
    );
  });

  test("a raw newline in its string and DeepSeek's closes after it; arguments given as a string of JSON", () => {
    const reply = replyOf({
      tools: TOOLS,
      chunks: [
        chunkOf(
          '<tool_call>{"name":"bash","arguments":{"command":"cd /e && for s in a b; do\n\techo \\"$s\\"; done"}}</｜DSML｜parameter>\n</｜DSML｜invoke',
        ),
        chunkOf(
          '<tool_call>{"name":"edit","arguments":"{\\"path\\":\\"a.md\\",\\"oldText\\":\\"x\\"}"}</tool_call>',
        ),
        STOP_CHUNK,
      ],
    });

    expect(reply).toEqual(
      callReply([
        called("bash", { command: 'cd /e && for s in a b; do\n\techo "$s"; done' }),
        called("edit", { path: "a.md", oldText: "x" }),
      ]),
    );
  });

  test.each(["]", "}", ']}]}}"}}}}', "}}", '">', "\n}}"])(
    "what GLM leaves before the close (%j) goes with it",
    (tail) => {
      const reply = replyOf({
        tools: TOOLS,
        chunks: [
          chunkOf("Listing it.\n<tool_call>"),
          chunkOf(`{"name":"bash","arguments":{"command":"ls"}}${tail}`),
          chunkOf("</tool_call>"),
          STOP_CHUNK,
        ],
      });

      expect(reply).toEqual(
        callReply([{ kind: "text", text: "Listing it.\n" }, called("bash", { command: "ls" })]),
      );
    },
  );

  test("a tail after the call's own close goes too", () => {
    const reply = replyOf({
      tools: TOOLS,
      chunks: [
        chunkOf(
          '<tool_call>{"name":"bash","arguments":{"command":"ls"}}</tool_call>\n}}</tool_call>',
        ),
        STOP_CHUNK,
      ],
    });

    expect(reply).toEqual(callReply([called("bash", { command: "ls" })]));
  });

  test("an object closed early at a quote left unescaped is no call", () => {
    const block =
      '<tool_call>{"name":"bash","arguments":{"command":"python3 - <<\'PY\'\\nimport json\\nprint(json.dumps({\\"名\\": \'v\', \\"n\\": {\\"x\\": \\"y"}}))\\nPY\\n | tail -8","timeout":180000}}</tool_call>';

    expect(replyOf({ tools: TOOLS, chunks: [chunkOf(block), STOP_CHUNK] })).toEqual(
      textReply(block),
    );
  });

  test("prose after a call with no close of its own stays beside the call", () => {
    const reply = replyOf({
      tools: TOOLS,
      chunks: [
        chunkOf('<tool_call>{"name":"bash","arguments":{"command":"ls"}}\nDone.'),
        STOP_CHUNK,
      ],
    });

    expect(reply).toEqual(
      callReply([{ kind: "text", text: "Done." }, called("bash", { command: "ls" })]),
    );
  });
});

describe("a call written half as Hermes' block, half as DeepSeek's parameters", () => {
  test("the name as JSON closed with >, then a parameter with no close", () => {
    const reply = replyOf({
      tools: TOOLS,
      chunks: [
        chunkOf('Let me run it.\n\n<tool_call>{"name":"bash">\n<param'),
        chunkOf('eter name="command">cd /e/Project/synara && node .review-tmp\n'),
        STOP_CHUNK,
      ],
    });

    expect(reply).toEqual(
      callReply([
        { kind: "text", text: "Let me run it.\n\n" },
        called("bash", { command: "cd /e/Project/synara && node .review-tmp" }),
      ]),
    );
  });

  test("closed, with Qwen's <parameter=k>, a JSON value and a raw multi-line one, then a second call", () => {
    const reply = replyOf({
      tools: TOOLS,
      chunks: [
        chunkOf(
          '<tool_call>{"name":"edit"}\n<parameter=path>a.ts</parameter>\n<parameter=edits>[{"oldText":"x","newText":"y"}]</parameter>\n</tool_call>',
        ),
        chunkOf(
          '<tool_call>{"name":"bash"}<parameter name="command">for f in *; do\n  echo "$f"\ndone</parameter></tool_call>',
        ),
        STOP_CHUNK,
      ],
    });

    expect(reply).toEqual(
      callReply([
        called("edit", { path: "a.ts", edits: [{ oldText: "x", newText: "y" }] }),
        called("bash", { command: 'for f in *; do\n  echo "$f"\ndone' }),
      ]),
    );
  });

  test.each([
    '<tool_call>{"name":"rm_rf">\n<parameter name="path">/</parameter>',
    '<tool_call>{"name":"bash"> and then',
  ])("a tool not offered, or a name with no parameters after it, stays text: %j", (block) => {
    expect(replyOf({ tools: TOOLS, chunks: [chunkOf(block), STOP_CHUNK] })).toEqual(
      textReply(block),
    );
  });
});

describe("a call written in DeepSeek's DSML", () => {
  test("its parameters are the arguments, one marked a string as written and another read as JSON", () => {
    const reply = replyOf({
      tools: [tool("bash")],
      chunks: [
        chunkOf(
          'Running it.\n\n<｜DSML｜function_calls>\n<｜DSML｜invoke name="bash">\n<｜DSML｜parameter name="command" string="true">ls -la</｜DSML｜parameter>\n',
        ),
        chunkOf(
          '<｜DSML｜parameter name="timeout" string="false">30</｜DSML｜parameter>\n</｜DSML｜invoke>\n</｜DSML｜function_calls>',
        ),
        STOP_CHUNK,
      ],
    });

    expect(reply).toEqual(
      callReply([
        { kind: "text", text: "Running it.\n\n" },
        called("bash", { command: "ls -la", timeout: 30 }),
      ]),
    );
  });

  test("a <tool_call> wrapping DeepSeek's invoke is the call", () => {
    const reply = replyOf({
      tools: TOOLS,
      chunks: [
        chunkOf(
          '看一下。<tool_call>\n<｜DSML｜invoke name="bash">\n<｜DSML｜parameter name="command" string="true">ls</｜DSML｜parameter>\n</｜DSML｜invoke>\n</tool_call>',
        ),
        STOP_CHUNK,
      ],
    });

    expect(reply).toEqual(
      callReply([{ kind: "text", text: "看一下。" }, called("bash", { command: "ls" })]),
    );
  });

  test("tags and nothing else are dropped", () => {
    const reply = replyOf({
      tools: TOOLS,
      chunks: [
        chunkOf("<tool_call>\n</｜DSML｜parameter>\n"),
        chunkOf("</｜DSML｜invoke>\n</"),
        STOP_CHUNK,
      ],
    });

    expect(reply).toEqual({ id: "c1", parts: [], stop: "stop", usage: emptyUsage() });
  });
});

describe("a call written as GLM's arg_key pairs", () => {
  test("a value that is JSON is kept as JSON, any other is the string it says; two calls in a row are both made", () => {
    const reply = replyOf({
      tools: [tool("shell"), tool("read")],
      chunks: [
        chunkOf(
          '<tool_call>shell<arg_key>command</arg_key><arg_value>["ls","-la"]</arg_value><arg_key>timeout_ms</arg_key><arg_value>',
        ),
        chunkOf(
          "5000</arg_value><arg_key>workdir</arg_key><arg_value>/tmp/x</arg_value></tool_call>\n<tool_call>read\n<arg_key>path</arg_key>\n<arg_value>a.md</arg_value>\n</tool_call>",
        ),
        STOP_CHUNK,
      ],
    });

    expect(reply).toEqual(
      callReply([
        called("shell", { command: ["ls", "-la"], timeout_ms: 5000, workdir: "/tmp/x" }),
        called("read", { path: "a.md" }),
      ]),
    );
  });

  test("its tags split across chunks", () => {
    const reply = replyOf({
      tools: TOOLS,
      chunks: [
        chunkOf("Looking.<tool_call>bash<arg_key>com"),
        chunkOf("mand</arg_key><arg_value>ls -la</arg_value></tool_"),
        chunkOf("call>"),
        STOP_CHUNK,
      ],
    });

    expect(reply).toEqual(
      callReply([{ kind: "text", text: "Looking." }, called("bash", { command: "ls -la" })]),
    );
  });
});

describe("text that stays as it came", () => {
  test.each([
    {
      name: "a block naming a tool not offered",
      tools: TOOLS,
      chunks: ['Like this: <tool_call>{"name":"rm_rf","arguments":{}}</tool_call>'],
    },
    {
      name: "a GLM block naming a tool not offered",
      tools: TOOLS,
      chunks: [
        "Like this: <tool_call>rm_rf<arg_key>path</arg_key><arg_value>/</arg_value></tool_call>",
      ],
    },
    {
      name: "a request that offered no tools",
      tools: [],
      chunks: ['<tool_call>{"name":"bash","arguments":{"command":"ls"}}</tool_call>'],
    },
    {
      name: "a block cut off",
      tools: TOOLS,
      chunks: ['<tool_call>{"name":"bash","arguments":{"command":"l', "s"],
    },
    {
      name: "text that only looks like a tag's start",
      tools: TOOLS,
      chunks: ["a <tool", "tip> b"],
    },
    { name: "a close in prose", tools: TOOLS, chunks: ["x </tool_call> y"] },
  ])("$name", ({ tools, chunks }) => {
    const reply = replyOf({ tools, chunks: [...chunks.map(chunkOf), STOP_CHUNK] });

    expect(reply).toEqual(textReply(chunks.join("")));
  });

  test("once the model made a call itself, its text is not read for calls", () => {
    const written = '<tool_call>{"name":"bash","arguments":{"command":"ls"}}';
    const native = JSON.stringify({
      id: "c1",
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call_9",
                type: "function",
                function: { name: "edit", arguments: "{}" },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    });
    const stop = JSON.stringify({
      id: "c1",
      choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
    });

    expect(replyOf({ tools: TOOLS, chunks: [chunkOf(written), native, stop] })).toEqual(
      callReply([
        { kind: "text", text: written },
        { kind: "tool_call", id: "call_9", name: "edit", args: "{}" },
      ]),
    );
  });
});
