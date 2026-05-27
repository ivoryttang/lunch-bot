#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const { pickOptions, buildMessage, dayName, PICKS_PER_DAY } = require('./message');

const WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

if (!WEBHOOK_URL) {
  console.error('SLACK_WEBHOOK_URL is not set');
  process.exit(1);
}

async function main() {
  const { restaurants } = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'restaurants.json'), 'utf8')
  );

  const activeCount = restaurants.filter(r => r.active !== false).length;
  const picks = pickOptions(restaurants, PICKS_PER_DAY);

  if (picks.length === 0) {
    console.log('No active options — nothing to post.');
    return;
  }

  const message = buildMessage({ picks, activeCount, day: dayName() });

  const res = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message),
  });

  if (!res.ok) throw new Error(`Slack returned ${res.status}: ${await res.text()}`);
  console.log(`✅ Posted ${picks.length} options (${picks.map(r => r.name).join(', ')})`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
