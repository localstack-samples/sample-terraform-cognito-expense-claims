// Prints the current TOTP code for a base32 secret, like an authenticator app would.
//   npm run totp -- <SECRET>
import { Secret, TOTP } from "otpauth";

const secret = process.argv[2] ?? process.env.TOTP_SECRET;
if (!secret) {
  console.error("usage: npm run totp -- <base32 secret>");
  process.exit(1);
}

const totp = new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30 });
const remaining = 30 - (Math.floor(Date.now() / 1000) % 30);
console.log(`${totp.generate()}  (valid for ${remaining}s)`);
