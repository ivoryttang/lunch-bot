// Playwright automation for creating DoorDash group orders.
// Called by bot.js during the daily post. Requires DOORDASH_COOKIES env var.

const { chromium } = require('playwright');

async function createGroupOrders(restaurants) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });

  if (!process.env.DOORDASH_COOKIES) {
    throw new Error('DOORDASH_COOKIES is not set — see README for how to export them');
  }

  const cookies = JSON.parse(process.env.DOORDASH_COOKIES);
  await context.addCookies(cookies);

  const page = await context.newPage();
  const results = [];

  for (const restaurant of restaurants) {
    console.log(`Creating group order for ${restaurant.name}...`);
    try {
      const groupOrderUrl = await createGroupOrder(page, restaurant.url);
      console.log(`  → ${groupOrderUrl}`);
      results.push({ ...restaurant, groupOrderUrl });
    } catch (err) {
      console.error(`  ✗ Failed: ${err.message}`);
      results.push({ ...restaurant, groupOrderUrl: null });
    }
  }

  await browser.close();
  return results;
}

async function createGroupOrder(page, restaurantUrl) {
  await page.goto(restaurantUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Dismiss any location/address modals that might appear
  const closeBtn = page.locator('[aria-label="Close"], [data-testid="modal-close-button"]').first();
  if (await closeBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await closeBtn.click();
  }

  // Find the Group Order button — DoorDash uses several labels depending on version
  const groupOrderBtn = page
    .getByRole('button', { name: /group order/i })
    .or(page.getByText(/start group order/i))
    .or(page.getByText(/group order/i))
    .first();

  await groupOrderBtn.waitFor({ timeout: 10000 });
  await groupOrderBtn.click();

  // After clicking, DoorDash either:
  //   (a) redirects to a /group-order/ URL immediately, or
  //   (b) shows a modal — we look for the shareable link in the modal

  // Give the page a moment to react
  await page.waitForTimeout(2000);

  // Strategy 1: URL changed to a group-order URL
  if (page.url().includes('group-order')) {
    return page.url();
  }

  // Strategy 2: modal with a link displayed in an input or anchor
  const shareInput = page.locator('input[value*="group-order"], input[value*="doordash.com/group"]').first();
  if (await shareInput.isVisible({ timeout: 5000 }).catch(() => false)) {
    return await shareInput.inputValue();
  }

  const shareAnchor = page.locator('a[href*="group-order"]').first();
  if (await shareAnchor.isVisible({ timeout: 3000 }).catch(() => false)) {
    const href = await shareAnchor.getAttribute('href');
    return href.startsWith('http') ? href : `https://www.doordash.com${href}`;
  }

  // Strategy 3: look for any text on the page that looks like a group-order URL
  const bodyText = await page.locator('body').innerText();
  const match = bodyText.match(/https:\/\/www\.doordash\.com\/group-order\/[^\s"')]+/);
  if (match) return match[0];

  throw new Error('Group order link not found — DoorDash UI may have changed, check selectors in doordash.js');
}

module.exports = { createGroupOrders };
