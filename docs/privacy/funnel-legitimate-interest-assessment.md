# Legitimate Interest Assessment: funnel messages fetch

- **Status:** Accepted, 2026-11-06
- **Scope:** the one default-on network request ruflo makes: `GET https://funnel.ruv.io/v1/messages`
- **Basis:** ADR-309 "operational telemetry: legitimate-interest basis, with a documented, minimized Legitimate Interest Assessment checked into the repo"
- **Out of scope:** opt-in event telemetry (`POST /v1/events`, the pseudonymous funnel ID). That runs on explicit consent (ADR-302 `telemetry` domain, `ruflo funnel telemetry on`), not on legitimate interest.

## 1. What is processed

| Data | Source | Why |
|---|---|---|
| Source IP address | the HTTPS connection itself | unavoidable for any request; used server-side only to count distinct clients per day |
| User-Agent `ruflo-funnel/messages ruflo/<version> (<platform>; <arch>)`, plus ` surface/plugin` when the ruflo-core plugin started the CLI | the CLI | release adoption, OS support, and how many people use ruflo only as a Claude Code plugin |
| Request time | the server | daily aggregation |

Nothing else is sent. The request carries no ID, path, hostname, username, repository, prompt, command line, or account data. The CLI sanitizes the User-Agent fields to token characters (`funnelUserAgent()` in `v3/@claude-flow/cli/src/funnel/message-transport.ts`).

**When it happens:** at most once per Claude Code session, from the SessionStart hook (`hooks refresh-funnel`) or, for plugin-only users who never ran `init`, when the ruflo-core plugin starts the MCP server (`mcp start` with `RUFLO_LAUNCH_SURFACE=plugin`). Either way it happens at most once per 6 hours per machine because of the local cache. `surface` is a closed allowlist (`plugin`); any other value is dropped.

## 2. Purpose test

ruflo is free, open-source software with no accounts. This request is the only way the maintainers can tell:

- how many installations are active day to day and month to month;
- which releases are still in use, so fixes and security advisories can be targeted;
- which operating systems and CPU families to support and test.

It also delivers the statusline tips the user sees, so the request serves the user as well as the maintainers.

## 3. Necessity test

- **npm download counts are not a substitute.** CI pipelines and repeated `npx` downloads inflate them, and they cannot show active use or release adoption.
- **Asking everyone for consent first would remove the signal.** Without the default request there is no measure of active use at all.
- **The data is the minimum that answers the purpose.** There is no persistent identifier. Distinct clients are counted by IP, with IPv6 grouped per /64, which already undercounts behind NAT. That is an accepted cost of not identifying anyone.

## 4. Balancing test

- **Reasonable expectation:** a developer tool fetching tips and checking release information is common practice. The first statusline message discloses the funnel (ADR-301) and how to turn it off.
- **Impact on the individual:** low. An IP address is personal data under GDPR, so it is treated as such:
  - raw request logs keep the IP for **30 days** (Cloud Logging default, and the BigQuery raw table's partition expiry);
  - the long-lived dataset `ruflo_funnel.daily_active` holds **counts only, never IPs**.
- **Control:** every opt-out stops the request. This is enforced in `hooks refresh-funnel` and in `mcp start`, and covered by `__tests__/funnel-telemetry-optout.test.ts`. The opt-outs are:
  - `ruflo funnel disable` (user-wide);
  - `funnel.enabled: false` in `claude-flow.config.json` (per project);
  - `RUFLO_FUNNEL=0` or `RUFLO_FUNNEL_MESSAGES=0` (environment);
  - an enterprise policy file;
  - declining the disclosure.
- **No profiling:** request data is never joined with Cognitum accounts or with opt-in telemetry events (ADR-309 "no cross-product behavioral profiling").

**Conclusion:** the interest is legitimate, the processing is necessary and minimal, and the user's interests do not override it. This is conditional on the controls above holding, and they are covered by tests.

## 5. Review

Re-assess this document if any of the following happens:

- a field is added to the request;
- raw-log retention is extended beyond 30 days;
- request data is joined with any other dataset;
- the request starts carrying an identifier.
