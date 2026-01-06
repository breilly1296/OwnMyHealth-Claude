import pg from 'pg';

const { Client } = pg;

const client = new Client({
  connectionString: 'postgresql://postgres:vMp$db2026!xKq9Tz@35.222.45.196:5432/providerdb'
});

async function main() {
  await client.connect();

  console.log('='.repeat(60));
  console.log('FLORIDA PROVIDER IMPORT SUMMARY');
  console.log('='.repeat(60));
  console.log('');

  // Total count
  const total = await client.query('SELECT COUNT(*) FROM providers');
  console.log(`Total providers: ${parseInt(total.rows[0].count).toLocaleString()}`);

  // By entity type
  console.log('\nBy Entity Type:');
  const byEntity = await client.query(`
    SELECT "entityType", COUNT(*) as count
    FROM providers
    GROUP BY "entityType"
  `);
  for (const row of byEntity.rows) {
    console.log(`  ${row.entityType}: ${parseInt(row.count).toLocaleString()}`);
  }

  // By specialty category
  console.log('\nBy Specialty Category:');
  const bySpecialty = await client.query(`
    SELECT "specialtyCategory", COUNT(*) as count
    FROM providers
    GROUP BY "specialtyCategory"
    ORDER BY count DESC
  `);
  for (const row of bySpecialty.rows) {
    const cat = row.specialtyCategory || 'NULL';
    console.log(`  ${cat}: ${parseInt(row.count).toLocaleString()}`);
  }

  // By NPI status
  console.log('\nBy NPI Status:');
  const byStatus = await client.query(`
    SELECT "npiStatus", COUNT(*) as count
    FROM providers
    GROUP BY "npiStatus"
  `);
  for (const row of byStatus.rows) {
    console.log(`  ${row.npiStatus}: ${parseInt(row.count).toLocaleString()}`);
  }

  // Sample providers
  console.log('\nSample Providers (first 5):');
  const sample = await client.query(`
    SELECT npi, "firstName", "lastName", "organizationName", city, "taxonomyCode", "specialtyCategory"
    FROM providers
    LIMIT 5
  `);
  console.table(sample.rows);

  await client.end();
}

main().catch(console.error);
