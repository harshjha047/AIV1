import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const force = args.includes('--force');
const out = args.find((a) => !a.startsWith('--')) ?? '.env.rotated';

if (existsSync(out) && !force) {
  console.error(`${out} exists; pass --force to overwrite`);
  process.exit(1);
}

const hex = (bytes) => randomBytes(bytes).toString('hex');
const alphanumeric = (length) => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  while (value.length < length) {
    for (const byte of randomBytes(length)) {
      if (byte < 248 && value.length < length) value += alphabet[byte % alphabet.length];
    }
  }
  return value;
};

const apps = ['CRM', 'BAHIKHATA', 'SAMADHAN', 'INVOICING'];
const lines = [
  `JWT_SECRET=${hex(48)}`,
  `DB_PASSWORD=${alphanumeric(40)}`,
  `SOURCE_CRED_MASTER_KEY=${randomBytes(32).toString('base64')}`,
  `AI_REDIS_PASSWORD=${alphanumeric(40)}`,
  `LOCAL_MONGO_ROOT_PASSWORD=${alphanumeric(32)}`,
  ...apps.map((app) => `AI_KEY_${app}=${hex(32)}`),
  ...apps.map((app) => `AI_HMAC_SECRET_${app}=${hex(32)}`),
];

writeFileSync(out, `${lines.join('\n')}\n`, { mode: 0o600 });
console.log(`wrote ${out} (${lines.length} values)`);
