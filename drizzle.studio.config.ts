import { defineConfig } from "drizzle-kit";

// Отдельный конфиг только для Drizzle Studio (GUI по боевой D1 через HTTP API).
// Основной drizzle.config.ts не трогаем, чтобы не влиять на генерацию миграций.
//
// Запуск:
//   export CF_D1_TOKEN=<токен с правом Account -> D1 -> Edit>
//   bun x drizzle-kit studio --config=drizzle.studio.config.ts
//
// Studio поднимется на https://local.drizzle.studio и будет писать в ПРОДАКШЕН-базу.
export default defineConfig({
	schema: "./src/db/schema/index.ts",
	out: "./drizzle/migrations",
	dialect: "sqlite",
	driver: "d1-http",
	dbCredentials: {
		accountId: "f4dab4f4eb77e524fee3580ebc9f12cb",
		databaseId: "77f60970-fad7-4509-b6c7-fd5a9f1ff920",
		token: process.env.CF_D1_TOKEN ?? "",
	},
});
