// Test 2.5: WebSocket push test
// Connects to local server, expects at least 3 messages within 15s.
const WS = require('ws');
const ws = new WS('ws://localhost:3000');

let count = 0;

ws.on('open',  () => console.log('CONNECTED'));
ws.on('error', e => { console.error('ERROR:', e.message); process.exit(1); });

ws.on('message', raw => {
    count++;
    try {
        const d = JSON.parse(raw);
        console.log(`MSG ${count}: gameDay=${d.gameDay}, vehicles=${d.vehicles.length}, fuel[0]=${d.vehicles[0].fuelPercent}%`);
    } catch (e) {
        console.log(`MSG ${count}: parse error: ${e.message}`);
    }
    if (count >= 3) {
        console.log('OK: received ' + count + ' messages');
        ws.close();
        process.exit(0);
    }
});

setTimeout(() => {
    console.error('TIMEOUT - received only ' + count + ' messages');
    process.exit(1);
}, 15000);
