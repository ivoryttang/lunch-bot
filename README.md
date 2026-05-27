# Dinner Bot

Posts **2 random dinner options** to Slack every day, with a **🎲 Regenerate** button to reroll. People **vote by reacting** with 1️⃣/2️⃣, and votes **weight future picks** so crowd-favorites get surfaced more often. Anyone in the channel can add, remove, or view options with `/lunch` commands. No always-on server required — the daily post runs from a local Mac via launchd, and the Slack commands/button/reactions run on the Vercel free tier.

## How it works

- **Daily post** (`bot.js`): picks `PICKS_PER_DAY` (default 2) options from `restaurants.json` using **weighted** random selection, posts them via the Slack Web API, and seeds 1️⃣–N️⃣ reactions so voting is one tap.
- **Voting**: reacting with the number next to an option casts a vote. The Events API delivers `reaction_added`/`reaction_removed` to the Vercel function, which records a per-option `votes` count in `restaurants.json`.
- **Weighting** (`message.js`): an option's pick weight is `(1 + votes)²` ("strong favorites" — a +5 spot is ~36× as likely as an unvoted one). `polls.json` maps each posted message to its options so a reaction can be traced back to the right one.
- **Regenerate button** + **`/lunch` commands** (`api/slack.js`): reroll the picks or read/write the master list directly in the GitHub repo via the GitHub API, so changes stick across runs.

## Setup (~15 min)

### 1. Create the Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**
2. Name it "Dinner Bot", pick your workspace

**Bot Token & Scopes** (for posting + reaction voting):
- Sidebar → **OAuth & Permissions** → **Scopes** → **Bot Token Scopes**, add:
  - `chat:write` — post the daily message
  - `reactions:write` — seed the 1️⃣/2️⃣ reactions
  - `reactions:read` — receive votes via the Events API
- **Install to Workspace** (top of the same page) → copy the **Bot User OAuth Token** (`xoxb-…`)
- In Slack, invite the bot to your channel: `/invite @Dinner Bot`
- Get the **channel ID**: in Slack, click the channel name → bottom of the popup shows an ID like `C0123ABCD`

**Event Subscriptions** (for receiving votes):
- Sidebar → **Event Subscriptions** → toggle On
- Request URL: `https://YOUR-VERCEL-PROJECT.vercel.app/slack` (same endpoint; fill in after step 2 — it must be live first for Slack to verify it)
- **Subscribe to bot events**: add `reaction_added` and `reaction_removed`
- Save, and reinstall the app if prompted

**Slash Commands** (for managing options from Slack):
- Sidebar → **Slash Commands** → **Create New Command**, add two (both pointing at the same Request URL `https://YOUR-VERCEL-PROJECT.vercel.app/slack`, filled in after step 2):
  - `/lunch` — Short Description: `Manage dinner options`
  - `/kaboom` — Short Description: `Permanently delete an option`

**Interactivity** (for the Regenerate button):
- Sidebar → **Interactivity & Shortcuts** → toggle On
- Request URL: `https://YOUR-VERCEL-PROJECT.vercel.app/slack` (same endpoint as the slash command)
- Save

**Signing Secret** (for security):
- Sidebar → **Basic Information** → **App Credentials** → copy **Signing Secret**

### 2. Deploy the Vercel function

```bash
npm install -g vercel
cd lunch-bot
vercel deploy --prod
```

Copy the production URL (e.g. `https://lunch-bot-abc123.vercel.app`). Go back to your Slack app and set both the **Slash Command** and **Interactivity** Request URLs to:
```
https://lunch-bot-abc123.vercel.app/slack
```

Add environment variables in Vercel dashboard → Settings → Environment Variables:
```
SLACK_SIGNING_SECRET   your signing secret
GITHUB_TOKEN           your GitHub PAT (see below)
GITHUB_REPO            your-username/lunch-bot
PICKS_PER_DAY          2
```

