// addUser.js
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');

const [,, username, password] = process.argv;
if (!username || !password) {
  console.log('Usage: node addUser.js <username> <password>');
  process.exit(1);
}

const usersPath = path.join(__dirname, 'users.json');
const users = fs.existsSync(usersPath) ? JSON.parse(fs.readFileSync(usersPath)) : [];

const saltRounds = 10;
bcrypt.hash(password, saltRounds).then(hash => {
  users.push({ username, passwordHash: hash });
  fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
  console.log('User added:', username);
}).catch(err => {
  console.error(err);
});
