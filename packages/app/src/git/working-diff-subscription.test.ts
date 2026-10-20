import { describe, expect, it } from "vitest";
import { resolveWorkingDiffSubscription } from "./working-diff-subscription";

describe("resolveWorkingDiffSubscription", () => {
  it("asks only for the file list when the diff body is hidden and no review comment is pending", () => {
    expect(
      resolveWorkingDiffSubscription({ diffBodyHidden: true, pendingReviewCommentCount: 0 }),
    ).toEqual({ filesOnly: true, publishReviewAttachment: false });
  });

  it("keeps the full diff and publishes the review attachment while review comments are unsent", () => {
    expect(
      resolveWorkingDiffSubscription({ diffBodyHidden: true, pendingReviewCommentCount: 2 }),
    ).toEqual({ filesOnly: false, publishReviewAttachment: true });
  });

  it("uses the full diff and publishes the review attachment when the diff body shows", () => {
    expect(
      resolveWorkingDiffSubscription({ diffBodyHidden: false, pendingReviewCommentCount: 0 }),
    ).toEqual({ filesOnly: false, publishReviewAttachment: true });
  });
});
