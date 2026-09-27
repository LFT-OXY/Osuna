import assert from "node:assert/strict";
import { test } from "vitest";
import { checkDesignatedRequirement, normalizeSha1 } from "./verify-mac-signature.mjs";

const SHA1 = "28F2A1B3C4D5E6F708192A3B4C5D6E7F8091591B";

function codesignOutput(designated) {
  return `Executable=/tmp/Osuna.app/Contents/MacOS/Osuna\ndesignated => ${designated}\n`;
}

test("accepts a requirement pinned to the expected certificate", () => {
  const output = codesignOutput(
    `identifier "com.chinhae.osuna.desktop" and certificate leaf = H"${SHA1.toLowerCase()}"`,
  );
  assert.equal(checkDesignatedRequirement(output, SHA1), null);
});

test("normalizes a colon-separated lowercase fingerprint", () => {
  const colonSeparated = SHA1.toLowerCase().match(/../g).join(":");
  assert.equal(normalizeSha1(colonSeparated), SHA1);
});

test("accepts a self-signed certificate pinned as the chain root", () => {
  // 叶证书带 Organization 时，codesign 沿链上溯，自签证书的链只有一张，于是写成 root。
  const output = codesignOutput(
    `identifier "sh.paseo.desktop" and certificate root = H"${SHA1.toLowerCase()}"`,
  );
  assert.equal(checkDesignatedRequirement(output, SHA1), null);
});

test("rejects a chain root that is a different certificate", () => {
  const output = codesignOutput(
    `identifier "x" and certificate root = H"5a1b00000000000000000000000000000000c883"`,
  );
  assert.match(checkDesignatedRequirement(output, SHA1), /not pinned to certificate/);
});

test("rejects an ad-hoc requirement pinned to the cdhash", () => {
  const output = codesignOutput(`cdhash H"a4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5"`);
  assert.match(checkDesignatedRequirement(output, SHA1), /pinned to a cdhash/);
});

test("rejects the implicit cdhash requirement codesign prints as a comment", () => {
  const output = `# designated => cdhash H"c3fa0d2418f164f9e3db65d856f937dbb92c5141" or cdhash H"f4273b7cc50565fe71f9e4e4a4beb85bdfb880b3"\n`;
  assert.match(checkDesignatedRequirement(output, SHA1), /pinned to a cdhash/);
});

test("rejects a requirement pinned to a different certificate", () => {
  const output = codesignOutput(
    `identifier "x" and certificate leaf = H"5a1b000000000000000000000000000000c883"`,
  );
  assert.match(checkDesignatedRequirement(output, SHA1), /not pinned to certificate/);
});

test("rejects an unsigned bundle", () => {
  const output = "/tmp/Osuna.app: code object is not signed at all\n";
  assert.match(checkDesignatedRequirement(output, SHA1), /No designated requirement/);
});

test("rejects a malformed fingerprint", () => {
  assert.throws(() => normalizeSha1("not-a-fingerprint"), /SHA-1/);
});
