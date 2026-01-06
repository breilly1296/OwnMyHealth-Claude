import pg from 'pg';

const { Client } = pg;

const client = new Client({
  connectionString: 'postgresql://postgres:vMp$db2026!xKq9Tz@35.222.45.196:5432/providerdb'
});

async function main() {
  await client.connect();

  // Get enum values
  const enums = await client.query(`
    SELECT t.typname, e.enumlabel
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    ORDER BY t.typname, e.enumsortorder
  `);

  console.log('Enum values:');
  const grouped = {};
  for (const row of enums.rows) {
    if (!grouped[row.typname]) grouped[row.typname] = [];
    grouped[row.typname].push(row.enumlabel);
  }
  console.log(grouped);

  await client.end();
}

main().catch(console.error);
