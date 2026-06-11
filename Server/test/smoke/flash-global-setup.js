// Global setup for animal-flash tests: creates the sandbox dir and writes
// a minimal initial dashboard_data.json so the server has something to serve.
const fs   = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
const SANDBOX   = path.join(REPO_ROOT, '.tmp', 'flash-test');
const MOCK_FILE = path.join(SANDBOX, 'dashboard_data.json');
const DATA_DIR  = path.join(SANDBOX, 'data');

module.exports = async () => {
    fs.rmSync(SANDBOX, { recursive: true, force: true });
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(MOCK_FILE, JSON.stringify(buildBaseData(50)), 'utf8');
    // expose path so tests can write to it
    process.env.__FLASH_MOCK_FILE = MOCK_FILE;
};

function buildBaseData(pct) {
    return {
        modVersion: '0.0.0',
        schemaVersion: 1,
        farmBalance: 100000,
        gameSettings: {},
        availableFruits: [],
        fields: [],
        vehicles: [],
        storage: [],
        productions: [],
        prices: [],
        animals: [buildKravin(pct)],
    };
}

function buildKravin(pct, overrides = {}) {
    const base = {
        type: 'COW',
        husbandryName: 'Kravín (farma)',
        count: 5,
        maxCount: 20,
        productivity: pct,
        reproductionPercent: pct,
        reproductionStatus: 'cycling',
        foodPercent: pct,  foodLiters: pct * 20,  foodCapacity: 2000,
        strawPercent: pct, strawLiters: pct * 10,  strawCapacity: 1000,
        milkPercent: pct,  milkLiters: pct * 10,   milkCapacity: 1000,
        manurePercent: pct, manureLiters: pct * 15, manureCapacity: 1500,
        liquidManurePercent: pct, liquidManureLiters: pct * 12, liquidManureCapacity: 1200,
        clusters: [{
            subType: 'COW', count: 5, age: 30, health: pct,
            reproduction: pct, sellPrice: 1500, minAgeMonth: 18,
            canReproduce: true, reproStatus: 'cycling', reproFactor: 1,
        }],
    };
    return Object.assign(base, overrides);
}

module.exports.buildBaseData = buildBaseData;
module.exports.buildKravin   = buildKravin;
module.exports.MOCK_FILE     = MOCK_FILE;
