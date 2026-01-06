import pg from 'pg';

const { Client } = pg;

const client = new Client({
  connectionString: 'postgresql://postgres:vMp$db2026!xKq9Tz@35.222.45.196:5432/providerdb'
});

async function main() {
  await client.connect();

  // Get table structure
  const result = await client.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'providers'
    ORDER BY ordinal_position
  `);

  console.log('Providers table structure:');
  console.table(result.rows);

  // Get row count
  const countResult = await client.query('SELECT COUNT(*) FROM providers');
  console.log('\nCurrent row count:', countResult.rows[0].count);

  // Check insurance_plans
  const insuranceCount = await client.query('SELECT COUNT(*) FROM insurance_plans');
  console.log('Insurance plans count:', insuranceCount.rows[0].count);

  await client.end();
}

main().catch(console.error);
