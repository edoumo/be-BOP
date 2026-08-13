import { collections } from '$lib/server/database.js';
import { oauthConfig } from '$lib/server/oauth';
import { runtimeConfig } from '$lib/server/runtime-config';
import { renewSessionId } from '$lib/server/user.js';
import { redirect } from '@sveltejs/kit';
import { error } from 'console';
import { addYears } from 'date-fns';
import { ObjectId } from 'mongodb';
import * as client from 'openid-client';
import { CUSTOMER_ROLE_ID, SUPER_ADMIN_ROLE_ID } from '$lib/types/User';

/**
 * HP-2026-08-13 (Peak Learn) : identité centralisée OIDC.
 *
 * Le callback OIDC est la porte d'entrée unique des utilisateurs Peak Learn
 * vers be-BOP (JIT provisioning). Règles du mandat :
 * - clé identitaire = issuer + subject (ssoId `peaklearn:<sub>`), jamais l'email seul ;
 * - l'email est un claim de contact uniquement ;
 * - le rôle admin be-BOP est recalculé à CHAQUE login depuis le claim courant
 *   `bebop_admin` (source de vérité = Peak Learn, ROLE_BEBOP_ADMIN) ;
 * - un compte natif be-BOP (avec mot de passe) n'est jamais rétrogradé ni
 *   promu par OIDC : le mapping admin ne s'applique qu'aux comptes créés par
 *   JIT OIDC (identifiés par leur ssoId peaklearn) ;
 * - aucun token / code / secret ne doit apparaître dans les logs.
 */

const PEAKLEARN_PROVIDER = 'peaklearn';

function ssoIdFor(sub: string): string {
	return `${PEAKLEARN_PROVIDER}:${sub}`;
}

