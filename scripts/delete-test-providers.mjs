import pg from 'pg';

const { Client } = pg;

const client = new Client({
  connectionString: 'postgresql://postgres:vMp$db2026!xKq9Tz@35.222.45.196:5432/providerdb'
});

async function main() {
  await client.connect();

  console.log('Checking current counts...');
  const providerCount = await client.query('SELECT COUNT(*) FROM providers');
  const insuranceCount = await client.query('SELECT COUNT(*) FROM insurance_plans');
  console.log(`Providers: ${providerCount.rows[0].count}`);
  console.log(`Insurance plans: ${insuranceCount.rows[0].count}`);

  console.log('\nDeleting all providers (keeping insurance_plans intact)...');
  const result = await client.query('DELETE FROM providers');
  console.log(`Deleted ${result.rowCount} providers`);

  console.log('\nVerifying...');
  const newCount = await client.query('SELECT COUNT(*) FROM providers');
  const newInsuranceCount = await client.query('SELECT COUNT(*) FROM insurance_plans');
  console.log(`Providers after: ${newCount.rows[0].count}`);
  console.log(`Insurance plans after: ${newInsuranceCount.rows[0].count}`);

  await client.end();
  console.log('\nDone!');
}

main().catch(console.error);
