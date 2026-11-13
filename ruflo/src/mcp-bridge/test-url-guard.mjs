#!/usr/bin/env node
// SSRF guard tests for both bridge copies. Run: node test-url-guard.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COPIES = [
  path.join(HERE, "url-guard.js"),
  path.join(HERE, "..", "ruvocal", "mcp-bridge", "url-guard.js"),
];

assert.equal(
  fs.readFileSync(COPIES[0], "utf8"),
  fs.readFileSync(COPIES[1], "utf8"),
  "the two url-guard.js copies must be byte-identical",
);

const REJECTED = [
  "http://example.com/",                 // not HTTPS
  "file:///etc/passwd",
  "not a url",
  "https://localhost/",
  "https://LOCALHOST./",                 // case and trailing dot
  "https://api.localhost/",
  "https://printer.local/",
  "https://metadata.google.internal/",
  "https://mcp-bridge/",                 // dotless Docker service name
  "https://127.0.0.1/",
  "https://2130706433/",                 // 127.0.0.1 as a decimal integer
  "https://0x7f.1/",                     // 127.0.0.1 in hex shorthand
  "https://0.0.0.0/",
  "https://10.1.2.3/",
  "https://172.16.0.1/",
  "https://172.31.255.255/",
  "https://192.168.1.1/",
  "https://169.254.169.254/latest/meta-data/", // cloud metadata
  "https://100.64.0.1/",                 // carrier-grade NAT
  "https://224.0.0.1/",
  "https://255.255.255.255/",
  "https://[::1]/",
  "https://[::]/",
  "https://[::ffff:127.0.0.1]/",         // IPv4-mapped loopback
  "https://[::ffff:169.254.169.254]/",
  "https://[fc00::1]/",
  "https://[fd12:3456::1]/",
  "https://[fe80::1]/",
  "https://[64:ff9b::7f00:1]/",          // NAT64 of 127.0.0.1
];

const ACCEPTED = [
  "https://example.com/path?x=1",
  "https://us-central1-proj.cloudfunctions.net/search",
  "https://fcc.gov/",                    // the old regex refused any host starting "fc"/"fd"
  "https://fda.gov/",
  "https://172.15.0.1/",                 // just outside 172.16/12
  "https://172.32.0.1/",
  "https://8.8.8.8/",
  "https://[2606:4700:4700::1111]/",
];

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (err) { failures++; console.log(`  ✗ ${name}\n    ${err.message}`); }
};
const checkAsync = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (err) { failures++; console.log(`  ✗ ${name}\n    ${err.message}`); }
};

for (const file of COPIES) {
  console.log(`\n# ${path.relative(path.join(HERE, "..", ".."), file)}`);
  const { assertSafeUrl, assertPublicUrl, isBlockedAddress } = await import(pathToFileURL(file).href);

  for (const url of REJECTED) {
    check(`rejects ${url}`, () => assert.throws(() => assertSafeUrl(url), /SSRF guard/));
  }
  for (const url of ACCEPTED) {
    check(`accepts ${url}`, () => assert.doesNotThrow(() => assertSafeUrl(url)));
  }
  check("an invalid-URL error does not echo the input", () => {
    assert.throws(() => assertSafeUrl("https://user:secret@"), (err) => !err.message.includes("secret"));
  });
  check("a non-IP string is treated as blocked", () => assert.equal(isBlockedAddress("example.com"), true));

  const resolvesTo = (...addresses) => async () => addresses.map((address) => ({ address }));
  await checkAsync("refuses a public name that resolves to loopback", () =>
    assert.rejects(assertPublicUrl("https://rebind.example.com/", resolvesTo("127.0.0.1")), /resolves to a private/));
  await checkAsync("refuses when any one resolved address is private", () =>
    assert.rejects(assertPublicUrl("https://rebind.example.com/", resolvesTo("93.184.216.34", "10.0.0.5")), /resolves to a private/));
  await checkAsync("refuses a name that resolves to the metadata address over IPv6-mapped IPv4", () =>
    assert.rejects(assertPublicUrl("https://rebind.example.com/", resolvesTo("::ffff:169.254.169.254")), /resolves to a private/));
  await checkAsync("refuses a name that does not resolve", () =>
    assert.rejects(assertPublicUrl("https://nothing.example.com/", resolvesTo()), /did not resolve/));
  await checkAsync("accepts a name that resolves only to public addresses", async () => {
    const parsed = await assertPublicUrl("https://ok.example.com/x", resolvesTo("93.184.216.34", "2606:4700:4700::1111"));
    assert.equal(parsed.hostname, "ok.example.com");
  });
  await checkAsync("does not resolve an IP literal", async () => {
    await assertPublicUrl("https://8.8.8.8/", async () => { throw new Error("lookup must not be called"); });
  });
  await checkAsync("rejects before resolving when the URL itself is unsafe", () =>
    assert.rejects(assertPublicUrl("http://example.com/", async () => { throw new Error("lookup must not be called"); }), /only HTTPS/));
}

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nurl-guard: all checks passed");
