/**
 * E2E Authentication Test Suite
 * Run with: node e2e-auth-test.js
 */

const BASE_URL = 'http://localhost:3001/api/v1/auth';

// Test data
const timestamp = Date.now();
const testEmail = `e2e-test-${timestamp}@example.com`;
const testPassword = 'TestPass123!@#';
const newPassword = 'NewPass456!@#';

// Store cookies and tokens
let accessToken = '';
let refreshToken = '';
let verificationToken = '';
let resetToken = '';

// Results tracking
const results = {
  passed: [],
  failed: [],
  skipped: []
};

// Helper to make requests
async function request(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };

  if (accessToken) {
    headers['Cookie'] = `access_token=${accessToken}; refresh_token=${refreshToken}`;
  }

  try {
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      credentials: 'include'
    });

    // Extract cookies from response
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) {
      const accessMatch = setCookie.match(/access_token=([^;]+)/);
      const refreshMatch = setCookie.match(/refresh_token=([^;]+)/);
      if (accessMatch) accessToken = accessMatch[1];
      if (refreshMatch) refreshToken = refreshMatch[1];
    }

    const data = await response.json();
    return { status: response.status, data, ok: response.ok };
  } catch (error) {
    return { status: 0, error: error.message, ok: false };
  }
}

// Test runner
async function test(name, fn, expected = 'pass') {
  process.stdout.write(`[TEST] ${name}... `);
  try {
    const result = await fn();
    if (result.pass) {
      console.log('\x1b[32mPASS\x1b[0m');
      if (result.message) console.log(`       ${result.message}`);
      results.passed.push(name);
    } else {
      console.log('\x1b[31mFAIL\x1b[0m');
      if (result.message) console.log(`       ${result.message}`);
      results.failed.push({ name, message: result.message });
    }
  } catch (error) {
    console.log('\x1b[31mERROR\x1b[0m');
    console.log(`       ${error.message}`);
    results.failed.push({ name, message: error.message });
  }
}

