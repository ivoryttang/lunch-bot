// Vercel serverless function — receives Slack slash commands for /lunch
// Disable Vercel's default body parsing so we can verify the raw request signature.
module.exports.config = { api: { bodyParser: false } };

const crypto = require('crypto');

const { SLACK_SIGNING_SECRET, GITHUB_TOKEN, GITHUB_REPO } = process.env;
const PICKS_PER_DAY = parseInt(process.env.PICKS_PER_DAY || '3', 10);

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
  const ts = headers['x-slack-request-timestamp'];
  const sig = headers['x-slack-signature'];
  if (!ts || !sig) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false; // replay guard
  const expected =
    'v0=' +
    crypto
      .createHmac('sha256', SLACK_SIGNING_SECRET)
      .update(`v0:${ts}:${rawBody}`)
      .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
  } catch {
    return false;
  }
}

// ── Response helpers ──────────────────────────────────────────────────────────

const ephemeral = text => ({ response_type: 'ephemeral', text });
const inChannel = text => ({ response_type: 'in_channel', text });

// ── Main handler ──────────────────────────────────────────────────────────────

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  // Collect raw body for signature check
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString();

  if (!verifySignature(req.headers, rawBody)) {
    return res.status(401).end('Unauthorized');
  }

  const payload = Object.fromEntries(new URLSearchParams(rawBody));
  const [subcommand = '', ...rest] = (payload.text || '').trim().split(/\s+/);
  const arg = rest.join(' ').trim();

  res.setHeader('Content-Type', 'application/json');

  try {
    switch (subcommand.toLowerCase()) {
      case '':
      case 'help': {
        return res.json(
          ephemeral(
            [
              '*Lunch Bot — available commands:*',
              '`/lunch list` — show all restaurants (active & inactive)',
              '`/lunch add <name> | <url>` — add a restaurant (URL optional)',
              '`/lunch remove <name>` — remove a restaurant from the rotation',
              '`/lunch enable <name>` — re-enable a previously removed restaurant',
              '`/lunch preview` — preview what today\'s picks would look like',
            ].join('\n')
          )
        );
      }

      case 'list': {
        const { data } = await ghGet();
        const active = data.restaurants.filter(r => r.active !== false);
        const inactive = data.restaurants.filter(r => r.active === false);

        let text = `*Restaurants — ${active.length} active:*\n`;
        text += active.length
          ? active.map(r => `• ${r.name}${r.url ? `  <${r.url}|link>` : ''}`).join('\n')
          : '_none_';

        if (inactive.length) {
          text += `\n\n*Inactive (${inactive.length}):*\n`;
          text += inactive.map(r => `• ~${r.name}~`).join('\n');
        }

        return res.json(ephemeral(text));
      }

      case 'add': {
        const [namePart, urlPart] = arg.split('|').map(s => s.trim());
        if (!namePart) {
          return res.json(ephemeral('Usage: `/lunch add <name> | <url>`'));
        }

        const { data, sha } = await ghGet();
        const existing = data.restaurants.find(
          r => r.name.toLowerCase() === namePart.toLowerCase()
        );

        if (existing) {
          if (existing.active === false) {
            existing.active = true;
            if (urlPart) existing.url = urlPart;
            await ghPut(data, sha, `Re-enable ${namePart} via Slack`);
            return res.json(inChannel(`✅ Re-enabled *${namePart}* in the lunch rotation`));
          }
          return res.json(ephemeral(`*${namePart}* is already in the list`));
        }

        data.restaurants.push({ name: namePart, url: urlPart || '', active: true });
        await ghPut(data, sha, `Add ${namePart} via Slack`);
        return res.json(inChannel(`✅ Added *${namePart}* to the lunch rotation`));
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
          return res.json(ephemeral(`*${arg}* is already inactive`));
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
        return res.json(inChannel(`✅ Re-enabled *${arg}* in the rotation`));
      }

      case 'preview': {
        const { data } = await ghGet();
        const active = data.restaurants.filter(r => r.active !== false);

        if (active.length === 0) {
          return res.json(ephemeral('No active restaurants — add some with `/lunch add`'));
        }

        // Shuffle and pick
        const picks = [...active].sort(() => Math.random() - 0.5).slice(0, PICKS_PER_DAY);
        const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];
        const lines = picks.map((r, i) => {
          const e = emojis[i] || `${i + 1}.`;
          return r.url ? `${e} *${r.name}* — <${r.url}|Order on DoorDash>` : `${e} *${r.name}*`;
        });

        return res.json(
          ephemeral(`*Preview (only you can see this):*\n\n${lines.join('\n')}`)
        );
      }

      default:
        return res.json(ephemeral(`Unknown command \`${subcommand}\` — try \`/lunch help\``));
    }
  } catch (err) {
    console.error(err);
    // Always return 200 to Slack so it doesn't show a generic error
    return res.status(200).json(ephemeral(`⚠️ Error: ${err.message}`));
  }
};
