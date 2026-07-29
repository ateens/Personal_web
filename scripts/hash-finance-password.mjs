import { hashFinancePassword } from "../server/finance.js";

if (process.stdin.isTTY) {
  console.error("Read the password without echo and pipe it to this command. See .env.example.");
  process.exit(1);
}

let password = "";
for await (const chunk of process.stdin) password += chunk.toString("utf8");
password = password.replace(/\r?\n$/, "");

try {
  process.stdout.write(`${await hashFinancePassword(password)}\n`);
} catch (error) {
  console.error(error.message || "Finance password hashing failed.");
  process.exit(1);
}
