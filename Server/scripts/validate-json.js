#!/usr/bin/env node
// Validates dashboard_data.json – run with: npm run validate
// Exit 0 = OK, exit 1 = errors found

const fs   = require('fs');
const config = require('../config');

const DATA_FILE = process.argv[2] || config.DATA_FILE;

console.log('Validating:', DATA_FILE, '\n');

// ─── Read & parse ─────────────────────────────────────────────────────────────

let raw;
try { raw = fs.readFileSync(DATA_FILE, 'utf8'); }
catch (e) { die('Cannot read file: ' + e.message); }

let d;
try { d = JSON.parse(raw); }
catch (e) { die('Invalid JSON: ' + e.message); }

// ─── Checks ───────────────────────────────────────────────────────────────────

const errors = [], warnings = [];
const err  = (msg) => errors.push('  ✗ ' + msg);
const warn = (msg) => warnings.push('  ⚠ ' + msg);
const need = (cond, msg) => { if (!cond) err(msg); };
const inRange = (v, lo, hi, name) => {
    if (v == null)       err(`${name} is null/missing`);
    else if (v < lo || v > hi) err(`${name} = ${v} is outside [${lo}, ${hi}]`);
};

// Top-level
if (d.schemaVersion == null)             warn('schemaVersion missing – mod predates 1.1.0.0');
else need(typeof d.schemaVersion === 'number', 'schemaVersion must be a number');
if (d.modVersion == null)                warn('modVersion missing – mod predates 1.1.0.0');
else need(typeof d.modVersion === 'string',    'modVersion must be a string');
need(typeof d.exportedAt === 'string',   'exportedAt must be a string');
need(typeof d.gameDay    === 'number',   'gameDay must be a number');
need(typeof d.farmBalance === 'number',  'farmBalance must be a number');
need(Array.isArray(d.fields),            'fields must be an array');
need(Array.isArray(d.storage),           'storage must be an array');
need(Array.isArray(d.prices),            'prices must be an array');
need(Array.isArray(d.animals),           'animals must be an array');
need(Array.isArray(d.vehicles),          'vehicles must be an array');
if (d.events !== undefined) need(Array.isArray(d.events), 'events must be an array (or absent)');

if (d.vehicles && d.vehicles.length === 0) warn('vehicles array is empty – is the mod loaded in a savegame with vehicles?');
if (d.animals  && d.animals.length  === 0) warn('animals array is empty – is the husbandrySystem accessible?');
if (d.fields   && d.fields.length   === 0) warn('fields array is empty – is g_fieldManager accessible?');

// Fields
for (const [i, f] of (d.fields || []).entries()) {
    need(typeof f.id === 'number',        `fields[${i}].id must be a number`);
    need(typeof f.owned === 'boolean',    `fields[${i}].owned must be boolean`);
    inRange(f.growthPercent, 0, 100,      `fields[${i}].growthPercent`);
    inRange(f.growthState, 0, 20,         `fields[${i}].growthState`);
}

// Vehicles
for (const [i, v] of (d.vehicles || []).entries()) {
    need(v.name && v.name.length > 0,     `vehicles[${i}].name must not be empty`);
    need(v.fuelCapacity > 0,              `vehicles[${i}].fuelCapacity must be > 0`);
    inRange(v.fuelPercent, 0, 100,        `vehicles[${i}].fuelPercent`);
    if (v.adBlueCapacity != null) {
        inRange(v.adBluePercent, 0, 100,  `vehicles[${i}].adBluePercent`);
    }
}

// Animals
for (const [i, a] of (d.animals || []).entries()) {
    inRange(a.foodPercent,  0, 100,       `animals[${i}].foodPercent`);
    inRange(a.waterPercent, 0, 100,       `animals[${i}].waterPercent`);
    inRange(a.productivity, 0, 100,       `animals[${i}].productivity`);
    need(a.count >= 0,                    `animals[${i}].count must be >= 0`);
}

// Storage
for (const [i, s] of (d.storage || []).entries()) {
    for (const [j, item] of (s.items || []).entries()) {
        need(item.amount >= 0,            `storage[${i}].items[${j}].amount must be >= 0`);
        need(item.capacity >= 0,          `storage[${i}].items[${j}].capacity must be >= 0`);
    }
}

// Prices
for (const [i, sp] of (d.prices || []).entries()) {
    need(sp.sellPoint && sp.sellPoint.length > 0, `prices[${i}].sellPoint must not be empty`);
    for (const [j, item] of (sp.items || []).entries()) {
        need(item.pricePerTon >= 0,       `prices[${i}].items[${j}].pricePerTon must be >= 0`);
    }
}

// ─── Report ───────────────────────────────────────────────────────────────────

const counts = {
    fields:   (d.fields   || []).length,
    owned:    (d.fields   || []).filter(f => f.owned).length,
    vehicles: (d.vehicles || []).length,
    animals:  (d.animals  || []).length,
    storage:  (d.storage  || []).length,
    prices:   (d.prices   || []).reduce((n, sp) => n + (sp.items || []).length, 0),
};

console.log(`  Game day ${d.gameDay}, time ${d.gameTime}, balance ${(d.farmBalance || 0).toLocaleString()} Kč`);
console.log(`  Fields: ${counts.fields} total, ${counts.owned} owned`);
console.log(`  Vehicles: ${counts.vehicles}, Animals: ${counts.animals}`);
console.log(`  Storage entries: ${counts.storage}, Price entries: ${counts.prices}`);
console.log(`  Exported at: ${d.exportedAt}\n`);

if (warnings.length > 0) { console.log('Warnings:'); warnings.forEach(w => console.log(w)); console.log(); }

if (errors.length === 0) {
    console.log('✓ All checks passed');
    process.exit(0);
} else {
    console.log(`Errors (${errors.length}):`);
    errors.forEach(e => console.log(e));
    process.exit(1);
}

function die(msg) { console.error('FATAL:', msg); process.exit(1); }
