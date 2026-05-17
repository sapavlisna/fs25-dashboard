// Test 2.9: server should survive a malformed JSON write
// Test 2.10: multiple WebSocket clients each receive updates

const WS = require('ws');
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(
    process.env.USERPROFILE || process.env.HOME,
    'Documents', 'My Games', 'FarmingSimulator2025', 'dashboard_data.json'
);

// Save current valid JSON so we can restore it
const original = fs.readFileSync(DATA_FILE, 'utf8');

async function testInvalidJson() {
    console.log('Test 2.9: Server survives invalid JSON');

    fs.writeFileSync(DATA_FILE, '{ this is not valid json }}}');
    await new Promise(r => setTimeout(r, 500));

    // Server should still respond on /api/current with 503 (file unreadable)
    // and not have crashed.
    const fetch = (await import('node:http')).default
        ? require('node:http')
        : require('http');
    const http = require('http');

    return new Promise((resolve, reject) => {
        const req = http.get('http://localhost:3000/api/current', res => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                const body = Buffer.concat(chunks).toString();
                // 503 with error body is correct behaviour
                if (res.statusCode === 503) {
                    console.log('  ✓ /api/current returns 503 (server alive)');
                    resolve();
                } else {
                    console.log(`  status=${res.statusCode}, body=${body.slice(0, 80)}`);
                    resolve();
                }
            });
        });
        req.on('error', e => { console.log('  ✗ Server crashed:', e.message); reject(e); });
    });
}

async function testMultipleClients() {
    console.log('\nTest 2.10: Multiple WebSocket clients');

    // Restore valid JSON first
    fs.writeFileSync(DATA_FILE, original);
    await new Promise(r => setTimeout(r, 500));

    const clients = [];
    const counts = [0, 0, 0];

    for (let i = 0; i < 3; i++) {
        const ws = new WS('ws://localhost:3000');
        ws.on('message', () => counts[i]++);
        clients.push(ws);
        await new Promise(r => ws.on('open', r));
    }
    console.log(`  ${clients.length} clients connected`);

    // Wait for at least 2 broadcast cycles (mock writes every 5s)
    await new Promise(r => setTimeout(r, 12000));

    console.log(`  Messages received: client1=${counts[0]}, client2=${counts[1]}, client3=${counts[2]}`);

    if (counts.every(c => c >= 2)) {
        console.log('  ✓ All clients received multiple broadcasts');
    } else {
        console.log('  ✗ At least one client received < 2 messages');
    }

    clients.forEach(c => c.close());
}

async function main() {
    try {
        await testInvalidJson();
        await testMultipleClients();
    } finally {
        // Restore
        fs.writeFileSync(DATA_FILE, original);
        console.log('\nDone. Original JSON restored.');
        process.exit(0);
    }
}

main();
