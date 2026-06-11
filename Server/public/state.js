// state.js — typed wrapper around localStorage for dashboard preferences.
// All keys live under the namespace `fs25.dash.v1.` so future migrations
// can be done by walking the namespace.

(function () {
    const NS = 'fs25.dash.v1.';

    function get(key, fallback) {
        try {
            const raw = localStorage.getItem(NS + key);
            if (raw == null) return fallback;
            return JSON.parse(raw);
        } catch (_) {
            return fallback;
        }
    }

    function set(key, value) {
        try { localStorage.setItem(NS + key, JSON.stringify(value)); } catch (_) {}
        // Mirror the write to the server so other devices pick it up.
        // ServerSync swallows local-only keys and respects the user's
        // "sync off" toggle, so we don't need any check here.
        if (window.ServerSync) window.ServerSync.syncWrite(key, value);
    }

    function setHas(key, item) {
        const list = get(key, []);
        return Array.isArray(list) && list.indexOf(item) >= 0;
    }

    function setToggle(key, item) {
        const list = get(key, []);
        const arr = Array.isArray(list) ? list.slice() : [];
        const i = arr.indexOf(item);
        if (i >= 0) arr.splice(i, 1); else arr.push(item);
        set(key, arr);
        return i < 0;  // returns "is now in set"
    }

    window.DashState = {
        get, set, setHas, setToggle,
        KEYS: {
            theme:                  'theme',
            hiddenVehicles:         'hiddenVehicles',
            hiddenStorages:         'hiddenStorages',
            hiddenProductions:      'hiddenProductions',
            emptyAnimalsCollapsed:  'emptyAnimalsCollapsed',
            collapsedGroups:        'collapsedGroups',
            flashEnabled:           'flashEnabled',
            hiddenSections:         'hiddenSections',
            vehiclesExpanded:       'vehiclesExpanded',

            // ── Vehicles (per-section) ─────────────────────────────────────
            vehicleShowEngineHours:   'vehicleShowEngineHours',   // bool, default true
            vehicleShowWorkerBadge:   'vehicleShowWorkerBadge',   // bool, default true
            vehicleShowWorkerETA:     'vehicleShowWorkerETA',     // bool, default true
            vehicleImplHideCrops:     'vehicleImplHideCrops',     // bool, default false
            vehicleImplHideLiquids:   'vehicleImplHideLiquids',   // bool, default false
            vehicleImplHideSolids:    'vehicleImplHideSolids',    // bool, default false
            vehicleImplHideBiomasa:   'vehicleImplHideBiomasa',   // bool, default false
            vehiclesActiveOnly:       'vehiclesActiveOnly',       // bool, default false — show only in-use vehicles

            // ── Fields ────────────────────────────────────────────────────
            fieldsOwnedOnly:          'fieldsOwnedOnly',           // bool, default true
            fieldsShowDays:           'fieldsShowDays',            // bool, default true
            fieldsShowChips:          'fieldsShowChips',           // bool, default true
            fieldsHideEmpty:          'fieldsHideEmpty',           // bool, default false — hide fields with no crop
            fieldsHideStubble:        'fieldsHideStubble',         // bool, default false — hide cut/withered/stubble
            fieldsColSpray:           'fieldsColSpray',            // bool, default false — hnojení sloupec (0–2)
            fieldsColPlow:            'fieldsColPlow',             // bool, default false
            fieldsColLime:            'fieldsColLime',             // bool, default false
            fieldsColWeed:            'fieldsColWeed',             // bool, default false
            fieldsColStone:           'fieldsColStone',            // bool, default false

            // ── Animals ───────────────────────────────────────────────────
            animalsExpanded:          'animalsExpanded',           // bool, default false
            animalsShowAlarm:         'animalsShowAlarm',          // bool, default true
            animalsShowReproduction:  'animalsShowReproduction',   // bool, default true
            animalsShowFood:          'animalsShowFood',           // bool, default true
            animalsShowWater:         'animalsShowWater',          // bool, default true
            animalsShowBedding:       'animalsShowBedding',        // bool, default true
            animalsShowMilk:          'animalsShowMilk',           // bool, default true
            animalsShowManure:        'animalsShowManure',         // bool, default true
            animalsShowSlurry:        'animalsShowSlurry',         // bool, default true
            animalsShowWool:          'animalsShowWool',           // bool, default true
            animalsAlarmInput:        'animalsAlarmInput',         // number %, default 25 — low-input alarm threshold
            animalsAlarmOutput:       'animalsAlarmOutput',        // number %, default 90 — full-output alarm threshold

            // ── Storage ───────────────────────────────────────────────────
            storageExpanded:          'storageExpanded',           // bool, default false
            storageDefaultCollapsed:  'storageDefaultCollapsed',   // bool, default true
            storageHideEmpty:         'storageHideEmpty',          // bool, default false
            storageShowCapacity:      'storageShowCapacity',       // bool, default true
            storageShowPercent:       'storageShowPercent',        // bool, default true
            storageShowBar:           'storageShowBar',            // bool, default true

            // ── Productions ───────────────────────────────────────────────
            productionsExpanded:         'productionsExpanded',        // bool, default false
            productionsActiveOnly:        'productionsActiveOnly',      // bool, default false
            productionsDefaultCollapsed:  'productionsDefaultCollapsed',// bool, default true
            productionsShowRecipes:       'productionsShowRecipes',     // bool, default true
            productionsShowInputs:        'productionsShowInputs',      // bool, default true
            productionShowCycles:         'productionShowCycles',       // bool, default true

            // ── Prices ────────────────────────────────────────────────────
            pricesOwnedOnly:          'pricesOwnedOnly',           // bool, default false
            pricesShowStock:          'pricesShowStock',           // bool, default true
        },
    };
})();
