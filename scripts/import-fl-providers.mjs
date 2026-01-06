import pg from 'pg';
import { createReadStream } from 'fs';
import { parse } from 'csv-parse';
import { randomUUID } from 'crypto';

const { Pool } = pg;

// Database connection
const pool = new Pool({
  connectionString: 'postgresql://postgres:vMp$db2026!xKq9Tz@35.222.45.196:5432/providerdb',
  max: 5,
});

// CSV file path
const CSV_PATH = 'C:\\Users\\breil\\OneDrive\\Desktop\\NPI\\by_state\\FL.csv';

// Batch size
const BATCH_SIZE = 500;
const PROGRESS_INTERVAL = 10000;

// Taxonomy code to specialty category mapping
const TAXONOMY_TO_SPECIALTY = {
  // Endocrinology
  '207RE0101X': 'ENDOCRINOLOGY',
  '207RD0900X': 'ENDOCRINOLOGY',
  // Rheumatology
  '207RR0500X': 'RHEUMATOLOGY',
  // Orthopedics
  '207X00000X': 'ORTHOPEDICS',
  '207XS0114X': 'ORTHOPEDICS',
  '207XS0106X': 'ORTHOPEDICS',
  '207XS0117X': 'ORTHOPEDICS',
  '207XX0004X': 'ORTHOPEDICS',
  '207XX0005X': 'ORTHOPEDICS',
  '207XX0801X': 'ORTHOPEDICS',
  '207XP3100X': 'ORTHOPEDICS',
  '204C00000X': 'ORTHOPEDICS',
  '2251P0200X': 'ORTHOPEDICS',
  '225100000X': 'ORTHOPEDICS',
  // Internal Medicine
  '207R00000X': 'INTERNAL_MEDICINE',
  '207RA0000X': 'INTERNAL_MEDICINE',
  '207RA0001X': 'INTERNAL_MEDICINE',
  '207RA0201X': 'INTERNAL_MEDICINE',
  '207RC0000X': 'INTERNAL_MEDICINE',
  '207RC0001X': 'INTERNAL_MEDICINE',
  '207RC0200X': 'INTERNAL_MEDICINE',
  '207RE0000X': 'INTERNAL_MEDICINE',
  '207RG0100X': 'INTERNAL_MEDICINE',
  '207RG0300X': 'INTERNAL_MEDICINE',
  '207RH0000X': 'INTERNAL_MEDICINE',
  '207RH0002X': 'INTERNAL_MEDICINE',
  '207RH0003X': 'INTERNAL_MEDICINE',
  '207RH0005X': 'INTERNAL_MEDICINE',
  '207RI0001X': 'INTERNAL_MEDICINE',
  '207RI0008X': 'INTERNAL_MEDICINE',
  '207RI0011X': 'INTERNAL_MEDICINE',
  '207RI0200X': 'INTERNAL_MEDICINE',
  '207RM1200X': 'INTERNAL_MEDICINE',
  '207RN0300X': 'INTERNAL_MEDICINE',
  '207RP1001X': 'INTERNAL_MEDICINE',
  '207RR0600X': 'INTERNAL_MEDICINE',
  '207RS0010X': 'INTERNAL_MEDICINE',
  '207RS0012X': 'INTERNAL_MEDICINE',
  '207RT0003X': 'INTERNAL_MEDICINE',
  '207RU0100X': 'INTERNAL_MEDICINE',
  '207RX0202X': 'INTERNAL_MEDICINE',
  // Family Medicine
  '207Q00000X': 'FAMILY_MEDICINE',
  '207QA0000X': 'FAMILY_MEDICINE',
  '207QA0401X': 'FAMILY_MEDICINE',
  '207QA0505X': 'FAMILY_MEDICINE',
  '207QB0002X': 'FAMILY_MEDICINE',
  '207QG0300X': 'FAMILY_MEDICINE',
  '207QH0002X': 'FAMILY_MEDICINE',
  '207QS0010X': 'FAMILY_MEDICINE',
  '207QS1201X': 'FAMILY_MEDICINE',
  '208D00000X': 'FAMILY_MEDICINE',
  // Geriatrics
  '2084N0402X': 'GERIATRICS',
  '2084P0805X': 'GERIATRICS',
};

const SPECIALTY_PREFIXES = [
  { prefix: '207RE', specialty: 'ENDOCRINOLOGY' },
  { prefix: '207RR0500', specialty: 'RHEUMATOLOGY' },
  { prefix: '207X', specialty: 'ORTHOPEDICS' },
  { prefix: '207R', specialty: 'INTERNAL_MEDICINE' },
  { prefix: '207Q', specialty: 'FAMILY_MEDICINE' },
];

