export interface WorkingDiffSubscription {
  filesOnly: boolean;
  publishReviewAttachment: boolean;
}

/**
 * 正文不可见时只要文件清单；但还有没发出的评审评论时照旧完整订阅并发布评审附件，
 * 清单里没有 hunks，拼不出评审上下文。
 */
export function resolveWorkingDiffSubscription(input: {
  diffBodyHidden: boolean;
  pendingReviewCommentCount: number;
}): WorkingDiffSubscription {
  const filesOnly = input.diffBodyHidden && input.pendingReviewCommentCount === 0;
  return { filesOnly, publishReviewAttachment: !filesOnly };
}
