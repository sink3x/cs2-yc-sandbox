'use strict';
// Usage: printf '%s' "$PASSWORD" | node adduser.js <username>
// Creates or updates a panel user in /var/lib/cs2-admin/users.json (scrypt hash, mode 0600).
const path = require('node:path');
const { hashPassword } = require('../lib/auth');
const { readJson, writeJsonAtomic } = require('../lib/util');

const VAR = process.env.CS2ADMIN_VAR || '/var/lib/cs2-admin';
const name = process.argv[2];
if (!name || !/^[A-Za-z0-9_.-]{1,32}$/.test(name)) { console.error('usage: printf "%s" "$PASSWORD" | node adduser.js <username>'); process.exit(2); }

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  const password = input.replace(/\r?\n$/, '');
  if (password.length < 10) { console.error('password must be at least 10 characters'); process.exit(2); }
  const file = path.join(VAR, 'users.json');
  const db = readJson(file, { users: {} });
  db.users[name] = { hash: hashPassword(password), role: 'admin', updatedAt: new Date().toISOString() };
  writeJsonAtomic(file, db, 0o600);
  console.log(`user ${name} saved`);
});