function getSpecialtyCategory(taxonomyCode) {
  if (!taxonomyCode) return null;
  if (TAXONOMY_TO_SPECIALTY[taxonomyCode]) return TAXONOMY_TO_SPECIALTY[taxonomyCode];
  for (const { prefix, specialty } of SPECIALTY_PREFIXES) {
    if (taxonomyCode.startsWith(prefix)) return specialty;
  }
  return 'OTHER';
}

function parseDate(dateStr) {
  if (!dateStr || dateStr.trim() === '') return null;
  const parts = dateStr.split('/');
  if (parts.length !== 3) return null;
  const [month, day, year] = parts;
  const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
  if (isNaN(date.getTime())) return null;
  return date;
}

function formatZip(zip) {
  if (!zip) return '00000';
  const digits = zip.replace(/\D/g, '');
  if (digits.length >= 9) return digits.substring(0, 5) + '-' + digits.substring(5, 9);
  if (digits.length >= 5) return digits.substring(0, 5);
  return digits.padStart(5, '0');
}

function getNpiStatus(deactivationDate, reactivationDate) {
  if (!deactivationDate) return 'ACTIVE';
  if (reactivationDate) return 'ACTIVE';
  return 'DEACTIVATED';
}

function sanitize(str, maxLen = null) {
  if (!str) return null;
  // Remove ALL null bytes and control characters, including \x00
  let clean = str
    .replace(/\x00/g, '')  // Remove null bytes explicitly
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')  // Remove control chars
    .replace(/\uFFFD/g, '')  // Remove replacement chars
    .trim();
  if (maxLen && clean.length > maxLen) clean = clean.substring(0, maxLen);
  return clean || null;
}

function transformProvider(row) {
  const entityTypeCode = row['Entity Type Code'];
  const entityType = entityTypeCode === '1' ? 'INDIVIDUAL' : entityTypeCode === '2' ? 'ORGANIZATION' : 'INDIVIDUAL';

  const deactivationDate = parseDate(row['NPI Deactivation Date']);
  const reactivationDate = parseDate(row['NPI Reactivation Date']);
  const taxonomyCode = sanitize(row['Healthcare Provider Taxonomy Code_1'], 20);

  // Get state and validate it's 2 chars
  let state = sanitize(row['Provider Business Practice Location Address State Name'], 2);
  if (!state || state.length !== 2) state = 'FL'; // Default to FL for Florida file

  return {
    id: randomUUID(),
    npi: sanitize(row['NPI'], 10),
    entityType,
    firstName: sanitize(row['Provider First Name'], 100),
    lastName: sanitize(row['Provider Last Name (Legal Name)'], 100),
    middleName: sanitize(row['Provider Middle Name'], 100),
    credential: sanitize(row['Provider Credential Text'], 50),
    organizationName: sanitize(row['Provider Organization Name (Legal Business Name)'], 300),
    addressLine1: sanitize(row['Provider First Line Business Practice Location Address'], 200) || 'N/A',
    addressLine2: sanitize(row['Provider Second Line Business Practice Location Address'], 200),
    city: sanitize(row['Provider Business Practice Location Address City Name'], 100) || 'Unknown',
    state,
    zip: formatZip(row['Provider Business Practice Location Address Postal Code']),
    country: 'US',
    phone: sanitize(row['Provider Business Practice Location Address Telephone Number'], 20),
    fax: sanitize(row['Provider Business Practice Location Address Fax Number'], 20),
    taxonomyCode,
    taxonomyDescription: null,
    specialtyCategory: getSpecialtyCategory(taxonomyCode),
    secondaryTaxonomies: null,
    enumerationDate: parseDate(row['Provider Enumeration Date']),
    lastUpdateDate: parseDate(row['Last Update Date']),
    deactivationDate,
    reactivationDate,
    npiStatus: getNpiStatus(deactivationDate, reactivationDate),
  };
}

