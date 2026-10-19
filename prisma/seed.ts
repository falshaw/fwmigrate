import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Starting seed...");

  const adminPassword =
    process.env.SEED_ADMIN_PASSWORD ||
    crypto.randomBytes(16).toString("base64url");
  const passwordHash = await bcrypt.hash(adminPassword, 12);

  console.log("\n========================================");
  console.log("Admin user credentials:");
  console.log("  Email:    admin@demo.local");
  console.log(`  Password: ${adminPassword}`);
  console.log("========================================\n");

  // Create default organization
  const org = await prisma.organization.upsert({
    where: { slug: "demo" },
    update: {},
    create: {
      name: "Demo Organization",
      slug: "demo",
      domain: "demo.local",
    },
  });

  // Create admin user
  const admin = await prisma.user.upsert({
    where: { email: "admin@demo.local" },
    update: { passwordHash },
    create: {
      email: "admin@demo.local",
      passwordHash,
      name: "Demo Admin",
      role: "ADMIN",
      isActive: true,
      organizationId: org.id,
    },
  });

  console.log("Admin user created:", admin.email);

  // Create sample migration project
  const project = await prisma.migrationProject.upsert({
    where: { id: "seed-project-1" },
    update: {},
    create: {
      id: "seed-project-1",
      name: "DC Perimeter Migration",
      description: "Migrate Cisco ASA perimeter firewall rules to Palo Alto",
      sourceVendor: "CISCO_ASA",
      targetVendor: "PALO_ALTO",
      status: "TRANSLATED",
      createdById: admin.id,
      organizationId: org.id,
    },
  });

  console.log("Sample project created:", project.name);
  console.log("\nSeed completed successfully!");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
