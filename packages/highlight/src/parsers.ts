import { defineLanguageFacet, Language, StreamLanguage } from "@codemirror/language";
import { dart } from "@codemirror/legacy-modes/mode/clike";
import { diff } from "@codemirror/legacy-modes/mode/diff";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { standardSQL } from "@codemirror/legacy-modes/mode/sql";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { parser as jsParser } from "@lezer/javascript";
import { parser as jsonParser } from "@lezer/json";
import { parser as cssParser } from "@lezer/css";
import { parser as cppParser } from "@lezer/cpp";
import { parser as goParser } from "@lezer/go";
import { parser as htmlParser } from "@lezer/html";
import { parser as javaParser } from "@lezer/java";
import { parser as pythonParser } from "@lezer/python";
import { parser as markdownParser } from "@lezer/markdown";
import { parser as phpParser } from "@lezer/php";
import { parser as rustParser } from "@lezer/rust";
import { parser as xmlParser } from "@lezer/xml";
import { parser as yamlParser } from "@lezer/yaml";
import { parser as elixirParser } from "lezer-elixir";
import { tags } from "@lezer/highlight";
import type { Parser } from "@lezer/common";
import { csharpLanguage } from "./csharp/language.js";
import { astroParser } from "./astro/parser.js";
import { nixLanguage } from "./nix/language.js";
import { parser as svelteBaseParser } from "./svelte/parser.js";
import { configureNesting, defaultNesting } from "./svelte/nesting.js";

function language(parser: Parser): Language {
  return new Language(defineLanguageFacet(), parser);
}

const shellLanguage = StreamLanguage.define(shell);
// diff 的 inserted/deleted 与 ini 值的 quote 在语义角色表里没有对应项，就地映射到
// 现有角色（新增行 string、删除行 keyword，值 string），不给主题加字段。
const diffLanguage = StreamLanguage.define({
  ...diff,
  tokenTable: { inserted: tags.string, deleted: tags.keyword },
});
const iniLanguage = StreamLanguage.define({ ...properties, tokenTable: { quote: tags.string } });

// 键同时服务文件扩展名与 fence 语言名（调用方把 ```bash 当作 `x.bash` 查表）；
// 无扩展名的文件按整个文件名查表，`Dockerfile`（含带目录的路径）因此命中。
const languagesByExtension: Record<string, Language> = {
  // JavaScript/TypeScript
  js: language(jsParser),
  jsx: language(jsParser.configure({ dialect: "jsx" })),
  ts: language(jsParser.configure({ dialect: "ts" })),
  tsx: language(jsParser.configure({ dialect: "ts jsx" })),
  mjs: language(jsParser),
  cjs: language(jsParser),
  // C / C++ / Objective-C
  c: language(cppParser),
  h: language(cppParser),
  cc: language(cppParser),
  cpp: language(cppParser),
  cxx: language(cppParser),
  hpp: language(cppParser),
  hxx: language(cppParser),
  m: language(cppParser),
  mm: language(cppParser),
  // JSON
  json: language(jsonParser),
  // CSS
  css: language(cssParser),
  scss: language(cssParser),
  // HTML
  html: language(htmlParser),
  htm: language(htmlParser),
  // Svelte
  svelte: language(svelteBaseParser.configure({ wrap: configureNesting(defaultNesting) })),
  // Astro
  astro: language(astroParser),
  // XML
  xml: language(xmlParser),
  // Java
  java: language(javaParser),
  // Python
  py: language(pythonParser),
  // Go
  go: language(goParser),
  // PHP
  php: language(phpParser),
  // YAML
  yaml: language(yamlParser),
  yml: language(yamlParser),
  // Rust
  rs: language(rustParser),
  // Swift
  swift: StreamLanguage.define(swift),
  // Dart
  dart: StreamLanguage.define(dart),
  // C#
  cs: csharpLanguage,
  // Nix
  nix: nixLanguage,
  // Elixir
  ex: language(elixirParser),
  exs: language(elixirParser),
  // Shell
  sh: shellLanguage,
  bash: shellLanguage,
  zsh: shellLanguage,
  shell: shellLanguage,
  console: shellLanguage,
  // TOML
  toml: StreamLanguage.define(toml),
  // SQL
  sql: StreamLanguage.define(standardSQL),
  // Diff
  diff: diffLanguage,
  patch: diffLanguage,
  // Dockerfile
  dockerfile: StreamLanguage.define(dockerFile),
  // INI / properties
  ini: iniLanguage,
  properties: iniLanguage,
  // Markdown
  md: language(markdownParser),
  mdx: language(markdownParser),
};

export function getLanguageForFile(filename: string): Language | null {
  const basename = filename.split(/[\\/]/).pop() ?? filename;
  const ext = basename.split(".").pop()?.toLowerCase();
  if (!ext) return null;
  return languagesByExtension[ext] ?? null;
}

export function getParserForFile(filename: string): Parser | null {
  return getLanguageForFile(filename)?.parser ?? null;
}

export function isLanguageSupported(filename: string): boolean {
  return getParserForFile(filename) !== null;
}

export function getSupportedExtensions(): string[] {
  return Object.keys(languagesByExtension);
}
