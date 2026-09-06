# Security and privacy

Each installation owner controls Cloudflare infrastructure, household membership,
and credentials. All approved members can read/edit all household items and use
recovery tools. This app does not implement per-member roles or private lists.

Private requests require a signed Cloudflare Access JWT for the configured issuer
and audience. Cloudflare Access should protect the entire family hostname. The
optional display exposes limited titles and scheduling data to anyone holding its
URL, so treat the URL as a credential. Notes, full history, and editing endpoints
are excluded. Revoke a display key when its URL is exposed.

D1 holds household data, history, hashed display keys, and push subscriptions.
Browser storage holds device preferences. Notifications send encrypted payloads
through browser push providers. The application includes no advertising or
product-analytics integration. Cloudflare platform logs remain subject to the
owner's configuration. Avoid logging request URLs containing display keys.

## Reporting a vulnerability

Do not post exploit details, household data, credentials, or private deployment
URLs in public issues. Use **Security → Report a vulnerability**, or open the
[private reporting form](https://github.com/jackson-two/daylapse/security/advisories/new),
to send a private report to the maintainers. GitHub private vulnerability
reporting is enabled for this repository. You need a GitHub account to submit
a report.

If the form is unavailable, do not submit sensitive details in a public issue;
wait until the private reporting channel is available.

Provide the affected version, minimal synthetic reproduction, expected/actual
behavior, and impact. Never test an exploit against another person's installation.

## Owner responsibilities

Keep dependencies and deployed code updated, limit Access membership to intended
household members, preserve backups and notification keys, and test recovery in
an isolated database. Removing a member also requires revoking their active
Access sessions if immediate removal is required. Review registered notification
devices and shared display keys separately; those credentials are independent.

Before publication, run the privacy check, review the complete Git history,
and enable repository secret scanning where available. The
included scanner is a targeted check, not a guarantee that all secrets are found.