**GitHub PAT**: go to [github.com/settings/tokens](https://github.com/settings/tokens) → Fine-grained tokens → New token → select this repo → Contents: Read and Write.

### 3. Push to GitHub

```bash
cd lunch-bot
git add .
git commit -m "dinner bot"
git push
```

### 4. Schedule the daily post (local Mac, launchd)

`bot.js` posts the daily message. Put these in `.env` (local, gitignored):

```
SLACK_BOT_TOKEN   xoxb-…              (enables voting)
SLACK_CHANNEL     C0123ABCD           (the channel ID to post in)
GITHUB_TOKEN      your GitHub PAT     (to record poll mappings)
GITHUB_REPO       your-username/lunch-bot
PICKS_PER_DAY     2
```

Run it manually to test:

```bash
node bot.js
```

> Without `SLACK_BOT_TOKEN`/`SLACK_CHANNEL`, `bot.js` falls back to posting via `SLACK_WEBHOOK_URL` — but reaction voting is disabled (a webhook can't return the message timestamp needed to track votes).

To post automatically every day, schedule it with a launchd agent (`~/Library/LaunchAgents/…plist`) running `node /path/to/lunch-bot/bot.js` at your preferred dinner time. Adjust the `StartCalendarInterval` hour to whenever you want the post to land.

> The included GitHub Actions workflow (`.github/workflows/lunch-bot.yml`) is **manual-trigger only** (`workflow_dispatch`). To enable voting from it too, add `SLACK_BOT_TOKEN`, `SLACK_CHANNEL`, `GITHUB_TOKEN`, and `GITHUB_REPO` as repo secrets.

### 5. Test it

- **Slash command**: type `/lunch list` in Slack — you should see the options ranked by votes.
- **Daily post**: run `node bot.js` locally — it posts and seeds 1️⃣/2️⃣ reactions.
- **Voting**: react 1️⃣ on the post, then `/lunch list` — that option's 👍 count should tick up.
- **Regenerate**: click the 🎲 button — the picks reroll in place.

---

## Slash Commands

Anyone in the channel can run these:

| Command | What it does |
|---|---|
| `/lunch list` | Show options ranked by votes (👍 counts shown) |
| `/lunch add Tacko` | Add an option (rejects likely duplicates — see below) |
| `/lunch add! Tacko` | Force-add even if it looks like a duplicate |
| `/lunch remove Tacko` | Remove an option from the rotation (soft delete) |
| `/lunch enable Tacko` | Bring back a removed option |
| `/kaboom Tacko` | **Permanently** delete an option (no undo) |
| `/lunch preview` | Preview tonight's random picks (only you see it) |
| `/lunch help` | Show all commands |

## Voting & weighting

The daily post lists options numbered 1️⃣, 2️⃣, … and `bot.js` pre-seeds those reactions. **React with the number to vote** for an option (un-react to take it back). Each vote bumps that option's `votes` count in `restaurants.json`.

Votes feed the picker: an option's weight is `(1 + votes)²`, so favorites dominate while unvoted spots still appear occasionally (weight never drops to zero). Votes are **cumulative** across all days — there's no decay, so the all-time crowd-pleasers rise to the top. See current standings with `/lunch list`.

> Only the number reactions (1️⃣–5️⃣, matching the listed options) count as votes — other emoji are ignored. After a **Regenerate**, the message keeps its reactions but they re-point at the new picks.

## Duplicate detection

`/lunch add` runs the candidate through fuzzy matching (`dedupe.js`) before adding it, so you can't pile up the same place twice. It catches casing, punctuation, and spacing variants (`Gott's Roadside` = `gotts roadside`, `Sweet Green` = `Sweetgreen`), single-character typos (`Marafuku` ≈ `Marufuku`), and prefixes (`Roam` ≈ `Roam Artisan Burgers`). It's deliberately tight, so genuinely different lookalikes stay separate (`Dumpling Home`, `Dumpling Time`, and `Dumpling House` are all distinct). If it flags something that really is new, add it with `/lunch add! <name>`.

## Editing the list directly

You can also edit `restaurants.json` in the repo. Each option is:
```json
{ "name": "Restaurant Name", "active": true }
```
Set `"active": false` to remove it without deleting. Both the daily post and the `/lunch` commands read the file fresh, so edits take effect immediately.
