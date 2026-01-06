import pg from 'pg';

const { Client } = pg;

const client = new Client({
  connectionString: 'postgresql://postgres:vMp$db2026!xKq9Tz@35.222.45.196:5432/providerdb'
});

async function main() {
  await client.connect();

  const result = await client.query(`
    SELECT column_name, data_type, character_maximum_length, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'providers'
    ORDER BY ordinal_position
  `);

  console.log('Column constraints:');
  for (const row of result.rows) {
    console.log(`${row.column_name}: ${row.data_type}${row.character_maximum_length ? `(${row.character_maximum_length})` : ''} ${row.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'}`);
  }

  await client.end();
}

main().catch(console.error);
