// Load the values `npm run configure` wrote from the Terraform outputs.
import { existsSync } from "node:fs";

const envFile = new URL("../.env", import.meta.url).pathname;
if (!existsSync(envFile)) {
  throw new Error("Missing .env. Run `npm run configure` after `lstk terraform apply`.");
}
process.loadEnvFile(envFile);
