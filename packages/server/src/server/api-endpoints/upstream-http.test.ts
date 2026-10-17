import { describe, expect, test } from "vitest";
import { extractErrorDetail, redactKey } from "./upstream-http.js";

describe("a key echoed back by an endpoint", () => {
  test("is replaced by *** wherever it appears", () => {
    expect(redactKey("bad key sk-1 (sk-1)", "sk-1")).toBe("bad key *** (***)");
  });

  test("an empty key leaves the text as it is", () => {
    expect(redactKey("answered 200 OK", "")).toBe("answered 200 OK");
    expect(extractErrorDetail('{"error":{"message":"invalid key"}}', "")).toBe("invalid key");
  });
});
