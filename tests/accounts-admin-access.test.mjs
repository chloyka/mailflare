import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(join(root, file), "utf8");

// The accounts list is instance-wide: listAccountsForAdmin() selects every user with no
// ownership filter. Any admin route that scopes a single account to createdByUserId
// therefore makes accounts created by another admin visible in the list but answer
// "Account not found" when opened — which is exactly what happened to the OIDC-provisioned
// accounts attributed to the oldest admin.
const ACCOUNT_ROUTES = [
	"src/app/api/accounts/[id]/route.ts",
	"src/app/api/accounts/[id]/mailboxes/route.ts",
	"src/app/api/accounts/[id]/avatar/utils.ts",
	"src/app/api/mailboxes/route.ts",
	"src/app/api/mailboxes/[id]/route.ts",
	"src/app/api/mailboxes/[id]/access/route.ts",
];

test("listAccountsForAdmin stays instance-wide", () => {
	const src = read("src/app/api/accounts/utils.ts");
	const body = src.slice(src.indexOf("export function listAccountsForAdmin"));
	const listQuery = body.slice(0, body.indexOf("\n}"));
	assert.ok(listQuery.includes(".from(users)"), "listAccountsForAdmin no longer selects from users");
	assert.ok(
		!listQuery.includes("createdByUserId"),
		"the accounts list gained an owner filter — the detail routes below assume it has none",
	);
});

test("admin account routes do not scope accounts to their creator", () => {
	for (const file of ACCOUNT_ROUTES) {
		const src = read(file);
		const offenders = src
			.split("\n")
			.map((line, index) => [index + 1, line])
			.filter(([, line]) => !line.trim().startsWith("//"))
			.filter(([, line]) => /users\.createdByUserId|account\.createdByUserId|owner\?\.createdByUserId/.test(line));
		assert.deepEqual(
			offenders,
			[],
			`${file} scopes an account by createdByUserId: ${offenders.map(([n, l]) => `${n}: ${l.trim()}`).join(" | ")}`,
		);
	}
});