async function insertBatch(client, providers) {
  if (providers.length === 0) return 0;

  const columns = [
    'id', 'npi', '"entityType"', '"firstName"', '"lastName"', '"middleName"',
    'credential', '"organizationName"', '"addressLine1"', '"addressLine2"',
    'city', 'state', 'zip', 'country', 'phone', 'fax',
    '"taxonomyCode"', '"taxonomyDescription"', '"specialtyCategory"', '"secondaryTaxonomies"',
    '"enumerationDate"', '"lastUpdateDate"', '"deactivationDate"', '"reactivationDate"',
    '"npiStatus"', '"createdAt"', '"updatedAt"'
  ];

  const values = [];
  const placeholders = [];
  let paramIndex = 1;

  for (const p of providers) {
    const rowPlaceholders = [];
    const now = new Date();

    const rowValues = [
      p.id, p.npi, p.entityType, p.firstName, p.lastName, p.middleName,
      p.credential, p.organizationName, p.addressLine1, p.addressLine2,
      p.city, p.state, p.zip, p.country, p.phone, p.fax,
      p.taxonomyCode, p.taxonomyDescription, p.specialtyCategory,
      p.secondaryTaxonomies ? JSON.stringify(p.secondaryTaxonomies) : null,
      p.enumerationDate, p.lastUpdateDate, p.deactivationDate, p.reactivationDate,
      p.npiStatus, now, now
    ];

    for (const val of rowValues) {
      rowPlaceholders.push(`$${paramIndex++}`);
      values.push(val);
    }

    placeholders.push(`(${rowPlaceholders.join(', ')})`);
  }

  const query = `
    INSERT INTO providers (${columns.join(', ')})
    VALUES ${placeholders.join(', ')}
    ON CONFLICT (npi) DO NOTHING
  `;

  const result = await client.query(query, values);
  return result.rowCount;
}

async function main() {
  console.log('='.repeat(60));
  console.log('Florida NPI Provider Import');
  console.log('='.repeat(60));
  console.log(`CSV file: ${CSV_PATH}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log('');

  const startTime = Date.now();

  let client = await pool.connect();
  console.log('Connected to database');

  // Get existing NPIs
  console.log('Loading existing NPIs...');
  const existingResult = await client.query('SELECT npi FROM providers');
  const existingNpis = new Set(existingResult.rows.map(r => r.npi));
  console.log(`Found ${existingNpis.size} existing NPIs to skip`);
  console.log('');

  // Create CSV parser
  const parser = createReadStream(CSV_PATH).pipe(
    parse({
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      relax_quotes: true,
      trim: true,
    })
  );

  let batch = [];
  let totalProcessed = 0;
  let totalInserted = 0;
  let totalSkipped = 0;
  let totalDuplicates = 0;
  let errorCount = 0;

  console.log('Processing CSV...');
  console.log('-'.repeat(60));

  for await (const row of parser) {
    totalProcessed++;

    const npi = row['NPI'];
    if (!npi) {
      totalSkipped++;
      continue;
    }

    if (existingNpis.has(npi)) {
      totalDuplicates++;
      continue;
    }

    try {
      const provider = transformProvider(row);
      batch.push(provider);
      existingNpis.add(npi);
    } catch (err) {
      totalSkipped++;
      continue;
    }

    if (batch.length >= BATCH_SIZE) {
      try {
        const inserted = await insertBatch(client, batch);
        totalInserted += inserted;
      } catch (err) {
        errorCount++;
        if (errorCount <= 10) {
          console.error(`Batch error at row ${totalProcessed}: ${err.message}`);
        }
        // Try to recover connection if needed
        if (err.code === '08P01' || err.message.includes('invalid')) {
          try {
            client.release();
            client = await pool.connect();
            console.log('Reconnected to database');
          } catch (reconnectErr) {
            console.error('Failed to reconnect:', reconnectErr.message);
          }
        }
      }
      batch = [];
    }

    if (totalProcessed % PROGRESS_INTERVAL === 0) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = Math.round(totalProcessed / elapsed);
      console.log(
        `Progress: ${totalProcessed.toLocaleString()} rows | ` +
        `Inserted: ${totalInserted.toLocaleString()} | ` +
        `Skipped: ${totalSkipped.toLocaleString()} | ` +
        `Rate: ${rate}/sec`
      );
    }
  }

  // Insert remaining
  if (batch.length > 0) {
    try {
      const inserted = await insertBatch(client, batch);
      totalInserted += inserted;
    } catch (err) {
      console.error('Final batch error:', err.message);
    }
  }

  const totalTime = (Date.now() - startTime) / 1000;

  console.log('-'.repeat(60));
  console.log('');
  console.log('='.repeat(60));
  console.log('IMPORT COMPLETE');
  console.log('='.repeat(60));
  console.log(`Total rows processed: ${totalProcessed.toLocaleString()}`);
  console.log(`Providers inserted:   ${totalInserted.toLocaleString()}`);
  console.log(`Rows skipped:         ${totalSkipped.toLocaleString()}`);
  console.log(`Duplicates:           ${totalDuplicates.toLocaleString()}`);
  console.log(`Batch errors:         ${errorCount}`);
  console.log(`Total time:           ${totalTime.toFixed(1)} seconds`);
  console.log(`Average rate:         ${Math.round(totalProcessed / totalTime)}/sec`);
  console.log('='.repeat(60));

  const finalCount = await client.query('SELECT COUNT(*) FROM providers');
  console.log(`\nFinal provider count in database: ${finalCount.rows[0].count}`);

  client.release();
  await pool.end();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
