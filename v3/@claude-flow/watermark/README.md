# @claude-flow/watermark (non-canonical mirror)

This directory is **not** the source of the published
[`@claude-flow/watermark`](https://www.npmjs.com/package/@claude-flow/watermark)
package or the `ruflo-watermark` crate. It is a stale 0.2.0 snapshot kept only
as a workspace reference.

The canonical source, current API, issue tracker and releases live in
[`ruvnet/ai-text-watermark`](https://github.com/ruvnet/ai-text-watermark/tree/main/packages/watermark).
The Rust crate is
[`ai-text-watermark/crates/ruflo-watermark`](https://github.com/ruvnet/ai-text-watermark/tree/main/crates/ruflo-watermark).

```bash
npm install @claude-flow/watermark   # resolves the canonical 0.4.x package
```

Do not publish from this directory. Both
`v3/@claude-flow/watermark/package.json` (`"private": true`) and
`v3/crates/ruflo-watermark/Cargo.toml` (`publish = false`) are pinned shut;
see [#4959](https://github.com/ruvnet/ruflo/issues/4959).
