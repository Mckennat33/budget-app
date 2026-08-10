import dotenv from 'dotenv';
import pkg from 'pg';

dotenv.config();
const { Client } = pkg;

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) {
  console.error('Missing DATABASE_URL in .env');
  process.exit(1);
}

function getInitConnectionString(urlString) {
  const url = new URL(urlString);
  const dbName = url.pathname.slice(1) || 'budget_app';
  url.pathname = '/postgres';
  return { connectionString: url.toString(), dbName };
}

async function main() {
  const { connectionString, dbName } = getInitConnectionString(DATABASE_URL);
  const client = new Client({ connectionString });
  await client.connect();

  const result = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (result.rowCount === 0) {
    console.log(`Creating database ${dbName}...`);
    await client.query(`CREATE DATABASE ${dbName}`);
    console.log('Database created.');
  } else {
    console.log(`Database ${dbName} already exists.`);
  }

  await client.end();
}

main().catch((error) => {
  console.error('Database creation failed:', error.message || error);
  process.exit(1);
});
