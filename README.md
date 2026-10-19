# PR Radar

Finds open-source issues where an outside PR is likely to get merged, explains why, and pings your phone.

Live: https://pr-radar-nikhil.vercel.app · Telegram alerts: https://t.me/nikhil_pr_radar_bot

- **Collector** (`collector/`, Python 3.12 + uv): GitHub Search + GraphQL, Hacker News (Algolia), release feeds, optional `github.com/trending` scrape. Runs every 30 minutes on GitHub Actions.
- **Score v1**: a transparent weighted formula over repo health signals, with the reasons stored next to every score.
- **Website** (`web/`, Next.js 16 + Tailwind 4 + Motion): radar overview, ranked opportunities with feedback buttons, trending repos, signals feed, repo detail, model lab. Command palette on `Ctrl/⌘ K` or `/`.
- **Public Telegram bot**: anyone can open the bot and send `/start`. Each subscriber picks a minimum score (`/min 80`), languages (`/lang python rust`), and turns alerts or the 08:00 IST digest on or off; `/top` shows the best picks now and `/stop` unsubscribes. Only the chat id and those settings are stored.
- **ML** (`collector/ml/`): LightGBM merge-probability model trained on the public ClickHouse `github_events` dataset, compared against score v1 on a time split. It replaces v1 only if it wins clearly.

## Run it locally (no accounts needed)

```bash
cd collector
uv sync
uv run radar run --no-alerts     # ~5 min; uses `gh auth token`, writes data/radar.db and web/data/snapshot.json
uv run pytest -q

cd ../web
npm install
npm run dev                      # http://localhost:3000
```

Without Supabase variables the collector stores everything in SQLite (`data/radar.db`) and the site reads `web/data/snapshot.json`. Feedback clicks go to `web/data/feedback.local.json` and are imported on the next collector run.

## Production setup

1. **Supabase**: create a project, run `supabase/migrations/0001_init.sql` in the SQL editor.
2. **GitHub repo secrets** (Settings → Secrets → Actions):
   - `RADAR_GH_TOKEN`: fine-grained token, public repositories read-only. The built-in `GITHUB_TOKEN` only gets 1,000 GraphQL points/hour.
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
   - `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (create the bot with @BotFather, then read your chat id from `https://api.telegram.org/bot<TOKEN>/getUpdates` after messaging it)
   - repo variables: `RADAR_SITE_URL`, optionally `RADAR_ALERT_THRESHOLD`
3. **Vercel**: import the repo with root directory `web/`, set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
   Then run `powershell -File scripts/set-feedback-key.ps1` once: it sets `FEEDBACK_KEY` and prints a private unlock link. Without it the deployed site refuses feedback writes (clicks stay in your browser only). See [SECURITY.md](SECURITY.md).
4. **Public bot** (optional): run `supabase/migrations/0003_subscribers.sql`, add a random `TELEGRAM_WEBHOOK_SECRET` to both GitHub secrets and Vercel, then run the `maintenance` workflow with `telegram-setup`. The webhook (`/api/telegram`) rejects requests without Telegram's secret header, answers private chats only, stores nothing for people who never sent `/start`, and rate-limits each chat to 12 commands a minute.
5. Workflows: `collect` (every 30 min), `digest` (02:30 UTC = 08:00 IST), `retrain` (monthly), `ci` (push/PR).

## How the score works

```
score = 0.45 merge_rate + 0.20 fast_response + 0.10 low_backlog
      + 0.10 active_maintainers + 0.10 fresh_and_unclaimed + 0.05 label_bonus
      = 0 if the repo bans AI-assisted PRs, a linked open/merged PR exists, or someone is assigned
```

- *Outsider* = `authorAssociation` in `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, `FIRST_TIMER`, `NONE`.
- Merge rate is shrunk toward 50% (`(merged+1)/(closed+2)`) so 2/2 doesn't look certain.
- First response counts unanswered PRs older than 2 days at their current wait, so silent repos don't look fast.
- AI policy is a keyword classifier over `CONTRIBUTING.md` (four locations), `AI_POLICY.md` and the PR template: `banned` is a hard filter, `disclose` is shown as a warning.
- Issues labelled duplicate / wontfix / invalid / stale / question / RFC / tracking are skipped.
- Ranking order applies a 0.8× decay per extra issue from the same repo, so one busy repo can't fill the page. The displayed score is not changed.
- Signals are cached for 8 hours (`RADAR_SIGNALS_TTL_H`) to stay inside the GraphQL budget; a full run costs about 200 points.

## The model

```bash
cd collector
uv sync --extra ml
uv run python -m ml.build_dataset   # ~2 min of ClickHouse queries, cached in data/ml/raw.pkl
uv run python -m ml.train           # writes ml/model_live.txt and web/data/model_report.json
```

- Data: outsider PRs (bots excluded) opened 2024-07 to 2025-08 in ~180 repos with 500+ stars. Label: merged within 30 days.
- Why not the last 12 months: since about October 2025 the public events feed is trimmed (`author_association` is always `NONE`, additions/deletions are 0, merge flags are missing). Training on it would mean training on broken labels.
- Every feature is computed from events strictly before the PR was opened. Train/test split is by time (test = PRs opened from 2025-04-01).
- Two models: **full** (adds PR size, title keywords and author history; shows what is learnable) and **live** (only the repo signals the collector has when ranking an issue). Only **live** is compared with v1 and can replace it, and only if it wins by at least 0.02 AUC.

## Layout

```
collector/radar/   collectors, signals, score v1, pipeline, Telegram, CLI
collector/ml/      dataset builder and trainer
collector/tests/   unit tests for scoring, signals, AI-policy classifier
supabase/          schema
web/               Next.js site
.github/workflows/ collect, digest, retrain, ci
```
