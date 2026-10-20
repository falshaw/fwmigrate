import "dotenv/config";
import { defineConfig } from "prisma/config";
import { resolveDatabaseUrl } from "./src/lib/database-url";

// `prisma generate` needs no database; every other command does.
const isGenerate = process.argv.includes("generate");
const url = resolveDatabaseUrl();
if (!url && !isGenerate) {
  throw new Error(
    "No database configured: set POSTGRES_PASSWORD (or DATABASE_URL) in .env — see README.",
  );
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "npx tsx prisma/seed.ts",
  },
  datasource: {
    url: url ?? "postgresql://unused:unused@127.0.0.1:5432/unused",
  },
});
