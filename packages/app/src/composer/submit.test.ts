import { describe, expect, it, vi } from "vitest";
import { submitAgentInput } from "./submit";

function createDeferredPromise<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return {
    promise,
    resolve,
    reject,
  };
}

const fileSegment = {
  type: "block" as const,
  block: { kind: "file" as const, path: "src/x.ts", entryKind: "file" as const },
};

function skill(name: string) {
  return { type: "block" as const, block: { kind: "skill" as const, name } };
}

describe("submitAgentInput", () => {
  it("clears the composer before an in-flight submit resolves", async () => {
    const deferred = createDeferredPromise<void>();
    const queueMessage = vi.fn();
    const submitMessage = vi.fn(async () => {
      await deferred.promise;
    });
    const clearDraft = vi.fn();
    const setUserInput = vi.fn();
    const setAttachments = vi.fn();
    const setSendError = vi.fn();
    const setIsProcessing = vi.fn();

    const submitPromise = submitAgentInput({
      message: "  hello world  ",
      segments: null,
      attachments: [],
      isAgentRunning: false,
      canSubmit: true,
      queueMessage,
      submitMessage,
      clearDraft,
      setUserInput,
      setAttachments,
      setSendError,
      setIsProcessing,
    });

    expect(queueMessage).not.toHaveBeenCalled();
    expect(submitMessage).toHaveBeenCalledWith({
      message: "hello world",
      segments: null,
      attachments: [],
    });
    expect(setUserInput).toHaveBeenCalledWith("");
    expect(setAttachments).toHaveBeenCalledWith([]);
    expect(setSendError).toHaveBeenCalledWith(null);
    expect(setIsProcessing).toHaveBeenCalledWith(true);
    expect(clearDraft).not.toHaveBeenCalled();

    deferred.resolve();

    await expect(submitPromise).resolves.toBe("submitted");
    expect(clearDraft).toHaveBeenCalledWith("sent");
  });

  it("preserves the composer before an in-flight submit resolves when requested", async () => {
    const deferred = createDeferredPromise<void>();
    const attachments = [{ id: "img-1" }];
    const queueMessage = vi.fn();
    const submitMessage = vi.fn(async () => {
      await deferred.promise;
    });
    const clearDraft = vi.fn();
    const setUserInput = vi.fn();
    const setAttachments = vi.fn();
    const setSendError = vi.fn();
    const setIsProcessing = vi.fn();

    const submitPromise = submitAgentInput({
      message: "  keep me  ",
      segments: null,
      attachments,
      submitBehavior: "preserve-and-lock",
      isAgentRunning: false,
      canSubmit: true,
      queueMessage,
      submitMessage,
      clearDraft,
      setUserInput,
      setAttachments,
      setSendError,
      setIsProcessing,
    });

    expect(queueMessage).not.toHaveBeenCalled();
    expect(submitMessage).toHaveBeenCalledWith({
      message: "keep me",
      segments: null,
      attachments,
    });
    expect(setUserInput).not.toHaveBeenCalled();
    expect(setAttachments).not.toHaveBeenCalled();
    expect(setSendError).toHaveBeenCalledWith(null);
    expect(setIsProcessing).toHaveBeenCalledWith(true);
    expect(clearDraft).not.toHaveBeenCalled();

    deferred.resolve();

    await expect(submitPromise).resolves.toBe("submitted");
    expect(clearDraft).toHaveBeenCalledWith("sent");
  });

  it("queues while the agent is running and clears the composer immediately", async () => {
    const queueMessage = vi.fn();
    const submitMessage = vi.fn();
    const clearDraft = vi.fn();
    const setUserInput = vi.fn();
    const setAttachments = vi.fn();
    const setSendError = vi.fn();
    const setIsProcessing = vi.fn();

    await expect(
      submitAgentInput({
        message: "  queued message  ",
        segments: null,
        attachments: [{ id: "img-1" }],
        isAgentRunning: true,
        canSubmit: true,
        queueMessage,
        submitMessage,
        clearDraft,
        setUserInput,
        setAttachments,
        setSendError,
        setIsProcessing,
      }),
    ).resolves.toBe("queued");

    expect(queueMessage).toHaveBeenCalledWith({
      message: "queued message",
      segments: null,
      attachments: [{ id: "img-1" }],
    });
    expect(submitMessage).not.toHaveBeenCalled();
    expect(setUserInput).toHaveBeenCalledWith("");
    expect(setAttachments).toHaveBeenCalledWith([]);
    expect(setSendError).not.toHaveBeenCalled();
    expect(setIsProcessing).not.toHaveBeenCalled();
    expect(clearDraft).not.toHaveBeenCalled();
  });

  it("restores the composer when submit fails", async () => {
    const submitError = new Error("No host selected");
    const queueMessage = vi.fn();
    const submitMessage = vi.fn(async () => {
      throw submitError;
    });
    const clearDraft = vi.fn();
    const setUserInput = vi.fn();
    const setAttachments = vi.fn();
    const setSendError = vi.fn();
    const setIsProcessing = vi.fn();
    const onSubmitError = vi.fn();
    const attachments = [{ id: "img-1" }];

    await expect(
      submitAgentInput({
        message: "  hello world  ",
        segments: null,
        attachments,
        isAgentRunning: false,
        canSubmit: true,
        queueMessage,
        submitMessage,
        clearDraft,
        setUserInput,
        setAttachments,
        setSendError,
        setIsProcessing,
        onSubmitError,
      }),
    ).resolves.toBe("failed");

    expect(onSubmitError).toHaveBeenCalledWith(submitError);
    expect(setUserInput).toHaveBeenNthCalledWith(1, "");
    expect(setUserInput).toHaveBeenNthCalledWith(2, "hello world");
    expect(setAttachments).toHaveBeenNthCalledWith(1, []);
    expect(setAttachments).toHaveBeenNthCalledWith(2, attachments);
    expect(setSendError).toHaveBeenNthCalledWith(1, null);
    expect(setSendError).toHaveBeenNthCalledWith(2, "No host selected");
    expect(setIsProcessing).toHaveBeenNthCalledWith(1, true);
    expect(setIsProcessing).toHaveBeenNthCalledWith(2, false);
    expect(clearDraft).not.toHaveBeenCalled();
  });

  it("restores a steered active-turn draft after an ambiguous immediate-send error", async () => {
    const error = new Error("connection lost after delivery");
    const setUserInput = vi.fn();
    const setAttachments = vi.fn();
    const setSendError = vi.fn();
    const setIsProcessing = vi.fn();

    await expect(
      submitAgentInput({
        message: "  steer this turn  ",
        segments: null,
        attachments: [{ id: "img-1" }],
        forceSend: true,
        isAgentRunning: true,
        canSubmit: true,
        queueMessage: vi.fn(),
        submitMessage: async () => {
          throw error;
        },
        clearDraft: vi.fn(),
        setUserInput,
        setAttachments,
        setSendError,
        setIsProcessing,
      }),
    ).resolves.toBe("failed");

    expect(setUserInput).toHaveBeenNthCalledWith(1, "");
    expect(setUserInput).toHaveBeenNthCalledWith(2, "steer this turn");
    expect(setAttachments).toHaveBeenNthCalledWith(1, []);
    expect(setAttachments).toHaveBeenNthCalledWith(2, [{ id: "img-1" }]);
    expect(setSendError).toHaveBeenLastCalledWith("connection lost after delivery");
  });

  it("submits when empty submit is explicitly allowed", async () => {
    const queueMessage = vi.fn();
    const submitMessage = vi.fn(async () => {});
    const clearDraft = vi.fn();
    const setUserInput = vi.fn();
    const setAttachments = vi.fn();
    const setSendError = vi.fn();
    const setIsProcessing = vi.fn();

    await expect(
      submitAgentInput({
        message: "   ",
        segments: null,
        attachments: [],
        allowEmptySubmit: true,
        isAgentRunning: false,
        canSubmit: true,
        queueMessage,
        submitMessage,
        clearDraft,
        setUserInput,
        setAttachments,
        setSendError,
        setIsProcessing,
      }),
    ).resolves.toBe("submitted");

    expect(queueMessage).not.toHaveBeenCalled();
    expect(submitMessage).toHaveBeenCalledWith({
      message: "",
      segments: null,
      attachments: [],
    });
    expect(clearDraft).toHaveBeenCalledWith("sent");
  });

  it("sends leading skill blocks as a /name prefix and keeps a skill-only message", async () => {
    const submitMessage = vi.fn(async () => {});

    await expect(
      submitAgentInput({
        message: "/a /b ",
        segments: [
          skill("a"),
          { type: "text", text: " " },
          skill("b"),
          { type: "text", text: " " },
        ],
        attachments: [],
        isAgentRunning: false,
        canSubmit: true,
        queueMessage: vi.fn(),
        submitMessage,
        clearDraft: vi.fn(),
        setUserInput: vi.fn(),
        setAttachments: vi.fn(),
        setSendError: vi.fn(),
        setIsProcessing: vi.fn(),
      }),
    ).resolves.toBe("submitted");

    expect(submitMessage).toHaveBeenCalledWith({
      message: "/a /b",
      segments: [skill("a"), { type: "text", text: " " }, skill("b")],
      attachments: [],
    });
  });

  it("sends one space between the skill blocks and the body however the body starts", async () => {
    const submitMessage = vi.fn(async () => {});

    await submitAgentInput({
      message: "/a   body",
      segments: [skill("a"), { type: "text", text: "   body" }],
      attachments: [],
      isAgentRunning: false,
      canSubmit: true,
      queueMessage: vi.fn(),
      submitMessage,
      clearDraft: vi.fn(),
      setUserInput: vi.fn(),
      setAttachments: vi.fn(),
      setSendError: vi.fn(),
      setIsProcessing: vi.fn(),
    });

    expect(submitMessage).toHaveBeenCalledWith(expect.objectContaining({ message: "/a body" }));
  });

  it("queues the segments trimmed like the text", async () => {
    const queueMessage = vi.fn();

    await expect(
      submitAgentInput({
        message: "/a see [x.ts](src/x.ts)\n",
        segments: [
          skill("a"),
          { type: "text", text: " see " },
          fileSegment,
          { type: "text", text: "\n" },
        ],
        attachments: [],
        isAgentRunning: true,
        canSubmit: true,
        queueMessage,
        submitMessage: vi.fn(async () => {}),
        clearDraft: vi.fn(),
        setUserInput: vi.fn(),
        setAttachments: vi.fn(),
        setSendError: vi.fn(),
        setIsProcessing: vi.fn(),
      }),
    ).resolves.toBe("queued");

    expect(queueMessage).toHaveBeenCalledWith({
      message: "/a see [x.ts](src/x.ts)",
      segments: [skill("a"), { type: "text", text: " see " }, fileSegment],
      attachments: [],
    });
  });

  it("restores the blocks with the body when submit fails", async () => {
    const setUserInput = vi.fn();

    await expect(
      submitAgentInput({
        message: " see [x.ts](src/x.ts) ",
        segments: [{ type: "text", text: " see " }, fileSegment, { type: "text", text: " " }],
        attachments: [],
        isAgentRunning: false,
        canSubmit: true,
        queueMessage: vi.fn(),
        submitMessage: async () => {
          throw new Error("offline");
        },
        clearDraft: vi.fn(),
        setUserInput,
        setAttachments: vi.fn(),
        setSendError: vi.fn(),
        setIsProcessing: vi.fn(),
      }),
    ).resolves.toBe("failed");

    expect(setUserInput).toHaveBeenLastCalledWith("see [x.ts](src/x.ts)", [
      { type: "text", text: "see " },
      fileSegment,
    ]);
  });
});
