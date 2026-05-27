// Vercel serverless function — handles the /lunch slash command and the
// "Regenerate" button on the daily dinner post.

const crypto = require('crypto');
const { pickOptions, buildMessage, dayName, PICKS_PER_DAY } = require('../message');
const { findMatch } = require('../dedupe');

const { SLACK_SIGNING_SECRET, GITHUB_TOKEN, GITHUB_REPO } = process.env;

// ── GitHub helpers ────────────────────────────────────────────────────────────

async function ghGet() {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/restaurants.json`;
  const res = await fetch(url, {
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
    },
  });
  if (!res.ok) throw new Error(`GitHub GET failed: ${res.status}`);
  const file = await res.json();
  const data = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
  return { data, sha: file.sha };
}

async function ghPut(data, sha, commitMessage) {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/restaurants.json`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: commitMessage,
      content: Buffer.from(JSON.stringify(data, null, 2) + '\n').toString('base64'),
      sha,
    }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`GitHub PUT failed: ${err.message}`);
  }
}

// ── Slack request verification ────────────────────────────────────────────────

function verifySignature(headers, rawBody) {
  if (!SLACK_SIGNING_SECRET) return false;
  const ts = headers['x-slack-request-timestamp'];
  const sig = headers['x-slack-signature'];
  if (!ts || !sig) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  try {
    const expected =
      'v0=' +
      crypto
        .createHmac('sha256', SLACK_SIGNING_SECRET)
        .update(`v0:${ts}:${rawBody}`)
        .digest('hex');
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
  } catch {
    return false;
  }
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

// ── Response helpers ──────────────────────────────────────────────────────────

const ephemeral = text => ({ response_type: 'ephemeral', text });
const inChannel = text => ({ response_type: 'in_channel', text });

// ── "Regenerate" button ───────────────────────────────────────────────────────

async function handleInteraction(interaction, res) {
  const action = interaction.actions && interaction.actions[0];
  if (!action || action.action_id !== 'regenerate') {
    return res.status(200).end();
  }

  const { data } = await ghGet();
  const activeCount = data.restaurants.filter(r => r.active !== false).length;

  if (activeCount === 0) {
    return res.json(ephemeral('No options in the pool — add some with `/lunch add`'));
  }

  const picks = pickOptions(data.restaurants, PICKS_PER_DAY);
  const message = buildMessage({ picks, activeCount, day: dayName() });
  // replace_original swaps the message the button lives on for fresh picks
  return res.json({ replace_original: true, ...message });
}

// ── /lunch slash command ──────────────────────────────────────────────────────

async function handleCommand(payload, res) {
  const [subcommand = '', ...rest] = (payload.text || '').trim().split(/\s+/);
  const arg = rest.join(' ').trim();

  switch (subcommand.toLowerCase()) {
    case '':
    case 'help': {
      return res.json(
        ephemeral(
          [
            '*Dinner Bot — available commands:*',
            '`/lunch list` — show every option (active & removed)',
            '`/lunch add <name>` — add an option (warns on likely duplicates)',
            '`/lunch remove <name>` — remove an option from the rotation',
            '`/lunch enable <name>` — bring back a removed option',
            "`/lunch preview` — preview tonight's random picks",
          ].join('\n')
        )
      );
    }

    case 'list': {
      const { data } = await ghGet();
      const active = data.restaurants.filter(r => r.active !== false);
      const inactive = data.restaurants.filter(r => r.active === false);

      let text = `*Dinner options — ${active.length} active:*\n`;
      text += active.length ? active.map(r => `• ${r.name}`).join('\n') : '_none_';

      if (inactive.length) {
        text += `\n\n*Removed (${inactive.length}):*\n`;
        text += inactive.map(r => `• ~${r.name}~`).join('\n');
      }

      return res.json(ephemeral(text));
    }

    case 'add':
    case 'add!': {
      // `add!` (or a leading -f/--force flag) bypasses the fuzzy duplicate check
      let force = subcommand.toLowerCase() === 'add!';
      let name = arg;
      const flag = name.match(/^(?:-f|--force)\s+(.*)$/i);
      if (flag) {
        force = true;
        name = flag[1].trim();
      }

      if (!name) return res.json(ephemeral('Usage: `/lunch add <name>`'));

      const { data, sha } = await ghGet();
      const match = findMatch(name, data.restaurants);

      // Exact match (after normalizing case/punctuation): already in the list.
      if (match && match.exact) {
        const existing = match.restaurant;
        if (existing.active === false) {
          existing.active = true;
          await ghPut(data, sha, `Re-enable ${existing.name} via Slack`);
          return res.json(inChannel(`✅ Brought *${existing.name}* back into the rotation`));
        }
        return res.json(ephemeral(`*${existing.name}* is already in the list`));
      }

      // Fuzzy near-match: surface the suspected duplicate, let the user force it.
      if (match && !force) {
        const existing = match.restaurant;
        const hint =
          existing.active === false
            ? `It's currently removed — \`/lunch enable ${existing.name}\` brings it back, or \`/lunch add! ${name}\` adds it as new.`
            : `If *${name}* is actually different, run \`/lunch add! ${name}\` to add it anyway.`;
        return res.json(
          ephemeral(`🤔 *${name}* looks like a possible duplicate of *${existing.name}*. ${hint}`)
        );
      }

      data.restaurants.push({ name, active: true });
      await ghPut(data, sha, `Add ${name} via Slack`);
      return res.json(inChannel(`✅ Added *${name}* to the dinner options`));
    }

    case 'remove': {
      if (!arg) return res.json(ephemeral('Usage: `/lunch remove <name>`'));

      const { data, sha } = await ghGet();
      const restaurant = data.restaurants.find(
        r => r.name.toLowerCase() === arg.toLowerCase()
      );

      if (!restaurant) {
        return res.json(
          ephemeral(`Couldn't find *${arg}* — use \`/lunch list\` to see all options`)
        );
      }
      if (restaurant.active === false) {
        return res.json(ephemeral(`*${arg}* is already removed`));
      }

      restaurant.active = false;
      await ghPut(data, sha, `Remove ${arg} via Slack`);
      return res.json(inChannel(`🚫 Removed *${arg}* from the rotation`));
    }

    case 'enable': {
      if (!arg) return res.json(ephemeral('Usage: `/lunch enable <name>`'));

      const { data, sha } = await ghGet();
      const restaurant = data.restaurants.find(
        r => r.name.toLowerCase() === arg.toLowerCase()
      );

      if (!restaurant) {
        return res.json(ephemeral(`Couldn't find *${arg}*`));
      }

      restaurant.active = true;
      await ghPut(data, sha, `Enable ${arg} via Slack`);
      return res.json(inChannel(`✅ Brought *${arg}* back into the rotation`));
    }

    case 'preview': {
      const { data } = await ghGet();
      const activeCount = data.restaurants.filter(r => r.active !== false).length;

      if (activeCount === 0) {
        return res.json(ephemeral('No options yet — add some with `/lunch add`'));
      }

      const picks = pickOptions(data.restaurants, PICKS_PER_DAY);
      const message = buildMessage({ picks, activeCount, day: dayName() });
      return res.json({ response_type: 'ephemeral', ...message });
    }

    default:
      return res.json(ephemeral(`Unknown command \`${subcommand}\` — try \`/lunch help\``));
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    return res.status(200).json(ephemeral('Only POST requests are supported'));
  }

  try {
    const rawBody = await readRawBody(req);

    if (!verifySignature(req.headers, rawBody)) {
      // Return 200 so Slack shows our message instead of "did not respond"
      return res.status(200).json(
        ephemeral(
          !SLACK_SIGNING_SECRET
            ? '⚠️ SLACK_SIGNING_SECRET is not configured in Vercel env vars'
            : '⚠️ Request signature invalid'
        )
      );
    }

    const payload = Object.fromEntries(new URLSearchParams(rawBody));

    try {
      // Interactive component (button click) arrives as payload=<json>
      if (payload.payload) {
        const interaction = JSON.parse(payload.payload);
        if (interaction.type === 'block_actions') {
          return await handleInteraction(interaction, res);
        }
        return res.status(200).end();
      }

      return await handleCommand(payload, res);
    } catch (err) {
      console.error(err);
      return res.status(200).json(ephemeral(`⚠️ Error: ${err.message}`));
    }
  } catch (err) {
    console.error('Handler error:', err);
    return res.status(200).json(ephemeral(`⚠️ Server error: ${err.message}`));
  }
}

// Must be set on the exported function — assigning module.exports afterward would wipe this
handler.config = { api: { bodyParser: false } };
module.exports = handler;
