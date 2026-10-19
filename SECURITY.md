# Security

## Reporting

Please report vulnerabilities privately through GitHub: **Security → Report a vulnerability** on this repository. Do not open a public issue.

## How secrets are handled

- No credentials live in this repository. The collector reads them from GitHub Actions secrets (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, optional `RADAR_GH_TOKEN`); the website reads them from Vercel environment variables.
- The Supabase service-role key is used only server-side (collector and the `/api/feedback` route). It is never sent to the browser.
- Row level security is on for every table. The anon key can only read `site_snapshot` and `feedback`.
- `/api/feedback` accepts writes only with the owner's `FEEDBACK_KEY` (sent as `x-radar-key`). Deployed without that variable, writes are refused.
- Collector logs never include request URLs, so the Telegram bot token can't leak into public Actions logs.
- Workflows run with a read-only `GITHUB_TOKEN`; only the monthly retrain job may push its model report.

If a key is exposed, rotate it at the source (Supabase → Settings → API Keys, @BotFather → /revoke) and update the secret.
