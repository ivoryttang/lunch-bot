// Generic GitHub Contents API helpers for reading/writing JSON files in the repo.
// Used by both api/slack.js (votes, restaurants) and bot.js (poll mappings).

const { GITHUB_TOKEN, GITHUB_REPO } = process.env;

function fileUrl(path) {
  return `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`;
}

// Returns { data, sha }. If the file doesn't exist yet, returns the fallback
// with sha undefined (so putJson will create it).
async function getJson(path, fallback) {
  const res = await fetch(fileUrl(path), {
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
    },
  });
  if (res.status === 404) return { data: fallback, sha: undefined };
  if (!res.ok) throw new Error(`GitHub GET ${path} failed: ${res.status}`);
  const file = await res.json();
  const data = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
  return { data, sha: file.sha };
}

async function putJson(path, data, sha, message) {
  const body = {
    message,
    content: Buffer.from(JSON.stringify(data, null, 2) + '\n').toString('base64'),
  };
  if (sha) body.sha = sha; // omit on create

  const res = await fetch(fileUrl(path), {
    method: 'PUT',
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (res.status === 409) {
    const err = new Error(`GitHub PUT ${path} conflict`);
    err.conflict = true;
    throw err;
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`GitHub PUT ${path} failed: ${err.message || res.status}`);
  }
  return res.json();
}

// Read-modify-write with retry on concurrent-edit (sha) conflicts. `mutate`
// receives the parsed data and edits it in place; returning false aborts the
// write (no-op). Retries re-fetch the latest sha so near-simultaneous votes
// don't clobber each other.
async function updateJson(path, fallback, mutate, message) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, sha } = await getJson(path, fallback);
    if (mutate(data) === false) return null;
    try {
      await putJson(path, data, sha, typeof message === 'function' ? message(data) : message);
      return data;
    } catch (err) {
      if (err.conflict && attempt < 3) continue;
      throw err;
    }
  }
  return null;
}

module.exports = { getJson, putJson, updateJson };
