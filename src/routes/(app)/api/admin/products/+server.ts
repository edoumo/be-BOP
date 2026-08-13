import { collections } from '$lib/server/database';
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { BE_BOP_CATALOG_API_KEY } from '$lib/server/env-config';
import { timingSafeEqual } from 'node:crypto';

/**
 * API admin catalogue (Peak Learn → be-BOP) — création produit.
 *
 * Authentification : clé API dédiée (header X-API-Key), comparée en temps
 * constant. Aucun secret dans les logs.
 *
 * Champs Peak Learn-owned uniquement : slug, name, description, published.
 * Jamais price/VAT/currency/payment config (be-BOP-owned) : un produit créé
 * par le catalogue est créé SANS prix (NEEDS_CONFIGURATION côté plateforme
 * tant qu'un admin be-BOP ne l'a pas configuré).
 */

function assertApiKey(request: Request): void {
	const provided = request.headers.get('X-API-Key') ?? '';
	if (!BE_BOP_CATALOG_API_KEY || provided.length === 0) {
		throw error(401, 'Missing or invalid API key');
	}
	const a = Buffer.from(provided);
	const b = Buffer.from(BE_BOP_CATALOG_API_KEY);
	if (a.length !== b.length || !timingSafeEqual(a, b)) {
		throw error(401, 'Missing or invalid API key');
	}
}

export const POST: RequestHandler = async ({ request }) => {
	assertApiKey(request);

	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') {
		throw error(400, 'Invalid JSON body');
	}

	const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
	if (!/^[a-z0-9][a-z0-9-]{0,119}$/.test(slug)) {
		throw error(400, 'Invalid slug');
	}

	const name = typeof body.name === 'string' ? body.name.trim().slice(0, 70) : '';
	if (!name) {
		throw error(400, 'Missing name');
	}

	// Idempotence : lookup avant create.
	const existing = await collections.products.findOne({ _id: slug });
	if (existing) {
		return json({ _id: slug, alreadyExists: true });
	}

	const description =
		typeof body.description === 'string'
			? body.description.replaceAll('\r', '').slice(0, 10_000)
			: '';
	const published = typeof body.published === 'boolean' ? body.published : false;

	await collections.products.insertOne({
		_id: slug,
		alias: [slug],
		name,
		description,
		shortDescription: name.slice(0, 160),
		createdAt: new Date(),
		updatedAt: new Date(),
		// Pas de prix : la configuration commerciale reste be-BOP-owned.
		price: { amount: 0, currency: 'EUR', precision: 2 },
		type: 'resource',
		shipping: false,
		isTicket: false,
		preorder: false,
		displayShortDescription: true,
		hideDiscountExpiration: false,
		payWhatYouWant: false,
		standalone: false,
		free: false,
		actionSettings: {
			eShop: { visible: published, canBeAddedToBasket: true },
			retail: { visible: false, canBeAddedToBasket: false },
			googleShopping: { visible: false },
			nostr: { visible: false, canBeAddedToBasket: false }
		},
		tagIds: [],
		cta: [],
		externalResources: [],
		hasSellDisclaimer: false,
		hideFromSEO: false
	});

	return json({ _id: slug, created: true });
};
