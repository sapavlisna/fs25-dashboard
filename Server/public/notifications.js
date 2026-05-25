// Browser notifications for FS25 Dashboard.
// Hook into WebSocket data via window.Notifier.process(data) called by each page.
// Stores thresholds + dismissal state in localStorage.

(function () {
    const DEFAULTS = {
        animalFood:    25,   // notify if foodPercent < this
        vehicleFuel:   20,   // notify if fuelPercent < this
        emptyFieldDays: 5,   // notify if owned field empty for >= this many days
        cooldownMinutes: 60, // re-alert at most once per N minutes per condition
        enabled: false,      // global on/off
    };

    const KEY = 'fs25_notif_settings';
    const COOLDOWN_KEY = 'fs25_notif_cooldown';

    // ─── Settings ────────────────────────────────────────────────────────────

    function getSettings() {
        try {
            return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) || '{}')) };
        } catch { return { ...DEFAULTS }; }
    }
    function saveSettings(s) {
        localStorage.setItem(KEY, JSON.stringify(s));
    }

    // ─── Cooldown tracker ────────────────────────────────────────────────────

    function getCooldowns() {
        try { return JSON.parse(localStorage.getItem(COOLDOWN_KEY) || '{}'); }
        catch { return {}; }
    }
    function setCooldown(key) {
        const c = getCooldowns();
        c[key] = Date.now();
        localStorage.setItem(COOLDOWN_KEY, JSON.stringify(c));
    }
    function isOnCooldown(key, cooldownMs) {
        const c = getCooldowns();
        return c[key] && (Date.now() - c[key]) < cooldownMs;
    }

    // Track empty fields over time so we can trigger after N game days
    const emptyFieldSince = {}; // fieldId → first gameDay seen empty

    // ─── Permission ──────────────────────────────────────────────────────────

    async function requestPermission() {
        if (!('Notification' in window)) {
            alert('Tento prohlížeč nepodporuje notifikace.');
            return false;
        }
        if (Notification.permission === 'granted') return true;
        if (Notification.permission === 'denied') {
            alert('Notifikace zablokovány. Povol je v nastavení prohlížeče (zámeček vedle URL).');
            return false;
        }
        const result = await Notification.requestPermission();
        return result === 'granted';
    }

    // ─── Fire notification ───────────────────────────────────────────────────

    function notify(key, title, body, icon) {
        const s = getSettings();
        if (!s.enabled) return;
        if (Notification.permission !== 'granted') return;
        if (isOnCooldown(key, s.cooldownMinutes * 60 * 1000)) return;

        try {
            new Notification(title, {
                body,
                icon: icon || '/favicon.ico',
                tag: key,        // tag = replace previous notif with same tag
                requireInteraction: false,
            });
            setCooldown(key);
        } catch (e) {
            console.warn('Notify error:', e);
        }
    }

    // ─── Process data (called by pages on WS message) ────────────────────────

    function process(data) {
        const s = getSettings();
        if (!s.enabled || Notification.permission !== 'granted') return;

        const gameDay = data.gameDay || 0;

        // Skip items the user has hidden in their respective tables.
        // Vehicles use DashState (drag-and-drop zone); animals/fields use TableTools.
        const tt = window.TableTools;
        const ds = window.DashState;
        // Prefer TT which unions new (hidden:vehicles) + legacy (hiddenVehicles)
        // keys; DashState only sees the legacy key and may miss recently-hidden items.
        const hiddenVehicles = tt
            ? tt.getHidden('vehicles')
            : (ds ? new Set((ds.get(ds.KEYS.hiddenVehicles, []) || []).map(String)) : new Set());
        const hiddenAnimals  = tt ? tt.getHidden('animals') : new Set();
        const hiddenFields   = tt ? tt.getHidden('fields')  : new Set();

        // Animals: low food. Skip empty pens (count == 0) — Lua reports
        // foodPercent: 0 for empty husbandries, which would otherwise spam
        // notifications for every uninhabited pen the player owns.
        for (const a of (data.animals || [])) {
            if (!(a.count > 0)) continue;
            if (hiddenAnimals.has(String(a.husbandryName))) continue;
            if (a.foodPercent != null && a.foodPercent < s.animalFood) {
                notify(
                    'animal_food_' + a.husbandryName,
                    `🌾 ${a.husbandryName} – krmivo dochází`,
                    `Krmivo na ${a.foodPercent} %. Dej krmivo, nebo budou produktivitní ztráty.`,
                );
            }
        }

        // Vehicles: low fuel.
        for (const v of (data.vehicles || [])) {
            if (hiddenVehicles.has(String(v.name))) continue;
            if (v.fuelPercent != null && v.fuelPercent < s.vehicleFuel) {
                notify(
                    'vehicle_fuel_' + v.name,
                    `⛽ ${v.name} – málo paliva`,
                    `Nádrž na ${v.fuelPercent} % (${v.fuelLiters}/${v.fuelCapacity} l).`,
                );
            }
        }

        // Fields: ready to harvest
        for (const f of (data.fields || [])) {
            if (hiddenFields.has(String(f.id))) continue;
            if (f.owned && f.isReadyToHarvest) {
                notify(
                    'field_ready_' + f.id,
                    `🌾 Pole ${f.id} – ${f.fruitName}`,
                    `Připraveno ke sklizni (${f.area} ha).`,
                );
            }
        }

        // Fields: empty too long
        for (const f of (data.fields || [])) {
            if (hiddenFields.has(String(f.id))) continue;
            if (f.owned && f.needsSowing) {
                if (emptyFieldSince[f.id] == null) emptyFieldSince[f.id] = gameDay;
                const daysEmpty = gameDay - emptyFieldSince[f.id];
                if (daysEmpty >= s.emptyFieldDays) {
                    notify(
                        'field_empty_' + f.id,
                        `🚜 Pole ${f.id} – čeká na osetí`,
                        `Pole je prázdné ${daysEmpty} dní (${f.area} ha).`,
                    );
                }
            } else {
                delete emptyFieldSince[f.id];
            }
        }
    }

    // ─── Public API ──────────────────────────────────────────────────────────

    window.Notifier = {
        getSettings,
        saveSettings,
        requestPermission,
        process,
        DEFAULTS,
    };
})();
