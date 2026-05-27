// Shared logic for picking dinner options and building the Slack message.
// Used by both bot.js (daily post via webhook) and api/slack.js (slash command
// + "Regenerate" button), so the message looks identical wherever it comes from.

const PICKS_PER_DAY = parseInt(process.env.PICKS_PER_DAY || '2', 10);

// Fisher–Yates shuffle, then take the first n active options.
function pickOptions(restaurants, n = PICKS_PER_DAY) {
  const active = restaurants.filter(r => r.active !== false);
  for (let i = active.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [active[i], active[j]] = [active[j], active[i]];
  }
  return active.slice(0, Math.min(n, active.length));
}

function dayName() {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    timeZone: 'America/Los_Angeles',
  });
}

// Builds the Slack message blocks. The "Regenerate" button fires a block_actions
// payload (action_id: regenerate) handled in api/slack.js.
function buildMessage({ picks, activeCount, day }) {
  const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];
  const lines = picks.map((r, i) => `${emojis[i] || `${i + 1}.`} *${r.name}*`);

  return {
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: `🍽️ ${day} Dinner`, emoji: true },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: lines.join('\n') },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '🎲 Regenerate', emoji: true },
            action_id: 'regenerate',
            style: 'primary',
          },
        ],
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `_${activeCount} options in the pool · \`/lunch\` to manage_`,
          },
        ],
      },
    ],
  };
}

module.exports = { pickOptions, buildMessage, dayName, PICKS_PER_DAY };
