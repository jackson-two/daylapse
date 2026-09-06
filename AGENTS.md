# Working on Daylapse

Daylapse is a Cloudflare-only, single-household app. Approved members share editing
rights; the optional display is read-only. Read `docs/deployment.md` before setup
and `CONTRIBUTING.md` before code changes.

## Deployment contract

- Owner settings belong in ignored `installation.json`. Generate deployment
  configuration with `npm run setup -- check`; never edit source hostnames.
  Checked-in `wrangler.jsonc` is local only.
- Use the runbook commands. Database commands require `--local` or `--remote`.
  `npm run deploy` rebuilds for the selected installation. Never deploy stale
  output or a local-development configuration. Avoid concurrent builds/deploys.
- Scope remote actions to the owner's selected Worker/database. New installations
  use new resources. Never adopt another household's database or change existing
  applications or account-wide Access policies. Verify names and IDs first.
- Never clear tables or rerun legacy cutover to fix startup. Initialization is
  guarded for empty databases; upgrades apply pending migrations and preserve data.
- Never replace notification secrets or revoke display keys during an upgrade.
  Those are explicit operations. Keep credentials, private URLs, exports, account
  details, and household content out of source, logs, issues, PRs, and chat output.
- Respect existing user authorization. Ask only for missing information or actions
  outside the agreed scope. Let the owner complete account login; never ask for
  passwords or session tokens in chat.
- Verify anonymous denial, authenticated household use, and enabled features.
  An upload or anonymous-only smoke check does not prove login works. Report
  untested checks and remaining manual steps honestly.

## Implementation and verification

`worker/index.ts` uses `lib/worker-request.ts` to call `lib/access-policy.ts`
before serving static assets or invoking the framework. Preserve JWT
signature, issuer, audience, and expiry checks. Do not trust email headers alone.
The display has an explicit read-only path allowlist and a hashed access key.
Never add production authentication bypasses to make a test or deployment pass.

Run `npm ci`, `npm run lint`, `npx tsc --noEmit`, and `npm test`. Keep both lockfiles
consistent when dependencies change. Regenerate binding types with `npx wrangler
types` against the checked-in local config; preserve optional-secret augmentation
in `env.d.ts`. Tests need loopback ports and use disposable D1 and synthetic data.

Do not alter applied SQL migrations. Add migrations and test preservation of
populated data. Test failure paths and repeated setup operations. Consult current
official Cloudflare documentation for API/configuration details.

The owner selected the MIT License in `LICENSE`, with Jackson Two LLC as the
copyright holder, and GitHub private vulnerability reporting for security
reports. Do not publish a contact email. Enable and verify private reporting
on the selected public repository before release. Do not invent a public
repository URL or release status.
