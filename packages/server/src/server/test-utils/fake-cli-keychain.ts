import type { CliKeychain } from "../provider-accounts/keychain.js";

/** 内存里的钥匙串：多号自动轮换的测试用它代替系统钥匙串。 */
export class FakeCliKeychain implements CliKeychain {
  readonly available = true;
  private readonly items = new Map<string, string>();

  set(service: string, account: string, value: string): void {
    this.items.set(`${service}\u0000${account}`, value);
  }

  async read(service: string, account: string): Promise<string | null> {
    return this.items.get(`${service}\u0000${account}`) ?? null;
  }
}
