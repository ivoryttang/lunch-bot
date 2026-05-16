# Lunch Bot

Posts daily lunch options to Slack at 10:45 AM PT, weekdays. Manage the restaurant list directly from Slack with `/lunch` commands. No server required (GitHub Actions + Vercel free tier).

## Setup (~15 min)

### 1. Create the Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**
2. Name it "Lunch Bot", pick your workspace

**Incoming Webhook** (for posting):
- Sidebar → **Incoming Webhooks** → toggle On → **Add New Webhook to Workspace**
- Pick `#office` (or whatever channel) → copy the URL

**Slash Command** (for managing restaurants from Slack):
- Sidebar → **Slash Commands** → **Create New Command**
- Command: `/lunch`
- Request URL: `https://YOUR-VERCEL-PROJECT.vercel.app/slack` ← fill in after step 3
- Short Description: `Manage lunch options`
- Save

**Signing Secret** (for security):
- Sidebar → **Basic Information** → **App Credentials** → copy **Signing Secret**

### 2. Deploy the Vercel function

```bash
npm install -g vercel
cd lunch-bot
vercel deploy --prod
```

Copy the production URL (e.g. `https://lunch-bot-abc123.vercel.app`).

Go back to your Slack app → Slash Commands → edit `/lunch` → update Request URL to:
```
https://lunch-bot-abc123.vercel.app/slack
```

Add environment variables in Vercel dashboard → Settings → Environment Variables:
```
SLACK_SIGNING_SECRET   your signing secret
GITHUB_TOKEN           your GitHub PAT (see below)
GITHUB_REPO            your-username/lunch-bot
PICKS_PER_DAY          3
```

**GitHub PAT**: go to [github.com/settings/tokens](https://github.com/settings/tokens) → Fine-grained tokens → New token → select this repo → Contents: Read and Write.

### 3. Push to GitHub

```bash
cd lunch-bot
git init
git add .
git commit -m "add lunch bot"
gh repo create lunch-bot --public --source=. --push
```

### 4. Add GitHub Actions secret

Repo → **Settings** → **Secrets and Variables** → **Actions** → **New repository secret**:
- Name: `SLACK_WEBHOOK_URL`
- Value: your incoming webhook URL from step 1

### 5. Test it

**Test the Slack command**: type `/lunch list` in Slack — you should see the restaurant list.

**Test the daily post**: Actions tab → **Lunch Bot** → **Run workflow** → confirm it fires.

---

## Slash Commands

| Command | What it does |
|---|---|
| `/lunch list` | Show all restaurants (active + inactive) |
| `/lunch add Chipotle \| https://doordash.com/...` | Add a restaurant (URL optional) |
| `/lunch remove Chipotle` | Remove from rotation (soft delete) |
| `/lunch enable Chipotle` | Re-enable a removed restaurant |
| `/lunch preview` | Preview today's random picks |
| `/lunch help` | Show all commands |

## Editing restaurants directly

You can also edit `restaurants.json` directly in the repo. Each restaurant has:
```json
{ "name": "Restaurant Name", "url": "https://doordash.com/...", "active": true }
```
Set `"active": false` to remove without deleting. The bot reads the file fresh each run.

## Timezone

The workflow fires at **10:45 AM PT** automatically, handling both PST and PDT via a gate step. No manual updates needed when clocks change.
