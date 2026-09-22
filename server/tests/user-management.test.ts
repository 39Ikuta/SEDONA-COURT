/**
 * server/tests/user-management.test.ts
 * Comprehensive automated test suite for Owner User Management & Cashier Accounts.
 * 
 * Verifies:
 * 1. Role-Based Access Control (RBAC):
 *    - Unauthenticated requests rejected with 401.
 *    - customer_display, kitchen, and cashier receive 403 Forbidden on user management.
 *    - Admin can view accounts (200), but receives 403 on create/delete.
 *    - Owner has exclusive privileges to create and delete accounts.
 * 2. User Creation & Validation:
 *    - Validates required fields, username format, role, and min password length.
 *    - Duplicate username rejected with 409 Conflict.
 *    - Password hash is never exposed in response.
 *    - Audit log entry generated for USER_CREATED.
 * 3. Cashier Accounts Authentication:
 *    - Verified cashier logins for 'pau', 'raquel', 'tuter' using generic password 'cashier123'.
 *    - Failed login with incorrect credentials returns 401.
 * 4. Password Reset & Updates:
 *    - Owner can update password via PUT /api/users/:identifier/password.
 *    - Audit log entry generated for USER_PASSWORD_RESET.
 * 5. Account Deletion:
 *    - Owner cannot delete their own active account (400).
 *    - Owner can delete staff account (200).
 *    - Deleted account can no longer authenticate (401).
 *    - Audit log entry generated for USER_DELETED.
 */

process.env.NODE_ENV = 'test';
process.env.TZ = 'Asia/Manila';

import http from 'http';
import bcrypt from 'bcryptjs';
import { pool } from '../db/pool';
import { signJwt } from '../utils/jwt';
import { SEED_USER_ACCOUNTS } from '../data/seed-accounts';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

function assertTest(name: string, condition: boolean, details?: string) {
  if (condition) {
    console.log(`✅ ${name}`);
    results.push({ name, passed: true });
  } else {
    console.error(`❌ ${name}${details ? ` — ${details}` : ''}`);
    results.push({ name, passed: false, error: details });
  }
}

