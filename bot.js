#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const PICKS_PER_DAY = parseInt(process.env.PICKS_PER_DAY || '3', 10);
const USE_GROUP_ORDERS = process.env.DOORDASH_COOKIES ? true : false;

if (!WEBHOOK_URL) {
  console.error('SLACK_WEBHOOK_URL is not set');
  process.exit(1);
}

function pickRestaurants(restaurants, n) {
  const active = restaurants.filter(r => r.active !== false);
  if (active.length === 0) return [];
  for (let i = active.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [active[i], active[j]] = [active[j], active[i]];
  }
  return active.slice(0, Math.min(n, active.length));
}

async function main() {
  const { restaurants } = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'restaurants.json'), 'utf8')
  );
  let picks = pickRestaurants(restaurants, PICKS_PER_DAY);

  if (picks.length === 0) {
    console.log('No active restaurants — nothing to post.');
    return;
  }

  // Create DoorDash group orders if credentials are available
  if (USE_GROUP_ORDERS) {
    console.log('Creating DoorDash group orders...');
    const { createGroupOrders } = require('./doordash');
    picks = await createGroupOrders(picks);
  }

  const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];
  const day = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    timeZone: 'America/Los_Angeles',
  });
  const activeCount = restaurants.filter(r => r.active !== false).length;

  const lines = picks.map((r, i) => {
    const emoji = emojis[i] || `${i + 1}.`;
    // Prefer group order link, fall back to store link, fall back to just the name
    const link = r.groupOrderUrl || r.url;
    const label = r.groupOrderUrl ? 'Join group order' : r.url ? 'View on DoorDash' : null;
    return link && label ? `${emoji} *${r.name}* — <${link}|${label}>` : `${emoji} *${r.name}*`;
  });

  const orderNote = USE_GROUP_ORDERS
    ? 'Click your pick to join the group order. Someone click checkout by noon!'
    : 'React to vote, then someone create the group order and drop the link below 👇';

  const message = {
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: `🍽️ ${day} Lunch`, emoji: true },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: lines.join('\n') },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: orderNote },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `_${activeCount} restaurants in the pool · \`/lunch\` to manage_`,
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

  if (!res.ok) throw new Error(`Slack returned ${res.status}: ${await res.text()}`);
  console.log(`✅ Posted ${picks.length} picks (${picks.map(r => r.name).join(', ')})`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
