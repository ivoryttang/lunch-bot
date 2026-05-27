# Dinner Bot

Posts **2 random dinner options** to Slack every day, with a **🎲 Regenerate** button to reroll the picks. Anyone in the channel can add, remove, or view options with `/lunch` commands. No always-on server required — the daily post runs from a local Mac via launchd, and the Slack commands/button run on the Vercel free tier.

## How it works

- **Daily post** (`bot.js`): picks `PICKS_PER_DAY` (default 2) random options from `restaurants.json` and posts them to Slack via an incoming webhook.
- **Regenerate button**: clicking it hits the Vercel function, which rerolls and replaces the message in place.
- **`/lunch` commands** (`api/slack.js`): read/write the master list (`restaurants.json`) directly in the GitHub repo via the GitHub API, so changes stick across runs.

## Setup (~15 min)

### 1. Create the Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**
2. Name it "Dinner Bot", pick your workspace

**Incoming Webhook** (for the daily post):
- Sidebar → **Incoming Webhooks** → toggle On → **Add New Webhook to Workspace**
- Pick `#office` (or whatever channel) → copy the URL

**Slash Command** (for managing options from Slack):
- Sidebar → **Slash Commands** → **Create New Command**
- Command: `/lunch`
- Request URL: `https://YOUR-VERCEL-PROJECT.vercel.app/slack` ← fill in after step 3
- Short Description: `Manage dinner options`
- Save

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

`bot.js` posts the daily message. It needs `SLACK_WEBHOOK_URL` (and optionally `PICKS_PER_DAY`) in `.env`. Run it manually to test:

```bash
node bot.js
```

To post automatically every day, schedule it with a launchd agent (`~/Library/LaunchAgents/…plist`) running `node /path/to/lunch-bot/bot.js` at your preferred dinner time. Adjust the `StartCalendarInterval` hour to whenever you want the post to land.

> The included GitHub Actions workflow (`.github/workflows/lunch-bot.yml`) is **manual-trigger only** (`workflow_dispatch`) — handy for firing a post from the Actions tab. It needs a `SLACK_WEBHOOK_URL` repo secret (Settings → Secrets and Variables → Actions).

### 5. Test it

- **Slash command**: type `/lunch list` in Slack — you should see the full options list.
- **Daily post**: run `node bot.js` locally, or trigger the GitHub Action.
- **Regenerate**: click the 🎲 button on the post — the picks should reroll in place.

---

## Slash Commands

Anyone in the channel can run these:

| Command | What it does |
|---|---|
| `/lunch list` | Show every option (active + removed) |
| `/lunch add Tacko` | Add an option to the master list |
| `/lunch remove Tacko` | Remove an option from the rotation (soft delete) |
| `/lunch enable Tacko` | Bring back a removed option |
| `/lunch preview` | Preview tonight's random picks (only you see it) |
| `/lunch help` | Show all commands |

## Editing the list directly

You can also edit `restaurants.json` in the repo. Each option is:
```json
{ "name": "Restaurant Name", "active": true }
```
Set `"active": false` to remove it without deleting. Both the daily post and the `/lunch` commands read the file fresh, so edits take effect immediately.