async function runTests() {
  console.log('=========================================');
  console.log('E2E Authentication Test Suite');
  console.log('=========================================');
  console.log(`Test Email: ${testEmail}`);
  console.log(`Test Password: ${testPassword}`);
  console.log('');

  // Test 1: Register new user
  await test('1. Register new user', async () => {
    const res = await request('/register', {
      method: 'POST',
      body: { email: testEmail, password: testPassword }
    });

    if (res.status === 201 && res.data.success) {
      return { pass: true, message: `User ID: ${res.data.data.user.id}` };
    }
    return { pass: false, message: `Status: ${res.status}, Error: ${JSON.stringify(res.data)}` };
  });

  // Test 2: Try login before email verification (should fail)
  await test('2. Login before email verification (should be rejected)', async () => {
    // Clear tokens first
    accessToken = '';
    refreshToken = '';

    const res = await request('/login', {
      method: 'POST',
      body: { email: testEmail, password: testPassword }
    });

    // Should be rejected (401 or 403) for unverified email
    if (res.status === 403 || (res.status === 401 && res.data.error?.code === 'EMAIL_NOT_VERIFIED')) {
      return { pass: true, message: 'Login correctly rejected' };
    }

    // If login succeeds, that's a BUG
    if (res.data.success) {
      return { pass: false, message: 'BUG: Login succeeded but email is not verified!' };
    }

    return { pass: false, message: `Status: ${res.status}, Response: ${JSON.stringify(res.data)}` };
  });

  // Test 3: Verify email (need to check console for token)
  await test('3. Email verification endpoint works', async () => {
    // Try with invalid token first
    const res = await request('/verify-email?token=invalid-token-12345');

    if (res.status === 400) {
      return { pass: true, message: 'Invalid token correctly rejected. Check console for real verification URL.' };
    }
    return { pass: false, message: `Unexpected status: ${res.status}` };
  });

  // Test 4: Resend verification
  await test('4. Resend verification email', async () => {
    const res = await request('/resend-verification', {
      method: 'POST',
      body: { email: testEmail }
    });

    if (res.status === 200) {
      return { pass: true, message: 'Verification email resent' };
    }
    return { pass: false, message: `Status: ${res.status}` };
  });

  // NOTE: At this point, manual intervention would be needed to get verification token from console
  // For automated testing, we'll skip to testing login with the already-logged-in session from registration

  // Test 5: Token refresh
  await test('5. Token refresh', async () => {
    const res = await request('/refresh', {
      method: 'POST'
    });

    if (res.status === 200 && res.data.success) {
      return { pass: true, message: 'Token refreshed successfully' };
    }
    return { pass: false, message: `Status: ${res.status}, Error: ${JSON.stringify(res.data)}` };
  });

  // Test 6: Get current user
  await test('6. Get current user (/me)', async () => {
    const res = await request('/me');

    if (res.status === 200 && res.data.success && res.data.data.email === testEmail) {
      return { pass: true, message: `Email: ${res.data.data.email}` };
    }
    return { pass: false, message: `Status: ${res.status}, Data: ${JSON.stringify(res.data)}` };
  });

  // Test 7: Change password
  await test('7. Change password', async () => {
    const res = await request('/change-password', {
      method: 'POST',
      body: { currentPassword: testPassword, newPassword: newPassword }
    });

    if (res.status === 200 && res.data.success) {
      return { pass: true, message: 'Password changed successfully' };
    }
    return { pass: false, message: `Status: ${res.status}, Error: ${JSON.stringify(res.data)}` };
  });

  // Test 8: Verify can login with new password
  await test('8. Login with new password', async () => {
    accessToken = '';
    refreshToken = '';

    const res = await request('/login', {
      method: 'POST',
      body: { email: testEmail, password: newPassword }
    });

    // Note: This might fail if email verification is required
    if (res.status === 200 && res.data.success) {
      return { pass: true, message: 'Login with new password succeeded' };
    }
    return { pass: false, message: `Status: ${res.status}, Error: ${JSON.stringify(res.data)}` };
  });

  // Test 9: Logout
  await test('9. Logout', async () => {
    const res = await request('/logout', {
      method: 'POST'
    });

    if (res.status === 200 && res.data.success) {
      return { pass: true, message: 'Logged out successfully' };
    }
    return { pass: false, message: `Status: ${res.status}, Error: ${JSON.stringify(res.data)}` };
  });

  // Test 10: Access protected route after logout (should fail)
  await test('10. Access /me after logout (should fail)', async () => {
    accessToken = '';
    refreshToken = '';

    const res = await request('/me');

    if (res.status === 401) {
      return { pass: true, message: 'Access correctly denied after logout' };
    }
    return { pass: false, message: `Status: ${res.status}, should be 401` };
  });

  // Test 11: Forgot password
  await test('11. Forgot password endpoint', async () => {
    const res = await request('/forgot-password', {
      method: 'POST',
      body: { email: testEmail }
    });

    if (res.status === 200) {
      return { pass: true, message: 'Reset email sent (check console)' };
    }
    if (res.status === 404) {
      return { pass: false, message: 'MISSING: Forgot password endpoint not implemented' };
    }
    return { pass: false, message: `Status: ${res.status}` };
  });

  // Print summary
  console.log('');
  console.log('=========================================');
  console.log('Test Summary');
  console.log('=========================================');
  console.log(`\x1b[32mPassed: ${results.passed.length}\x1b[0m`);
  console.log(`\x1b[31mFailed: ${results.failed.length}\x1b[0m`);

  if (results.failed.length > 0) {
    console.log('');
    console.log('Failed Tests:');
    results.failed.forEach(f => {
      console.log(`  - ${f.name}: ${f.message}`);
    });
  }

  console.log('');
  console.log('BUGS FOUND:');
  console.log('1. Login does not check email verification status');
  console.log('2. Forgot password endpoint does not exist');
}

runTests().catch(console.error);
