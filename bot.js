#!/usr/bin/env node
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const { pickOptions, buildMessage, dayName, PICKS_PER_DAY, NUMBER_REACTIONS } = require('./message');
const { getJson, updateJson } = require('./github');

const BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const CHANNEL = process.env.SLACK_CHANNEL;
const WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

// Call a Slack Web API method with the bot token.
async function slack(method, body) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${BOT_TOKEN}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack ${method} failed: ${data.error}`);
  return data;
}

// Record ts → [option names] so the Events API handler can map a number
// reaction back to the option it votes for. Keeps the most recent 30 polls.
async function recordPoll(ts, names) {
  await updateJson(
    'polls.json',
    { polls: {} },
    data => {
      data.polls = data.polls || {};
      data.polls[ts] = names;
      const keys = Object.keys(data.polls);
      if (keys.length > 30) {
        for (const k of keys.slice(0, keys.length - 30)) delete data.polls[k];
      }
    },
    `Record poll ${ts}`
  );
}

async function main() {
  if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_REPO) {
    throw new Error('Set GITHUB_TOKEN + GITHUB_REPO to read restaurants.json from GitHub');
  }

  const { data } = await getJson('restaurants.json', { restaurants: [] });
  const { restaurants } = data;

  const activeCount = restaurants.filter(r => r.active !== false).length;
  const picks = pickOptions(restaurants, PICKS_PER_DAY);

  if (picks.length === 0) {
    console.log('No active options — nothing to post.');
    return;
  }

  const message = buildMessage({ picks, activeCount, day: dayName() });

  // Preferred path: Web API, which returns the ts so we can seed the number
  // reactions and wire up reaction-based voting.
  if (BOT_TOKEN && CHANNEL) {
    const posted = await slack('chat.postMessage', { channel: CHANNEL, ...message });
    const ts = posted.ts;

    // Seed 1️⃣–N️⃣ so voting is a single tap.
    for (let i = 0; i < picks.length && i < NUMBER_REACTIONS.length; i++) {
      await slack('reactions.add', { channel: CHANNEL, timestamp: ts, name: NUMBER_REACTIONS[i] })
        .catch(err => console.error(`  reaction ${NUMBER_REACTIONS[i]}: ${err.message}`));
    }

    await recordPoll(ts, picks.map(r => r.name));
    console.log(`✅ Posted ${picks.length} options (${picks.map(r => r.name).join(', ')}) ts=${ts}`);
    return;
  }

  // Fallback: incoming webhook. Posts fine, but voting is disabled (no ts).
  if (WEBHOOK_URL) {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });
    if (!res.ok) throw new Error(`Slack returned ${res.status}: ${await res.text()}`);
    console.log(
      `✅ Posted ${picks.length} options via webhook ` +
        `(set SLACK_BOT_TOKEN + SLACK_CHANNEL to enable reaction voting)`
    );
    return;
  }

  throw new Error('Set SLACK_BOT_TOKEN + SLACK_CHANNEL (for voting) or SLACK_WEBHOOK_URL');
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
