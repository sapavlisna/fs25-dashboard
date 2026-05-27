#!/usr/bin/env node
// Write a mock scenario name to <DATA_DIR>/mock-scenario.txt so a running
// `npm run mock` switches to it within ~1 s (it polls that file).
//
// Usage: npm run mock:scenario -- <name>
//        node scripts/set-scenario.js vehicles-rich
const fs   = require('fs');
const path = require('path');
const config = require('../config');
const { listScenarios } = require('./mock-scenarios');

const name = process.argv[2];
if (!name) {
    console.error('Usage: npm run mock:scenario -- <name>');
    console.error('Available: ' + listScenarios().join(', '));
    process.exit(1);
}
if (!listScenarios().includes(name)) {
    console.error(`Unknown scenario "${name}". Available: ${listScenarios().join(', ')}`);
    process.exit(1);
}

const file = path.join(config.DATA_DIR, 'mock-scenario.txt');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, name, 'utf8');
console.log(`[mock:scenario] → ${name}  (${file})`);
console.log('Running `npm run mock` will pick this up within ~1 s.');
