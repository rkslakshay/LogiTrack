import "../src/server/env";
import { prisma } from "../src/lib/db";
import { adminResetMfaByEmail, createPasswordResetLink, unlockAccount } from "../src/server/services/account";

// Account recovery from the command line, for when no Super Admin can sign in.
// Anyone who can run this has access to the server and the database file anyway.
//
//   npm run auth:reset-link -- <email>   one-time password reset link (valid 1 hour)
//   npm run auth:reset-mfa  -- <email>   remove two-factor authentication
//   npm run auth:unlock     -- <email>   lift a temporary sign-in lock

const [command, email] = process.argv.slice(2);

async function main() {
  if (!command || !email) {
    console.log("Usage: tsx scripts/auth.ts <reset-link|reset-mfa|unlock> <email>");
    process.exitCode = 1;
    return;
  }
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user) throw new Error(`No account with the e-mail address ${email}.`);

  switch (command) {
    case "reset-link": {
      const origin = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
      const link = await createPasswordResetLink(null, user.id, origin);
      console.log(`Reset link for ${user.name} (valid until ${link.expiresAt.toLocaleString("en-IN")}, single use):\n\n  ${link.url}\n`);
      console.log("Give it to the user directly. Set APP_URL if the app is not at the address above.");
      break;
    }
    case "reset-mfa":
      await adminResetMfaByEmail(user.email);
      console.log(`Two-factor authentication removed for ${user.name}. They have been signed out everywhere.`);
      break;
    case "unlock":
      await unlockAccount(null, user.id);
      console.log(`${user.name} can sign in again.`);
      break;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
