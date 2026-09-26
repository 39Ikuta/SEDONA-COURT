/**
 * server/tests/lan-cors-stations.test.ts
 * Verifies that the multi-station LAN IP addresses (192.168.0.103, 192.168.0.104, 192.168.0.105)
 * are properly recognized and authorized by isOriginAllowed.
 */

import { isOriginAllowed } from '../utils/cors';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`✅ PASSED: ${message}`);
}

console.log('\n🧪 Running LAN Multi-Station CORS Test Suite...\n');

// Station 103 (Main Server / Front Desk)
assert(isOriginAllowed('http://192.168.0.103:3000'), 'Station 103 frontend port 3000 allowed');
assert(isOriginAllowed('http://192.168.0.103:4000'), 'Station 103 backend port 4000 allowed');
assert(isOriginAllowed('http://192.168.0.103'), 'Station 103 standard port allowed');

// Station 104 (Cashier / Kitchen Terminal)
assert(isOriginAllowed('http://192.168.0.104:3000'), 'Station 104 frontend port 3000 allowed');
assert(isOriginAllowed('http://192.168.0.104:4000'), 'Station 104 backend port 4000 allowed');
assert(isOriginAllowed('http://192.168.0.104'), 'Station 104 standard port allowed');

// Station 105 (Lobby Display / Mobile Terminal)
assert(isOriginAllowed('http://192.168.0.105:3000'), 'Station 105 frontend port 3000 allowed');
assert(isOriginAllowed('http://192.168.0.105:4000'), 'Station 105 backend port 4000 allowed');
assert(isOriginAllowed('http://192.168.0.105'), 'Station 105 standard port allowed');

// General loopback and edge cases
assert(isOriginAllowed('http://localhost:3000'), 'localhost:3000 allowed');
assert(isOriginAllowed('http://127.0.0.1:3000'), '127.0.0.1:3000 allowed');
assert(isOriginAllowed(undefined), 'undefined origin (curl/mobile/electron) allowed');
assert(isOriginAllowed(''), 'empty origin allowed');

// Malicious public web origin
assert(!isOriginAllowed('http://malicious-external-site.com'), 'malicious external site rejected');

console.log('\n🎉 All LAN Multi-Station CORS checks passed!\n');
