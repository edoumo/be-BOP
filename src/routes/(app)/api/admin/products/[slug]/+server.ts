import { collections } from '$lib/server/database';
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { BE_BOP_CATALOG_API_KEY } from '$lib/server/env-config';
import { timingSafeEqual } from 'node:crypto';

/**
 * API admin catalogue (Peak Learn → be-BOP).
 *
 * Authentification : clé API dédiée (header X-API-Key), comparée en temps
 * constant. Aucun secret dans les logs. Cette API est le SEUL chemin de
 * provisioning produit pour le worker catalogue (jamais d'écriture Mongo
 * directe depuis la plateforme).
 *
 * Champs Peak Learn-owned uniquement : name, description, published.
 * Jamais price/VAT/currency/payment config (be-BOP-owned).
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

/** Lookup produit (y compris produits non visibles en eShop). */
export const GET: RequestHandler = async ({ params, request }) => {
	assertApiKey(request);
	const { slug } = params;

	const product = await collections.products.findOne(
		{ _id: slug },
		{
			projection: {
				_id: 1,
				name: 1,
				shortDescription: 1,
				price: 1,
				'actionSettings.eShop.visible': 1
			}
		}
	);

	if (!product) {
		throw error(404, 'Product not found');
	}

	return json({
		_id: product._id,
		name: product.name,
		shortDescription: product.shortDescription,
		price: product.price ?? null,
		visible: product.actionSettings?.eShop?.visible ?? false
	});
};

/** Mise à jour des champs Peak Learn-owned (name, description, published). */
export const PATCH: RequestHandler = async ({ params, request }) => {
	assertApiKey(request);
	const { slug } = params;

	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') {
		throw error(400, 'Invalid JSON body');
	}

	const product = await collections.products.findOne({ _id: slug });
	if (!product) {
		throw error(404, 'Product not found');
	}

	const update: Record<string, unknown> = { updatedAt: new Date() };

	if (typeof body.name === 'string' && body.name.trim().length > 0) {
		update.name = body.name.trim().slice(0, 70);
	}
	if (typeof body.description === 'string') {
		update.description = body.description.replaceAll('\r', '').slice(0, 10_000);
	}
	if (typeof body.published === 'boolean') {
		update['actionSettings.eShop.visible'] = body.published;
	}
	if (typeof body.visible === 'boolean') {
		update['actionSettings.eShop.visible'] = body.visible;
	}

	await collections.products.updateOne({ _id: slug }, { $set: update });

	return json({ _id: slug, updated: true });
};
