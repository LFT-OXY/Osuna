import { expect, test } from "vitest";

import { stripTrailingRoutingBlock } from "./trailing-routing-block.js";

const BLOCK = '<paseo-system>\n1. @Claude -> provider "claude", settings {}\n</paseo-system>';

test("drops a Routing block that trails the user's text", () => {
  expect(
    stripTrailingRoutingBlock(`[@Claude](paseo://agent/provider/claude) write tests\n\n${BLOCK}`),
  ).toBe("[@Claude](paseo://agent/provider/claude) write tests");
  expect(stripTrailingRoutingBlock(`review this\n${BLOCK}\n`)).toBe("review this");
  expect(stripTrailingRoutingBlock(`joined without a separator${BLOCK}`)).toBe(
    "joined without a separator",
  );
});

test("leaves envelopes, blocks followed by more text, and plain mentions of the tag alone", () => {
  expect(stripTrailingRoutingBlock(BLOCK)).toBe(BLOCK);
  expect(stripTrailingRoutingBlock(`${BLOCK}\n\nthen the user wrote more`)).toBe(
    `${BLOCK}\n\nthen the user wrote more`,
  );
  expect(stripTrailingRoutingBlock("how does <paseo-system> work")).toBe(
    "how does <paseo-system> work",
  );
});