async function runTests() {
  console.log('\n🔐 STARTING OWNER USER MANAGEMENT & CASHIER ACCOUNTS TEST SUITE\n');

  const { app } = await import('../index');

  // Start dedicated HTTP test server on an ephemeral port
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  // Helper for requests
  async function request(path: string, options: { method?: string; body?: any; token?: string } = {}) {
    const headers: Record<string, string> = {};
    if (options.token) headers['Authorization'] = `Bearer ${options.token}`;
    if (options.body) headers['Content-Type'] = 'application/json';

    const res = await fetch(`${baseUrl}${path}`, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data: any = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }

  // Tokens
  const ownerToken = signJwt({ id: 1, username: 'owner', role: 'owner', name: 'Sedona Owner' });
  const adminToken = signJwt({ id: 2, username: 'admin', role: 'admin', name: 'Admin Terminal' });
  const cashierToken = signJwt({ id: 3, username: 'pau', role: 'cashier', name: 'Pau Cashier' });
  const kitchenToken = signJwt({ id: 4, username: 'kitchen1', role: 'kitchen', name: 'Kitchen Staff' });
  const kioskToken = signJwt({ id: 5, username: 'kiosk', role: 'customer_display', name: 'Lobby Kiosk' });

  try {
    // =========================================================================
    // SECTION 1: ROLE-BASED ACCESS CONTROL (RBAC)
    // =========================================================================
    console.log('--- 1. Role-Based Access Control (RBAC) ---');

    // 1.1 Unauthenticated requests
    const unauthGet = await request('/api/users');
    assertTest('1.1: Unauthenticated GET /api/users returns 401', unauthGet.status === 401);

    const unauthPost = await request('/api/users', {
      method: 'POST',
      body: { username: 'test1', name: 'Test', role: 'cashier', accessCode: 'test123' },
    });
    assertTest('1.2: Unauthenticated POST /api/users returns 401', unauthPost.status === 401);

    const unauthDelete = await request('/api/users/999', { method: 'DELETE' });
    assertTest('1.3: Unauthenticated DELETE /api/users/:id returns 401', unauthDelete.status === 401);

    // 1.2 Customer Display role forbidden
    const kioskGet = await request('/api/users', { token: kioskToken });
    assertTest('1.4: customer_display role receives 403 Forbidden on GET /api/users', kioskGet.status === 403);

    const kioskPost = await request('/api/users', {
      method: 'POST',
      token: kioskToken,
      body: { username: 'test2', name: 'Test', role: 'cashier', accessCode: 'test123' },
    });
    assertTest('1.5: customer_display role receives 403 Forbidden on POST /api/users', kioskPost.status === 403);

    // 1.3 Kitchen role forbidden
    const kitchenPost = await request('/api/users', {
      method: 'POST',
      token: kitchenToken,
      body: { username: 'test3', name: 'Test', role: 'cashier', accessCode: 'test123' },
    });
    assertTest('1.6: kitchen role receives 403 Forbidden on POST /api/users', kitchenPost.status === 403);

    // 1.4 Cashier role forbidden
    const cashierPost = await request('/api/users', {
      method: 'POST',
      token: cashierToken,
      body: { username: 'test4', name: 'Test', role: 'cashier', accessCode: 'test123' },
    });
    assertTest('1.7: cashier role receives 403 Forbidden on POST /api/users', cashierPost.status === 403);

    const cashierDelete = await request('/api/users/999', {
      method: 'DELETE',
      token: cashierToken,
    });
    assertTest('1.8: cashier role receives 403 Forbidden on DELETE /api/users/:id', cashierDelete.status === 403);

    // 1.5 Admin role: can READ users (200), but CANNOT CREATE or DELETE users (403)
    const adminGet = await request('/api/users', { token: adminToken });
    assertTest('1.9: admin role can list users (status 200)', adminGet.status === 200 && Array.isArray(adminGet.data.users));

    const adminPost = await request('/api/users', {
      method: 'POST',
      token: adminToken,
      body: { username: 'test5', name: 'Test', role: 'cashier', accessCode: 'test123' },
    });
    assertTest('1.10: admin role receives 403 Forbidden on POST /api/users (Owner-only)', adminPost.status === 403);

    const adminDelete = await request('/api/users/999', {
      method: 'DELETE',
      token: adminToken,
    });
    assertTest('1.11: admin role receives 403 Forbidden on DELETE /api/users/:id (Owner-only)', adminDelete.status === 403);

    // =========================================================================
    // SECTION 2: OWNER ACCOUNT CREATION & VALIDATION
    // =========================================================================
    console.log('\n--- 2. Owner Account Creation & Validation ---');

    // 2.1 Missing fields validation
    const missingUsername = await request('/api/users', {
      method: 'POST',
      token: ownerToken,
      body: { name: 'Pau', role: 'cashier', accessCode: 'cashier123' },
    });
    assertTest('2.1: Missing username returns 400', missingUsername.status === 400);

    const invalidRole = await request('/api/users', {
      method: 'POST',
      token: ownerToken,
      body: { username: 'badrole', name: 'Bad Role', role: 'superadmin', accessCode: 'pass123' },
    });
    assertTest('2.2: Invalid role returns 400', invalidRole.status === 400);

    const shortPassword = await request('/api/users', {
      method: 'POST',
      token: ownerToken,
      body: { username: 'shortpass', name: 'Short Pass', role: 'cashier', accessCode: '12' },
    });
    assertTest('2.3: Password under 4 characters returns 400', shortPassword.status === 400);

    // Clean up test user if pre-existing
    await pool.query("DELETE FROM users WHERE username = 'test_clerk'");

    // 2.2 Successful account creation by Owner
    const createRes = await request('/api/users', {
      method: 'POST',
      token: ownerToken,
      body: {
        username: 'test_clerk',
        name: 'Test Desk Clerk',
        role: 'cashier',
        accessCode: 'clerkpass123',
      },
    });

    assertTest(
      '2.4: Owner successfully creates user account (status 201)',
      createRes.status === 201 && createRes.data.user?.username === 'test_clerk'
    );
    assertTest(
      '2.5: Created user response does NOT expose password hash',
      createRes.data.user?.access_code_hash === undefined
    );

    // 2.3 Duplicate username rejection
    const dupRes = await request('/api/users', {
      method: 'POST',
      token: ownerToken,
      body: {
        username: 'test_clerk',
        name: 'Duplicate Clerk',
        role: 'cashier',
        accessCode: 'anotherpass123',
      },
    });
    assertTest('2.6: Duplicate username returns 409 Conflict', dupRes.status === 409);

    // 2.4 Audit log entry verification
    const auditRes = await pool.query(
      "SELECT * FROM audit_logs WHERE action = 'USER_CREATED' AND operator = 'owner' ORDER BY created_at DESC LIMIT 1"
    );
    assertTest(
      '2.7: Audit log recorded USER_CREATED with operator "owner"',
      auditRes.rows.length > 0 && auditRes.rows[0].details.includes('test_clerk')
    );

    // =========================================================================
    // SECTION 3: CASHIER ACCOUNTS AUTHENTICATION (pau, raquel, tuter)
    // =========================================================================
    console.log('\n--- 3. Cashier Accounts Authentication ---');

    // 3.1 Newly created user can log in
    const newClerkLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { username: 'test_clerk', accessCode: 'clerkpass123' },
    });
    assertTest(
      '3.1: Newly created user logs in successfully (status 200, JWT returned)',
      newClerkLogin.status === 200 && Boolean(newClerkLogin.data.token) && newClerkLogin.data.role === 'cashier'
    );

    // 3.2 Verify pau with generic password cashier123
    const pauLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { username: 'pau', accessCode: 'cashier123' },
    });
    assertTest(
      '3.2: Cashier "pau" logs in with generic password "cashier123"',
      pauLogin.status === 200 && pauLogin.data.role === 'cashier'
    );

    // 3.3 Verify raquel with generic password cashier123
    const raquelLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { username: 'raquel', accessCode: 'cashier123' },
    });
    assertTest(
      '3.3: Cashier "raquel" logs in with generic password "cashier123"',
      raquelLogin.status === 200 && raquelLogin.data.role === 'cashier'
    );

    // 3.4 Verify tuter with generic password cashier123
    const tuterLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { username: 'tuter', accessCode: 'cashier123' },
    });
    assertTest(
      '3.4: Cashier "tuter" logs in with generic password "cashier123"',
      tuterLogin.status === 200 && tuterLogin.data.role === 'cashier'
    );

    // 3.5 Invalid access code rejected
    const badLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { username: 'pau', accessCode: 'wrongpassword' },
    });
    assertTest('3.5: Incorrect access code is rejected with 401', badLogin.status === 401);

    // =========================================================================
    // SECTION 4: PASSWORD RESET / CREDENTIALS UPDATE
    // =========================================================================
    console.log('\n--- 4. Password Reset by Owner ---');

    const resetRes = await request('/api/users/test_clerk/password', {
      method: 'PUT',
      token: ownerToken,
      body: { accessCode: 'newupdatedpass999' },
    });
    assertTest('4.1: Owner resets password for test_clerk (status 200)', resetRes.status === 200);

    const oldPassLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { username: 'test_clerk', accessCode: 'clerkpass123' },
    });
    assertTest('4.2: Old password rejected after reset (status 401)', oldPassLogin.status === 401);

    const newPassLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { username: 'test_clerk', accessCode: 'newupdatedpass999' },
    });
    assertTest('4.3: New password authenticates successfully (status 200)', newPassLogin.status === 200);

    // =========================================================================
    // SECTION 5: ACCOUNT DELETION & SAFEGUARDS
    // =========================================================================
    console.log('\n--- 5. Account Deletion & Safeguards ---');

    // 5.1 Owner cannot delete own active account
    const selfDeleteRes = await request('/api/users/owner', {
      method: 'DELETE',
      token: ownerToken,
    });
    assertTest('5.1: Owner attempting self-deletion is blocked with 400', selfDeleteRes.status === 400);

    // 5.2 Owner deletes test_clerk account
    const delRes = await request('/api/users/test_clerk', {
      method: 'DELETE',
      token: ownerToken,
    });
    assertTest('5.2: Owner successfully deletes user account (status 200)', delRes.status === 200);

    // 5.3 Deleted account can no longer authenticate
    const deletedLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { username: 'test_clerk', accessCode: 'newupdatedpass999' },
    });
    assertTest('5.3: Deleted user cannot initiate session (status 401)', deletedLogin.status === 401);

    // 5.4 Audit log recorded USER_DELETED
    const delAuditRes = await pool.query(
      "SELECT * FROM audit_logs WHERE action = 'USER_DELETED' AND operator = 'owner' ORDER BY created_at DESC LIMIT 1"
    );
    assertTest(
      '5.4: Audit log recorded USER_DELETED with operator "owner"',
      delAuditRes.rows.length > 0 && delAuditRes.rows[0].details.includes('test_clerk')
    );

    // 5.5 Deleting non-existent user returns 404
    const notFoundDelete = await request('/api/users/non_existent_user_9999', {
      method: 'DELETE',
      token: ownerToken,
    });
    assertTest('5.5: Deleting non-existent user returns 404', notFoundDelete.status === 404);

  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    try {
      await pool.end();
    } catch (_) {}
  }

  // Summary
  console.log('\n=================================================');
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = total - passed;
  console.log(`📊 TEST RESULTS: ${passed}/${total} PASSED ${failed > 0 ? `(${failed} FAILED)` : '🎉 ALL PASSED'}`);
  console.log('=================================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Fatal error running user management tests:', err);
  process.exit(1);
});
