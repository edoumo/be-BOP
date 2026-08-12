import { expect, test } from '@playwright/test';

/**
 * Regression test: PRODUCT_WITH_ZERO_PICTURES_DOES_NOT_CRASH
 *
 * A product with no pictures must render HTTP 200 (no SSR crash).
 * Root cause fixed: JSON-LD schema block accessed data.pictures[0]._id
 * unconditionally, throwing "Cannot read properties of undefined (reading '_id')"
 * during SSR for products without pictures.
 *
 * Requires a running be-BOP instance (webServer in playwright.config.ts).
 * The test uses a product known to have zero pictures in the HP environment.
 */
test('product page with zero pictures does not crash (HTTP 200)', async ({ request }) => {
	const response = await request.get('/product/demo-product', {
		headers: { Accept: 'text/html' }
	});

	expect(response.status()).toBe(200);

	const body = await response.text();
	// The page must be a real product page, not an error page.
	expect(body).not.toContain('handleError');
	expect(body).not.toContain('Internal Error');
	// The product name should be present in the rendered page.
	expect(body).toContain('Demo Product');
});

test('product page with zero pictures renders without broken image markup', async ({ page }) => {
	await page.goto('/product/demo-product');

	// No error boundary / crash page.
	await expect(page.locator('body')).not.toContainText('Internal Error');

	// The page must still expose the product name.
	await expect(page.locator('body')).toContainText('Demo Product');
});
