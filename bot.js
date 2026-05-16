#!/usr/bin/env node
// Reads restaurants.json, picks N random active ones, posts to Slack.
// Run by GitHub Actions on a schedule, or manually: node bot.js

const fs = require('fs');
const path = require('path');

const WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const PICKS_PER_DAY = parseInt(process.env.PICKS_PER_DAY || '3', 10);

if (!WEBHOOK_URL) {
  console.error('SLACK_WEBHOOK_URL is not set');
  process.exit(1);
}

function pickRestaurants(restaurants, n) {
  const active = restaurants.filter(r => r.active !== false);
  if (active.length === 0) return [];
  // Fisher-Yates shuffle
  for (let i = active.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [active[i], active[j]] = [active[j], active[i]];
  }
  return active.slice(0, Math.min(n, active.length));
}

async function main() {
  const filePath = path.join(__dirname, 'restaurants.json');
  const { restaurants } = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const picks = pickRestaurants(restaurants, PICKS_PER_DAY);

  if (picks.length === 0) {
    console.log('No active restaurants — nothing to post.');
    return;
  }

  const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];
  const day = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    timeZone: 'America/Los_Angeles',
  });

  const lines = picks.map((r, i) => {
    const emoji = emojis[i] || `${i + 1}.`;
    return r.url
      ? `${emoji} *${r.name}* — <${r.url}|Order on DoorDash>`
      : `${emoji} *${r.name}*`;
  });

  const activeCount = restaurants.filter(r => r.active !== false).length;

  const message = {
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: `🍽️ ${day} Lunch Picks`, emoji: true },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `Today's options are in! Vote with a reaction or click to order:\n\n${lines.join('\n')}`,
        },
      },
      {
        type: 'divider',
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `_${activeCount} restaurants in the pool · Use \`/lunch\` to add, remove, or preview_`,
          },
        ],
      },
    ],
  };

  const res = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Slack returned ${res.status}: ${body}`);
  }

  console.log(`✅ Posted ${picks.length} picks (${picks.map(r => r.name).join(', ')})`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
