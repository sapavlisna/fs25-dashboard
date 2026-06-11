#!/usr/bin/env node
// Simulates animal parameter changes in dashboard_data.json for UI flash testing.
// Each tick modifies food, straw, milk, manure, slurry, health, reproduction, and count.
//
// Usage:
//   node scripts/drain-food.js              → rate=2, interval=3s
//   node scripts/drain-food.js --rate=5     → faster drain/fill
//   node scripts/drain-food.js --interval=1 → every 1s

const fs   = require('fs');
const path = require('path');
const config = require('../config');

const FILE = config.DATA_FILE;

let rate     = 2;   // % per tick (inputs drain, outputs fill at this rate)
let interval = 3;   // seconds between ticks

for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--rate='))     rate     = parseFloat(arg.slice(7));
    if (arg.startsWith('--interval=')) interval = parseFloat(arg.slice(11));
}

console.log(`[drain-food] ${FILE}`);
console.log(`[drain-food] rate=${rate}% / ${interval}s  (Ctrl+C to stop)\n`);

let tickCount = 0;

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function tick() {
    tickCount++;
    let data;
    try {
        data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    } catch (e) {
        console.error('[drain-food] read error:', e.message);
        return;
    }

    if (!Array.isArray(data.animals)) {
        console.log('[drain-food] no animals array found');
        return;
    }

    console.log(`\n--- tick ${tickCount} ---`);
    data.animals.forEach(a => {
        // Inputs: drain (decrease toward 0)
        if (a.foodPercent != null) {
            a.foodPercent = clamp(+(a.foodPercent - rate).toFixed(1), 0, 100);
            a.foodLiters  = Math.round(a.foodCapacity * a.foodPercent / 100);
        }
        if (a.strawPercent != null) {
            a.strawPercent = clamp(+(a.strawPercent - rate * 0.7).toFixed(1), 0, 100);
            a.strawLiters  = Math.round(a.strawCapacity * a.strawPercent / 100);
        }
        if (a.waterPercent != null) {
            a.waterPercent = clamp(+(a.waterPercent - rate * 0.5).toFixed(1), 0, 100);
            if (a.waterLiters != null) a.waterLiters = Math.round(a.waterCapacity * a.waterPercent / 100);
        }

        // Outputs: fill (increase toward 100, then wrap to 0)
        if (a.milkPercent != null) {
            a.milkPercent = a.milkPercent >= 100 ? 0 : clamp(+(a.milkPercent + rate * 1.5).toFixed(1), 0, 100);
            a.milkLiters  = Math.round(a.milkCapacity * a.milkPercent / 100);
        }
        if (a.manurePercent != null) {
            a.manurePercent = a.manurePercent >= 100 ? 0 : clamp(+(a.manurePercent + rate).toFixed(1), 0, 100);
            a.manureLiters  = Math.round(a.manureCapacity * a.manurePercent / 100);
        }
        if (a.liquidManurePercent != null) {
            a.liquidManurePercent = a.liquidManurePercent >= 100 ? 0 : clamp(+(a.liquidManurePercent + rate * 0.8).toFixed(1), 0, 100);
            a.liquidManureLiters  = Math.round(a.liquidManureCapacity * a.liquidManurePercent / 100);
        }

        // Health: fluctuates (zigzag ±2 each tick, stays in 20–100 range)
        if (a.productivity != null) {
            const dir = (tickCount % 10 < 5) ? 1 : -1;
            a.productivity = clamp(a.productivity + dir * 2, 20, 100);
        }

        // Reproduction: increases toward 100, then wraps to 0
        if (a.reproductionPercent != null && a.reproductionStatus !== 'unsupported') {
            a.reproductionPercent = a.reproductionPercent >= 100 ? 0 : clamp(+(a.reproductionPercent + rate).toFixed(1), 0, 100);
        }

        // Count: every 20 ticks, +1 to husbandries with space; every 15 ticks -1 to random full ones
        if (tickCount % 20 === 0 && a.count > 0 && a.maxCount && a.count < a.maxCount) {
            a.count += 1;
        } else if (tickCount % 15 === 0 && a.count > 1 && Math.random() < 0.3) {
            a.count -= 1;
        }

        const parts = [];
        if (a.foodPercent    != null) parts.push(`K:${a.foodPercent}%`);
        if (a.strawPercent   != null) parts.push(`P:${a.strawPercent}%`);
        if (a.milkPercent    != null) parts.push(`M:${a.milkPercent}%`);
        if (a.manurePercent  != null) parts.push(`H:${a.manurePercent}%`);
        if (a.liquidManurePercent != null) parts.push(`Kj:${a.liquidManurePercent}%`);
        parts.push(`zdr:${a.productivity}%`);
        if (a.reproductionStatus !== 'unsupported') parts.push(`repro:${a.reproductionPercent}%`);
        parts.push(`ks:${a.count}`);
        console.log(`  ${(a.husbandryName ?? a.type).padEnd(35)} ${parts.join(' ')}`);
    });

    try {
        fs.writeFileSync(FILE, JSON.stringify(data), 'utf8');
    } catch (e) {
        console.error('[drain-food] write error:', e.message);
    }
}

tick();
setInterval(tick, interval * 1000);
