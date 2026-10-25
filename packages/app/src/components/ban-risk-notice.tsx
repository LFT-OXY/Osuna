import { Alert } from "@/components/ui/alert";
import { ExternalLink } from "@/components/ui/external-link";

export interface BanRiskNoticeProps {
  title: string;
  body: string;
  // 条款链接的文字与地址。
  termsLabel: string;
  termsUrl: string;
  testID?: string;
}

/*
 * 封号风险提示（Ban risk notice）：厂商可能封禁这样使用的账号，引用厂商条款并附链接。
 * 常驻、不能关，也不要求用户做选择；内容由调用方给。
 */
export function BanRiskNotice({ title, body, termsLabel, termsUrl, testID }: BanRiskNoticeProps) {
  return (
    <Alert size="sm" variant="warning" title={title} description={body} testID={testID}>
      <ExternalLink href={termsUrl} label={termsLabel} />
    </Alert>
  );
}
