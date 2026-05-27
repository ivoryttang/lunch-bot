// Shared logic for picking dinner options and building the Slack message.
// Used by both bot.js (daily post) and api/slack.js (Regenerate button, preview).

const PICKS_PER_DAY = parseInt(process.env.PICKS_PER_DAY || '2', 10);

// Slack reaction names for 1️⃣–5️⃣. People react with the number next to an
// option to vote for it; index in this array == option position in the message.
const NUMBER_REACTIONS = ['one', 'two', 'three', 'four', 'five'];
const NUMBER_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];

// "Strong favorites" weighting: a spot with +5 net votes is ~36x as likely as
// an unvoted one, so proven crowd-pleasers dominate the rotation.
function optionWeight(r) {
  const votes = Math.max(0, r.votes || 0);
  return Math.pow(1 + votes, 2);
}

// Weighted random sampling without replacement.
function pickOptions(restaurants, n = PICKS_PER_DAY) {
  const pool = restaurants.filter(r => r.active !== false);
  const picks = [];
  const remaining = pool.slice();
  const take = Math.min(n, remaining.length);

  for (let k = 0; k < take; k++) {
    const weights = remaining.map(optionWeight);
    const total = weights.reduce((s, w) => s + w, 0);
    let r = Math.random() * total;
    let chosen = remaining.length - 1;
    for (let i = 0; i < remaining.length; i++) {
      r -= weights[i];
      if (r <= 0) {
        chosen = i;
        break;
      }
    }
    picks.push(remaining[chosen]);
    remaining.splice(chosen, 1);
  }
  return picks;
}

function dayName() {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    timeZone: 'America/Los_Angeles',
  });
}

// Builds the Slack message blocks. Options are numbered so people can react
// with the matching 1️⃣–5️⃣ to vote; the "Regenerate" button fires a
// block_actions payload (action_id: regenerate) handled in api/slack.js.
function buildMessage({ picks, activeCount, day }) {
  const lines = picks.map((r, i) => `${NUMBER_EMOJIS[i] || `${i + 1}.`} *${r.name}*`);

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
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: 'React with the number to vote 👍 — favorites get picked more often 🔥',
          },
        ],
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

module.exports = {
  pickOptions,
  optionWeight,
  buildMessage,
  dayName,
  PICKS_PER_DAY,
  NUMBER_REACTIONS,
  NUMBER_EMOJIS,
};
