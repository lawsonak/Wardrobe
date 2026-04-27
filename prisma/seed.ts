import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function upsertUser(email?: string, name?: string, password?: string) {
  if (!email || !name || !password) {
    console.warn(`Skipping user (missing env): name=${name ?? "?"} email=${email ?? "?"}`);
    return;
  }
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
