// Crop icon helper. Returns an HTML <span> with an SVG icon (or fallback) and
// resolves a colour for any crop the loaded map supports.
//
// We have hand-drawn SVGs for the nine vanilla FS25 crops below; modded maps
// (Hof Bergmann etc.) often add more. For unknown crops we fall back to a
// deterministic HSL colour derived from the crop's stable name and a generic
// 🌱 emoji, so the dashboard never shows blank cells.
//
// The mod sends `availableFruits` in every WS payload. app.js calls
// CropIcons.setCatalog(d.availableFruits) once per update so we know about
// every crop on this map even before the player owns one.

(function () {
    // SVG icons that exist on disk under /icons/
    const ICON_MAP = {
        WHEAT:     'wheat',
        BARLEY:    'barley',
        CANOLA:    'canola',
        MAIZE:     'maize',
        SUNFLOWER: 'sunflower',
        SOYBEAN:   'soybean',
        SUGARBEET: 'sugarbeet',
        POTATO:    'potato',
        GRASS:     'grass',
        // Common synonyms — re-use the closest-matching icon.
        OAT:           'wheat',
        RYE:           'wheat',
        OILSEEDRADISH: 'canola',
        COTTON:        'wheat',
        RICE:          'wheat',
        SORGHUM:       'wheat',
        SPELT:         'wheat',
        SUGARCANE:     'grass',
        OLIVE:         'sunflower',
        GRAPE:         'grass',
        POPLAR:        'grass',
        // Hof Bergmann / EU-map additions
        CLOVER:        'grass',
        ALFALFA:       'grass',
        HAY:           'grass',
        SILAGE:        'grass',
        STRAW:         'wheat',
    };

    // Hand-tuned colours for the icons we have. Unknown crops compute a
    // deterministic colour below.
    const COLOR_MAP = {
        WHEAT:     '#d4a843',
        BARLEY:    '#c8b84a',
        CANOLA:    '#d4c832',
        MAIZE:     '#d4943a',
        SUNFLOWER: '#d4b420',
        SOYBEAN:   '#88aa44',
        SUGARBEET: '#c05090',
        POTATO:    '#a06030',
        GRASS:     '#7fb069',
        CLOVER:    '#7fb069',
        ALFALFA:   '#88aa44',
        HAY:       '#a8b878',
        STRAW:     '#d4c089',
    };

    // Map-supplied catalog: { NAME: { name, title, fillTitle } }. Populated by
    // setCatalog() — used as a name lookup, not for colour overrides.
    let catalogByName = {};

    function setCatalog(arr) {
        if (!Array.isArray(arr)) return;
        const map = {};
        for (const ft of arr) { if (ft && ft.name) map[ft.name] = ft; }
        catalogByName = map;
    }

    // Stable hash → HSL. Same crop always gets the same colour, even when we
    // don't know it. Earth-tone palette: hue 20-60° (warm grain) or 80-140°
    // (greens), avoiding garish primaries.
    function hashColor(name) {
        let h = 0;
        for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
        // Two hue bands so harvest-ready (warm) vs leafy (green) feel sensible.
        const bandWarm = (h % 41) + 20;     // 20-60°
        const bandCool = ((h >>> 7) % 61) + 80;  // 80-140°
        const useWarm  = (h & 1) === 0;
        const hue = useWarm ? bandWarm : bandCool;
        const sat = 45 + ((h >>> 13) % 20);  // 45-64 %
        const lit = 50 + ((h >>> 19) % 10);  // 50-59 %
        return `hsl(${hue}, ${sat}%, ${lit}%)`;
    }

    /**
     * Returns a coloured SVG icon as a CSS-masked <span>. Default 16 px.
     * Falls back to a 🌱 emoji span when we don't have an SVG for this crop.
     */
    function icon(cropId, size) {
        const s    = size || 16;
        const name = ICON_MAP[cropId];
        const color = COLOR_MAP[cropId] || hashColor(cropId || '?');

        if (name) {
            const url = `/icons/${name}.svg`;
            return `<span class="crop-ic" style="
                display:inline-block;
                width:${s}px;height:${s}px;
                vertical-align:middle;flex-shrink:0;
                background-color:${color};
                -webkit-mask:url(${url}) center/contain no-repeat;
                mask:url(${url}) center/contain no-repeat;
            "></span>`;
        }

        // Generic fallback: tinted leaf emoji at the right size.
        return `<span class="crop-ic crop-ic-fallback" style="
            display:inline-flex;align-items:center;justify-content:center;
            width:${s}px;height:${s}px;
            vertical-align:middle;flex-shrink:0;
            font-size:${Math.round(s * 0.85)}px;
            color:${color};
            line-height:1;
        ">🌱</span>`;
    }

    /** Returns icon + name, suitable for inline use in tables. */
    function iconWithName(cropId, cropName, size) {
        const ic = icon(cropId, size);
        const nm = cropName || (catalogByName[cropId] && catalogByName[cropId].title) || cropId || '';
        return `<span style="display:inline-flex;align-items:center;gap:6px">${ic}<span>${nm}</span></span>`;
    }

    /** Returns the colour used for this crop in charts/bars. */
    function color(cropId) {
        return COLOR_MAP[cropId] || hashColor(cropId || '?');
    }

    /** Number of crops the map supports (after setCatalog). */
    function catalogSize() { return Object.keys(catalogByName).length; }

    window.CropIcons = { icon, iconWithName, color, setCatalog, catalogSize };
})();
