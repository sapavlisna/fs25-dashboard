// Restores what the mod deliberately leaves out of the 2 s payload.
//
// The mod pays game frame time to encode every byte it writes, so two kinds of
// data were taken off the hot path:
//
//   1. Field records omit keys whose value equals the default. Measured on a
//      live 179-field payload that was 49 013 B of 146 KB — 34 % of the whole
//      file spent restating false/0/"".
//   2. Session-static sections (fruit catalog, price-forecast curve) go to
//      dashboard_static.json once per save instead of riding every export —
//      another 27.4 %. Same pattern as dashboard_map_geometry.json.
//
// Both are undone here, so the shape reaching the frontend is unchanged and no
// page or test needs to know about the split.
//
// Shared with scripts/validate-json.js, which validates the mod's raw file and
// must apply the same defaults before checking ranges.

// Keys the mod strips when they hold exactly these values. Must stay in sync
// with FIELD_DEFAULTS in FS25/DashboardExport.lua.
const FIELD_DEFAULTS = Object.freeze({
    fruitTypeId:        '',
    fruitName:          '',
    growthState:        0,
    maxGrowthState:     0,
    growthPercent:      0,
    isReadyToHarvest:   false,
    isCut:              false,
    isWithered:         false,
    daysToHarvest:      0,
    needsSowing:        false,
    plannedFruit:       '',
    needsPlowing:       false,
    needsCultivating:   false,
    needsLime:          false,
    fertilizationLevel: 0,
    weedLevel:          0,
    stoneLevel:         0,
    owned:              false,
    farmlandPrice:      0,
    // Deliberately NOT isParcelOnly: the mod only ever sets it (to true) on
    // parcel-only records and omits it elsewhere, so a `false` never occurs.
    // Listing it here would save no bytes and would add the key to records that
    // never carried it.
});

const FIELD_DEFAULT_ENTRIES = Object.entries(FIELD_DEFAULTS);

// Fill in absent keys only. An explicit value always wins — including one that
// happens to equal the default.
function applyFieldDefaults(field) {
    if (!field || typeof field !== 'object') return field;
    for (const [key, value] of FIELD_DEFAULT_ENTRIES) {
        if (field[key] === undefined) field[key] = value;
    }
    return field;
}

// Merge the static sections back in. `statics` is the parsed
// dashboard_static.json (or null before the mod has written it).
//
// Absent-only, never overwrite: during the first seconds of a session the mod
// still carries both sections inline, and mock scenarios send their own — one
// of them sets `priceForecast: null` on purpose to exercise the empty state, so
// a null must survive untouched.
function applyStaticSections(data, statics) {
    if (!data || typeof data !== 'object' || !statics) return data;

    if (data.availableFruits === undefined && Array.isArray(statics.availableFruits)) {
        data.availableFruits = statics.availableFruits;
    }
    if (data.priceForecast && typeof data.priceForecast === 'object'
        && data.priceForecast.fillTypes === undefined
        && Array.isArray(statics.priceForecastFillTypes)) {
        data.priceForecast.fillTypes = statics.priceForecastFillTypes;
    }
    return data;
}

// Both restorations for a whole payload, in place.
function restorePayloadShape(data, statics) {
    if (!data || typeof data !== 'object') return data;
    if (Array.isArray(data.fields)) {
        for (const f of data.fields) applyFieldDefaults(f);
    }
    return applyStaticSections(data, statics);
}

module.exports = {
    FIELD_DEFAULTS,
    applyFieldDefaults,
    applyStaticSections,
    restorePayloadShape,
};
