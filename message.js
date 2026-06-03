// Shared logic for picking dinner options and building the Slack message.
// Used by both bot.js (daily post) and api/slack.js (Regenerate button, preview).

const PICKS_PER_DAY = parseInt(process.env.PICKS_PER_DAY || '2', 10);

// Slack reaction names for 1️⃣–5️⃣. People react with the number next to an
// option to vote for it; index in this array == option position in the message.
const NUMBER_REACTIONS = ['one', 'two', 'three', 'four', 'five'];
const NUMBER_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];

// "Strong favorites" weighting within the voted pool: a spot with +5 votes is
// ~36x as likely as a just-voted one, so proven crowd-pleasers dominate. Only
// applied once an option has at least one vote (see pickOptions tiering).
function optionWeight(r) {
  const votes = Math.max(0, r.votes || 0);
  return Math.pow(1 + votes, 2);
}

// An option counts as "new" until it earns its first upvote.
const isUnvoted = r => !(r.votes > 0);

// Weighted random sampling without replacement. `weightFn` maps an item to its
// relative likelihood; pass `() => 1` for a uniform draw.
function sampleWeighted(items, count, weightFn) {
  const remaining = items.slice();
  const picks = [];
  const take = Math.min(count, remaining.length);

  for (let k = 0; k < take; k++) {
    const weights = remaining.map(weightFn);
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

// Two-tier pick: unvoted ("new") options always take priority over vote-weighted
// favorites, so a freshly added spot is guaranteed exposure before the proven
// ones come back around — and stays in the priority tier until it earns a vote.
// Only once every active option has at least one vote does selection fall back
// to pure vote weighting. Within the new tier we draw uniformly at random so
// the order new options surface in varies day to day.
function pickOptions(restaurants, n = PICKS_PER_DAY) {
  const pool = restaurants.filter(r => r.active !== false);
  const unvoted = pool.filter(isUnvoted);
  const voted = pool.filter(r => !isUnvoted(r));

  const picks = sampleWeighted(unvoted, n, () => 1);
  if (picks.length < n) {
    picks.push(...sampleWeighted(voted, n - picks.length, optionWeight));
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
