import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function upsertUser(rawEmail?: string, name?: string, password?: string) {
  if (!rawEmail || !name || !password) {
    console.warn(`Skipping user (missing env): name=${name ?? "?"} email=${rawEmail ?? "?"}`);
    return;
  }
  // auth.ts lowercases the input email on login, so the seed must
  // store the lowercased form too. SQLite's UNIQUE index on email
  // is case-sensitive by default, so a mixed-case env value would
  // create a row that can't be logged into.
  const email = rawEmail.toLowerCase().trim();
  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.upsert({
    where: { email },
    update: { name, passwordHash },
    create: { email, name, passwordHash },
  });
  console.log(`Seeded user: ${name} <${email}>`);
}

async function main() {
  await upsertUser(process.env.HER_EMAIL, process.env.HER_NAME, process.env.HER_PASSWORD);
  await upsertUser(process.env.HIS_EMAIL, process.env.HIS_NAME, process.env.HIS_PASSWORD);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
