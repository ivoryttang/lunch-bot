// Vercel serverless function — handles the /lunch slash command and the
// "Regenerate" button on the daily dinner post.

const crypto = require('crypto');
const { pickOptions, buildMessage, dayName, PICKS_PER_DAY, NUMBER_REACTIONS } = require('../message');
const { findMatch } = require('../dedupe');
const { getJson, putJson, updateJson } = require('../github');

const { SLACK_SIGNING_SECRET } = process.env;

const RESTAURANTS = 'restaurants.json';
const POLLS = 'polls.json';

// ── GitHub helpers (restaurants.json) ─────────────────────────────────────────

const ghGet = () => getJson(RESTAURANTS, { restaurants: [] });
const ghPut = (data, sha, message) => putJson(RESTAURANTS, data, sha, message);

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

  // The message keeps its ts after replace_original, so re-point the poll
  // mapping at the new picks — number reactions then vote for these instead.
  const ts = interaction.message && interaction.message.ts;
  if (ts) {
    await updateJson(
      POLLS,
      { polls: {} },
      data => {
        data.polls = data.polls || {};
        data.polls[ts] = picks.map(r => r.name);
      },
      `Update poll ${ts} (regenerate)`
    ).catch(err => console.error(`poll update failed: ${err.message}`));
  }

  // replace_original swaps the message the button lives on for fresh picks
  return res.json({ replace_original: true, ...message });
}

// ── Reaction voting (Slack Events API) ────────────────────────────────────────

// 'one' → 0, 'two' → 1, … ; anything else (❤️, 🔥, etc.) isn't a vote.
function reactionIndex(name) {
  return NUMBER_REACTIONS.indexOf(name);
}

async function handleEvent(event, res) {
  if (event.type !== 'reaction_added' && event.type !== 'reaction_removed') {
    return res.status(200).end();
  }

  const idx = reactionIndex(event.reaction);
  const ts = event.item && event.item.ts;
  if (idx < 0 || !ts) return res.status(200).end();

  // Which option does this number map to on that specific message?
  const { data: polls } = await getJson(POLLS, { polls: {} });
  const names = polls.polls && polls.polls[ts];
  const targetName = names && names[idx];
  if (!targetName) return res.status(200).end(); // not a tracked poll / no option there

  const delta = event.type === 'reaction_added' ? 1 : -1;
  await updateJson(
    RESTAURANTS,
    { restaurants: [] },
    data => {
      const r = data.restaurants.find(x => x.name === targetName);
      if (!r) return false; // option was deleted since the poll posted
      r.votes = Math.max(0, (r.votes || 0) + delta);
    },
    `${delta > 0 ? '+' : '-'}1 vote: ${targetName} (reaction)`
  );

  return res.status(200).end();
}

// ── /kaboom — permanent deletion ──────────────────────────────────────────────

async function kaboomDelete(name, res) {
  if (!name) {
    return res.json(ephemeral('Usage: `/kaboom <name>` — permanently deletes an option'));
  }

  const { data, sha } = await ghGet();
  const match = findMatch(name, data.restaurants);

  if (!match) {
    return res.json(ephemeral(`Couldn't find *${name}* — \`/lunch list\` to see options`));
  }
  // Require an exact match before nuking, so a fuzzy lookalike (e.g. Dumpling
  // Home vs Dumpling Time) can't be deleted by accident.
  if (!match.exact) {
    return res.json(
      ephemeral(
        `No exact match for *${name}*. Did you mean *${match.restaurant.name}*? ` +
          `Run \`/kaboom ${match.restaurant.name}\` to delete it.`
      )
    );
  }

  const target = match.restaurant;
  data.restaurants = data.restaurants.filter(r => r !== target);
  await ghPut(data, sha, `Delete ${target.name} via Slack (kaboom)`);
  return res.json(inChannel(`💥 *${target.name}* has been kaboom'd — gone for good`));
}

// ── slash commands ────────────────────────────────────────────────────────────

async function handleCommand(payload, res) {
  // /kaboom is its own top-level command; the rest are /lunch subcommands.
  if ((payload.command || '').toLowerCase() === '/kaboom') {
    return kaboomDelete((payload.text || '').trim(), res);
  }

  const [subcommand = '', ...rest] = (payload.text || '').trim().split(/\s+/);
  const arg = rest.join(' ').trim();

  switch (subcommand.toLowerCase()) {
    case '':
    case 'help': {
      return res.json(
        ephemeral(
          [
            '*Dinner Bot — available commands:*',
            '_React with 1️⃣–5️⃣ on the daily post to vote — favorites get picked more often._',
            '`/lunch list` — show options ranked by votes',
            '`/lunch add <name>` — add an option (warns on likely duplicates)',
            '`/lunch remove <name>` — hide an option (recover it with `enable`)',
            '`/lunch enable <name>` — bring back a removed option',
            '`/kaboom <name>` — permanently delete an option (no undo)',
            "`/lunch preview` — preview tonight's random picks",
          ].join('\n')
        )
      );
    }

    case 'list': {
      const { data } = await ghGet();
      // Most-voted first, so favorites are easy to spot.
      const active = data.restaurants
        .filter(r => r.active !== false)
        .sort((a, b) => (b.votes || 0) - (a.votes || 0));
      const inactive = data.restaurants.filter(r => r.active === false);

      let text = `*Dinner options — ${active.length} active (most-voted first):*\n`;
      text += active.length
        ? active.map(r => `• ${r.name}${r.votes ? `  · 👍 ${r.votes}` : ''}`).join('\n')
        : '_none_';

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

    case 'kaboom':
    case 'delete':
      return kaboomDelete(arg, res);

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

    const contentType = (req.headers['content-type'] || '').toLowerCase();

    try {
      // Events API (reactions) sends application/json; slash commands and
      // interactivity send application/x-www-form-urlencoded.
      if (contentType.includes('application/json')) {
        const body = JSON.parse(rawBody);

        // One-time handshake when you set the Event Subscriptions URL.
        if (body.type === 'url_verification') {
          return res.status(200).json({ challenge: body.challenge });
        }
        if (body.type === 'event_callback') {
          // Skip Slack's automatic retries — re-running a vote would double-count.
          if (req.headers['x-slack-retry-num']) return res.status(200).end();
          return await handleEvent(body.event, res);
        }
        return res.status(200).end();
      }

      const payload = Object.fromEntries(new URLSearchParams(rawBody));

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