export const GET = async ({ params, fetch, cookies, url, locals }) => {
	const state = cookies.get('oauth_state');
	const code_verifier = cookies.get('oauth_code_verifier');
	const nonce = cookies.get('oauth_nonce');

	if (!state || !code_verifier) {
		throw error(400, 'Missing state or code_verifier');
	}

	const oauth = runtimeConfig.oauth.find((o) => o.slug === params.slug && o.enabled);

	if (!oauth) {
		throw error(404, 'OAuth provider not found: ' + params.slug);
	}

	const config = await oauthConfig(oauth, fetch);

	const tokens = await client.authorizationCodeGrant(config, url, {
		pkceCodeVerifier: code_verifier,
		expectedState: state,
		expectedNonce: nonce ?? undefined
	});

	const claims = tokens.claims();

	if (!claims) {
		throw error(400, 'Missing claims');
	}

	// HP-2026-08-13 : plus aucun log de tokens/claims (fuite potentielle de
	// tokens dans les logs). Log structuré minimal sans PII sensible.
	console.log(
		`[oidc] login success provider=${params.slug} has_sub=${typeof claims.sub === 'string'}`
	);

	const userId = claims.sub;
	const username =
		claims.preferred_username ||
		claims.username || // Handle wp-oauth-server
		claims.display_name || // Handle wp-oauth-server
		claims.name ||
		claims.nickname; // Handle wp-oauth-server
	const email = claims.email;
	let avatarUrl = (claims.picture || claims.avatar_url || claims.photo_url || claims.avatar) // claims.avatar is returned by wp-oauth-server
		?.toString();

	// Handle wp-oauth-server
	if (avatarUrl && avatarUrl.startsWith('secure.gravatar.com%2F')) {
		avatarUrl = 'https://' + decodeURIComponent(avatarUrl);
	}

	if (!username) {
		throw error(400, 'Missing username');
	}

	if (typeof userId !== 'string' || userId.length === 0) {
		throw error(400, 'Missing subject');
	}

	const session = await collections.sessions.findOne({
		sessionId: locals.sessionId
	});

	const provider = params.slug;
	const ssoInfo = {
		provider,
		id: userId,
		email: email?.toString(),
		avatarUrl: avatarUrl?.toString(),
		name: username.toString()
	};

	// ------------------------------------------------------------------
	// JIT provisioning + mapping admin (HP-2026-08-13, Peak Learn)
	// ------------------------------------------------------------------
	const ssoId = ssoIdFor(userId);
	const isPeakLearnProvider = provider === PEAKLEARN_PROVIDER;
	const bebopAdminClaim = isPeakLearnProvider && claims.bebop_admin === true;

	// 1. Recherche d'un compte be-BOP existant lié à ce ssoId (issuer+subject).
	let user = await collections.users.findOne({
		ssoIds: ssoId
	});

	if (!user) {
		// 2. JIT : création d'un compte sans mot de passe (login OIDC uniquement).
		//    Le rôle est dérivé du claim courant : jamais d'email-matching, jamais
		//    de prise de contrôle d'un compte existant par email.
		const newUser = {
			_id: new ObjectId(),
			login: `${PEAKLEARN_PROVIDER}-${userId}`,
			roleId: bebopAdminClaim ? SUPER_ADMIN_ROLE_ID : CUSTOMER_ROLE_ID,
			ssoIds: [ssoId],
			...(email ? { recovery: { email: email.toString() } } : {}),
			createdAt: new Date(),
			updatedAt: new Date()
		};
		await collections.users.insertOne(newUser);
		user = newUser;
		console.log(`[oidc] jit_provisioned provider=${provider} role=${user.roleId}`);
	} else if (isPeakLearnProvider) {
		// 3. Compte OIDC existant : le rôle admin est recalculé à chaque login
		//    depuis le claim courant (révocation au prochain login/refresh).
		//    Un compte natif (avec mot de passe) n'est jamais modifié par OIDC.
		const isOidcOnlyAccount = !user.password;
		if (isOidcOnlyAccount) {
			const nextRole = bebopAdminClaim ? SUPER_ADMIN_ROLE_ID : CUSTOMER_ROLE_ID;
			if (user.roleId !== nextRole) {
				await collections.users.updateOne(
					{ _id: user._id },
					{ $set: { roleId: nextRole, updatedAt: new Date() } }
				);
				// L'objet en mémoire doit refléter le nouveau rôle : le redirect
				// final (admin vs login) s'appuie sur user.roleId.
				user = { ...user, roleId: nextRole };
				console.log(`[oidc] role_recomputed provider=${provider} role=${nextRole}`);
			}
		}
	}

	// 4. Liaison de la session au compte (userId) — le user est désormais
	//    authentifié be-BOP sans second mot de passe. Upsert unique : si la
	//    session n'existe pas encore, elle est créée ici (jamais d'insertOne
	//    séparé — évite E11000 duplicate key sur sessionId).
	if (user) {
		await collections.sessions.updateOne(
			{ sessionId: locals.sessionId },
			{
				$set: {
					userId: user._id,
					updatedAt: new Date(),
					expiresAt: addYears(new Date(), 1),
					sso: [...(session?.sso || []).filter((s) => s.provider !== ssoInfo.provider), ssoInfo]
				},
				$setOnInsert: { createdAt: new Date() }
			},
			{ upsert: true }
		);
	} else {
		await collections.sessions.updateOne(
			{ sessionId: locals.sessionId },
			{
				$set: {
					updatedAt: new Date(),
					expiresAt: addYears(new Date(), 1),
					sso: [...(session?.sso || []).filter((s) => s.provider !== ssoInfo.provider), ssoInfo]
				},
				$setOnInsert: { createdAt: new Date() }
			},
			{ upsert: true }
		);
	}
	await renewSessionId(locals, cookies);
	locals.sso = [...(session?.sso || []).filter((s) => s.provider !== ssoInfo.provider), ssoInfo];

	// 5. Redirection : admin si le claim courant l'accorde, sinon page login.
	const isAdmin = user?.roleId === SUPER_ADMIN_ROLE_ID;
	throw redirect(302, isAdmin ? '/admin' : '/login');
};
