export interface ShimmerTextProps {
  text: string;
  /** 落在底层那份文字上；扫光层是它的无障碍隐藏副本，不带 testID。 */
  testID?: string;
}
