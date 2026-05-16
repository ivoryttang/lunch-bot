const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function createGroupOrders(restaurants) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });

  if (!process.env.DOORDASH_COOKIES) {
    throw new Error('DOORDASH_COOKIES is not set');
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
      // Save a screenshot so we can see what the page looked like
      const screenshotDir = path.join(__dirname, 'screenshots');
      fs.mkdirSync(screenshotDir, { recursive: true });
      const file = path.join(screenshotDir, `${restaurant.name.replace(/\s+/g, '-')}.png`);
      await page.screenshot({ path: file, fullPage: true });
      console.log(`  📸 Screenshot saved: ${file}`);
      results.push({ ...restaurant, groupOrderUrl: null });
    }
  }

  await browser.close();
  return results;
}

async function createGroupOrder(page, restaurantUrl) {
  await page.goto(restaurantUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Log page title so we know what loaded
  console.log(`  Page: ${await page.title()}`);

  // Handle address/delivery modal — DoorDash often blocks the page until you set one
  await handleAddressModal(page);

  // Try to find the Group Order button with multiple strategies
  const groupOrderBtn = page
    .getByRole('button', { name: /group order/i })
    .or(page.getByRole('link', { name: /group order/i }))
    .or(page.getByText(/start group order/i))
    .or(page.getByText(/group order/i).first());

  await groupOrderBtn.waitFor({ state: 'visible', timeout: 15000 });
  await groupOrderBtn.click();

  await page.waitForTimeout(3000);

  // Strategy 1: URL changed
  if (page.url().includes('group-order')) return page.url();

  // Strategy 2: input field with link
  const shareInput = page.locator('input[value*="group-order"], input[value*="doordash.com/group"]').first();
  if (await shareInput.isVisible({ timeout: 5000 }).catch(() => false)) {
    return await shareInput.inputValue();
  }

  // Strategy 3: anchor tag
  const shareAnchor = page.locator('a[href*="group-order"]').first();
  if (await shareAnchor.isVisible({ timeout: 3000 }).catch(() => false)) {
    const href = await shareAnchor.getAttribute('href');
    return href.startsWith('http') ? href : `https://www.doordash.com${href}`;
  }

  // Strategy 4: scan page text for a group-order URL
  const bodyText = await page.locator('body').innerText();
  const match = bodyText.match(/https:\/\/www\.doordash\.com\/group-order\/[^\s"')]+/);
  if (match) return match[0];

  throw new Error('Group order link not found after clicking button');
}

async function handleAddressModal(page) {
  const deliveryAddress = process.env.DOORDASH_DELIVERY_ADDRESS;

  // Check for common modal patterns DoorDash uses
  const modalSelectors = [
    '[data-testid="AddressModalButton"]',
    '[placeholder*="Enter delivery address"]',
    '[placeholder*="address"]',
    'button:has-text("Enter an address")',
    'button:has-text("Set a location")',
  ];

  for (const selector of modalSelectors) {
    const el = page.locator(selector).first();
    if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log(`  Address modal detected (${selector})`);

      if (deliveryAddress) {
        // Try to type the address and confirm
        await el.click();
        await page.waitForTimeout(500);
        await page.keyboard.type(deliveryAddress, { delay: 50 });
        await page.waitForTimeout(1500);
        // Pick the first autocomplete suggestion
        const suggestion = page.locator('[data-testid="address-suggestion"], [role="option"]').first();
        if (await suggestion.isVisible({ timeout: 3000 }).catch(() => false)) {
          await suggestion.click();
          await page.waitForTimeout(1000);
        }
      } else {
        // Try to dismiss the modal and switch to pickup instead
        const pickupBtn = page.getByRole('button', { name: /pickup/i })
          .or(page.getByText(/pick up/i)).first();
        if (await pickupBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await pickupBtn.click();
          console.log('  Switched to pickup mode');
        } else {
          // Just close the modal
          const closeBtn = page.locator('[aria-label="Close"], button:has-text("Close"), [data-testid="modal-close-button"]').first();
          if (await closeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await closeBtn.click();
          }
        }
      }
      await page.waitForTimeout(1000);
      break;
    }
  }
}

module.exports = { createGroupOrders };
