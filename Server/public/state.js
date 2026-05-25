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
            hiddenVehicles:         'hiddenVehicles',          // array of vehicle.name (or stable id)
            hiddenStorages:         'hiddenStorages',          // array of `${type}:${storageName}` keys
            hiddenProductions:      'hiddenProductions',       // array of production name keys
            emptyAnimalsCollapsed:  'emptyAnimalsCollapsed',   // bool, default true
            collapsedGroups:        'collapsedGroups',         // array of group keys (silo/sell)
            flashEnabled:           'flashEnabled',            // map<sectionKey, bool> — change-flash on/off per section
            hiddenSections:         'hiddenSections',          // array of section element ids (e.g. ['sec-storage']) — hidden on main dashboard
            vehiclesExpanded:       'vehiclesExpanded',        // bool, default false — show implements sub-rows + 2-column layout for vehicles section
        },
    };
})();
