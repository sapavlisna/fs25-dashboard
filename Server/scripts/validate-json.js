#!/usr/bin/env node
// Validates dashboard_data.json – run with: npm run validate
// Exit 0 = OK, exit 1 = errors found

const fs   = require('fs');
const path = require('path');
const config = require('../config');
const payloadShape = require('../payloadShape');

const DATA_FILE = process.argv[2] || config.DATA_FILE;

console.log('Validating:', DATA_FILE, '\n');

// ─── Read & parse ─────────────────────────────────────────────────────────────

let raw;
try { raw = fs.readFileSync(DATA_FILE, 'utf8'); }
catch (e) { die('Cannot read file: ' + e.message); }

let d;
try { d = JSON.parse(raw); }
catch (e) { die('Invalid JSON: ' + e.message); }

// This reads the mod's raw file, upstream of the server's enrich(). The mod
// omits defaulted field keys and keeps the session-static sections in
// dashboard_static.json, so restore both before checking — otherwise every
// stripped `owned`/`growthState` would read as missing. See payloadShape.js.
let statics = null;
try {
    statics = JSON.parse(
        fs.readFileSync(path.join(path.dirname(DATA_FILE), 'dashboard_static.json'), 'utf8'));
} catch (_) { /* absent before the mod's first export — sections ride inline then */ }
payloadShape.restorePayloadShape(d, statics);

// ─── Checks ───────────────────────────────────────────────────────────────────

const errors = [], warnings = [];
const err  = (msg) => errors.push('  ✗ ' + msg);
const warn = (msg) => warnings.push('  ⚠ ' + msg);
const need = (cond, msg) => { if (!cond) err(msg); };
const inRange = (v, lo, hi, name) => {
    if (v == null)       err(`${name} is null/missing`);
    else if (v < lo || v > hi) err(`${name} = ${v} is outside [${lo}, ${hi}]`);
};
// Like inRange but tolerates an absent value — for fields the mod legitimately
// omits (e.g. waterPercent on auto-water husbandry such as pigs/chickens).
const inRangeOpt = (v, lo, hi, name) => { if (v != null) inRange(v, lo, hi, name); };

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
if (d.pf != null) need(typeof d.pf.active === 'boolean', 'pf.active must be boolean');
// Live Map — optional, only present once the mod ships position export.
if (d.mapSize != null) need(d.mapSize > 0, 'mapSize must be > 0');
if (d.player != null) {
    need(typeof d.player.x === 'number', 'player.x must be a number');
    need(typeof d.player.z === 'number', 'player.z must be a number');
    inRangeOpt(d.player.headingDeg, -1, 361, 'player.headingDeg');
}

if (d.vehicles && d.vehicles.length === 0) warn('vehicles array is empty – is the mod loaded in a savegame with vehicles?');
if (d.animals  && d.animals.length  === 0) warn('animals array is empty – is the husbandrySystem accessible?');
if (d.fields   && d.fields.length   === 0) warn('fields array is empty – is g_fieldManager accessible?');

// Fields
for (const [i, f] of (d.fields || []).entries()) {
    need(typeof f.id === 'number',        `fields[${i}].id must be a number`);
    need(typeof f.owned === 'boolean',    `fields[${i}].owned must be boolean`);
    inRange(f.growthPercent, 0, 100,      `fields[${i}].growthPercent`);
    inRange(f.growthState, 0, 20,         `fields[${i}].growthState`);
    // Live Map — optional, only present once the mod ships position export.
    if (f.posX != null || f.posZ != null) {
        need(typeof f.posX === 'number', `fields[${i}].posX must be a number`);
        need(typeof f.posZ === 'number', `fields[${i}].posZ must be a number`);
    }
    // Live Map field outline — optional boundary polygon [[x,z],…].
    if (f.poly != null) {
        need(Array.isArray(f.poly) && f.poly.length >= 3, `fields[${i}].poly must be an array of ≥3 points`);
        if (Array.isArray(f.poly)) need(f.poly.every(p => Array.isArray(p) && p.length === 2
            && typeof p[0] === 'number' && typeof p[1] === 'number'), `fields[${i}].poly points must be [x,z] number pairs`);
    }
    // Precision Farming — optional, per-field; only checked when present.
    if (f.pf) {
        inRangeOpt(f.pf.sampled,        0, 2,     `fields[${i}].pf.sampled`);
        inRangeOpt(f.pf.nitrogenActual, 0, 400,   `fields[${i}].pf.nitrogenActual`);
        inRangeOpt(f.pf.nitrogenTarget, 0, 400,   `fields[${i}].pf.nitrogenTarget`);
        inRangeOpt(f.pf.phActual,       3, 9,     `fields[${i}].pf.phActual`);
        inRangeOpt(f.pf.phTarget,       3, 9,     `fields[${i}].pf.phTarget`);
        inRangeOpt(f.pf.yieldPotential, 0.4, 1.6, `fields[${i}].pf.yieldPotential`);
    }
}

// Vehicles
for (const [i, v] of (d.vehicles || []).entries()) {
    need(v.name && v.name.length > 0,     `vehicles[${i}].name must not be empty`);
    need(typeof v.fuelCapacity === 'number' && v.fuelCapacity >= 0,
         `vehicles[${i}].fuelCapacity must be a number >= 0 (0 = no fuel tank, e.g. trailer/cart)`);
    inRange(v.fuelPercent, 0, 100,        `vehicles[${i}].fuelPercent`);
    if (v.adBlueCapacity != null) {
        inRange(v.adBluePercent, 0, 100,  `vehicles[${i}].adBluePercent`);
    }
    // Live Map — optional, only present once the mod ships position export.
    if (v.x != null || v.z != null) {
        need(typeof v.x === 'number',     `vehicles[${i}].x must be a number`);
        need(typeof v.z === 'number',     `vehicles[${i}].z must be a number`);
        inRangeOpt(v.headingDeg, -1, 361, `vehicles[${i}].headingDeg`);
    }
}

// Animals
for (const [i, a] of (d.animals || []).entries()) {
    inRange(a.foodPercent,  0, 100,       `animals[${i}].foodPercent`);
    inRangeOpt(a.waterPercent, 0, 100,    `animals[${i}].waterPercent`);
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
