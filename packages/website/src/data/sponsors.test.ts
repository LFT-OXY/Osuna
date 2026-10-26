import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SPONSORS, sponsorHref } from "./sponsors";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const WEBSITE_PUBLIC = fileURLToPath(new URL("../../public", import.meta.url));
const READMES = ["README.md", "README.zh-CN.md", "README.ja.md", "README.ko.md"];

describe("sponsorHref", () => {
  it("tags the link with the placement it is shown in", () => {
    const sponsor = {
      name: "Acme",
      url: "https://acme.dev",
      logo: { onDark: "", onLight: "" },
      description: "",
    };

    expect(sponsorHref(sponsor, "website")).toBe(
      "https://acme.dev/?utm_source=paseo&utm_medium=website&utm_campaign=sponsor",
    );
    expect(sponsorHref(sponsor, "x")).toBe(
      "https://acme.dev/?utm_source=paseo&utm_medium=x&utm_campaign=sponsor",
    );
  });
});

function readmeSponsorCells(readme: string) {
  const text = readFileSync(`${REPO_ROOT}${readme}`, "utf8");
  const table = text.slice(text.indexOf("<!-- Sponsors:")).split("</table>")[0];
  return [...table.matchAll(/<td[^>]*>(.*?)<\/td>/g)].map(([, cell]) => {
    const logo = cell.match(
      /^<a href="([^"]+)"><picture><source media="\(prefers-color-scheme: dark\)" srcset="([^"]+)"><img src="([^"]+)"[^>]*><\/picture><\/a><br><sub>([^<]+)<\/sub>$/,
    );
    if (logo) {
      const [, href, onDark, onLight, description] = logo;
      return { href, onDark, onLight, description };
    }
    return { invite: cell.match(/^<a href="([^"]+)">/)?.[1] };
  });
}

describe("SPONSORS", () => {
  it.each(SPONSORS)("ships both logo inks for $name", (sponsor) => {
    expect(existsSync(`${WEBSITE_PUBLIC}${sponsor.logo.onDark}`)).toBe(true);
    expect(existsSync(`${WEBSITE_PUBLIC}${sponsor.logo.onLight}`)).toBe(true);
  });

  // Osuna 的 README 不放赞助商表（规则 1：外链只指向本仓库），上游这条断言改成「README 里没有赞助表」。
  it.each(READMES)("keeps the sponsors table out of %s", (readme) => {
    expect(readmeSponsorCells(readme)).toEqual([]);
  });
});
