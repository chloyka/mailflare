import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { oidcIdentities, users } from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { newId } from "@/lib/ids";
import { base64UrlEncode } from "@/lib/oidc/pkce";
import type { IdentityStore, StoredUser } from "@/lib/oidc/identity";

function unusablePasswordHash(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return hashPassword(base64UrlEncode(bytes));
}

export function createIdentityStore(env: CloudflareEnv): IdentityStore {
	const db = getDb(env);

	return {
		async findUserByOidcIdentity(issuer: string, subject: string): Promise<StoredUser | null> {
			const [row] = await db
				.select({ id: users.id, email: users.email, disabled: users.disabled })
				.from(oidcIdentities)
				.innerJoin(users, eq(users.id, oidcIdentities.userId))
				.where(and(eq(oidcIdentities.issuer, issuer), eq(oidcIdentities.subject, subject)))
				.limit(1);
			return row ?? null;
		},

		async findUserByEmail(email: string): Promise<StoredUser | null> {
			const [row] = await db
				.select({ id: users.id, email: users.email, disabled: users.disabled })
				.from(users)
				.where(eq(users.email, email))
				.limit(1);
			return row ?? null;
		},

		async linkIdentity(userId: string, issuer: string, subject: string): Promise<void> {
			// Two concurrent first logins by the same person can both miss the identity
			// row and race to insert it. onConflictDoNothing tolerates the loser hitting
			// the UNIQUE(issuer, subject) index instead of surfacing a 500.
			await db.insert(oidcIdentities).values({ id: newId(), userId, issuer, subject }).onConflictDoNothing();
		},

		async createUser(input: { email: string; name: string }): Promise<StoredUser> {
			const id = newId("usr");
			await db.insert(users).values({
				id,
				email: input.email,
				name: input.name,
				passwordHash: unusablePasswordHash(),
				role: "user",
			});
			return { id, email: input.email, disabled: false };
		},
	};
}
