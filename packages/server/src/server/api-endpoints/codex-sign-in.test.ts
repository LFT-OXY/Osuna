import { describe, expect, it } from "vitest";
import { codexSignInOf } from "./codex-sign-in.js";

describe("codexSignInOf", () => {
  it("reads the sign-in from Codex's account/read answer", () => {
    expect(
      codexSignInOf({
        account: { type: "chatgpt", email: "me@example.com", planType: "plus" },
        requiresOpenaiAuth: true,
      }),
    ).toBe("chatgpt");
    expect(codexSignInOf({ account: { type: "apiKey" }, requiresOpenaiAuth: true })).toBe(
      "api_key",
    );
    expect(codexSignInOf({ account: null, requiresOpenaiAuth: true })).toBe("signed_out");
    expect(
      codexSignInOf({
        account: { type: "amazonBedrock", usesCodexManagedCredentials: false },
        requiresOpenaiAuth: false,
      }),
    ).toBe("other");
  });

  it("refuses an answer it cannot read, so the caller keeps the wiring it has", () => {
    expect(() => codexSignInOf({ requiresOpenaiAuth: true })).toThrow();
    expect(() => codexSignInOf("nope")).toThrow();
  });
});
