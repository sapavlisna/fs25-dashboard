-- FS25 Dashboard — exports live game state to dashboard_data.json.
--
-- Reads:  in-game state (fields, vehicles, husbandry, silos, prices, weather)
-- Writes: <UserProfileAppPath>/dashboard_data.json every 2 s when state changes
-- Reader: the companion Node.js dashboard server (separate process)
--
-- Field detection — the why:
--   The previous version read field.fieldState.fruitTypeIndex directly.
--   That property is the LAST persisted fruit; it lags after re-sowing.
--   The in-game "Zemědělská půda" panel reads from field:getFieldState() —
--   a method call that re-queries the density map. We do the same so the
--   dashboard and the panel always agree on what's growing.
--
--   We also iterate g_farmlandManager.farmlands as the primary loop. For each
--   farmland we look up its field via farmland.field (back-ref) — that is the
--   farmland → field mapping the game itself uses for the panel. Falling back
--   to g_fieldManager iteration only when farmland.field is nil.

DashboardExport = {}

DashboardExport.MOD_NAME       = g_currentModName or "FS25_Dashboard"
DashboardExport.MOD_DIR        = g_currentModDirectory or ""
-- MOD_VERSION is kept in sync with modDesc.xml by scripts/build-mod-generic.ps1.
-- Do not edit by hand; bump via the build script.
DashboardExport.MOD_VERSION    = "1.10.0.1"
-- SCHEMA_VERSION tracks the dashboard_data.json shape — bump ONLY on breaking
-- changes (renamed/removed fields). Server has MIN/MAX bounds and warns on
-- mismatch. See src/Dashboard/docs/COMPATIBILITY.md.
--
-- 2: the payload no longer restates data the server can reconstruct — field
--    records omit defaulted keys, and the fruit catalog + price-forecast curve
--    moved to dashboard_static.json. A server older than 1.5 will render an
--    empty crop calendar and broken owned-field filters, hence the bump.
DashboardExport.SCHEMA_VERSION = 2
DashboardExport.EXPORT_PERIOD  = 2000          -- ms between writes
DashboardExport.OUTPUT_FILE    = (getUserProfileAppPath and (getUserProfileAppPath() .. "dashboard_data.json"))
                                  or "dashboard_data.json"
-- Map outlines are static per map, so they get their own file written ONCE
-- rather than riding every 2 s export. Encoding ~3600 polygon points each tick
-- cost ~42 ms of frame time (measured: encode 10 ms → 52 ms once outlines were
-- ready) for data the server caches after reading it the first time.
DashboardExport.GEOMETRY_FILE  = (getUserProfileAppPath and (getUserProfileAppPath() .. "dashboard_map_geometry.json"))
                                  or "dashboard_map_geometry.json"
-- Player/vehicle positions on a short period so the Live Map reads as realtime,
-- without dragging the whole payload along. See writePositions().
DashboardExport.POSITIONS_FILE = (getUserProfileAppPath and (getUserProfileAppPath() .. "dashboard_positions.json"))
                                  or "dashboard_positions.json"
-- Session-static payload sections (fruit catalog, price-forecast curve), written
-- ONCE per save like GEOMETRY_FILE. They were 27.4 % of a measured 146 KB
-- payload re-encoded every 2 s. See maybeWriteStatic().
DashboardExport.STATIC_FILE    = (getUserProfileAppPath and (getUserProfileAppPath() .. "dashboard_static.json"))
                                  or "dashboard_static.json"
DashboardExport.POSITION_PERIOD = 250          -- ms between position writes (4 Hz)

-- Runtime state
DashboardExport.prevFields     = {}            -- fieldId → { fruitTypeId, growthState, isReady, area } (event detection)
DashboardExport.fruitCache     = {}            -- farmlandId → { fruitIdx, growth, expiresAt } (avoid hammering density map)
DashboardExport.FRUIT_TTL      = 300000        -- ms — safety re-scan once per 5 min (change detector invalidates sooner on edits)
DashboardExport.FRUIT_TTL_OTHER = 600000       -- ms — cizí pole: re-probe max 1× za 10 min (nejsou v inkrementálním scanu)
DashboardExport.scanState      = nil           -- { farmlandId, fieldRef, fruitList, cursor, partial } — current incremental scan
DashboardExport.scanAccumMs    = 0             -- ms accumulated for scan pacing
DashboardExport.SCAN_PERIOD    = 500           -- ms between scan chunks
DashboardExport.FRUITS_PER_CHUNK = 5           -- density queries per chunk
DashboardExport.GEOM_BUDGET_MS = 1             -- ms per frame spent building live-map geometry
DashboardExport.FIELD_POLY_PER_EXPORT = 16     -- new field outlines built per export
DashboardExport.prevBalance    = nil           -- last seen balance (delta detection — server actually does this; we just emit current)
DashboardExport.lastExportAt   = 0
DashboardExport.lastDirtyAt    = 0
DashboardExport.diagDumped     = false         -- one-shot startup probe
DashboardExport.pendingEvents  = {}            -- queued sow/harvest events until next write
DashboardExport.pfCache        = {}            -- farmlandId → { data, expiresAt } (Precision Farming per-field)
DashboardExport.PF_TTL_OWNED   = 30000         -- ms — refresh PF dat vlastněných polí
DashboardExport.PF_TTL_OTHER   = 120000        -- ms — cizí pole stačí zřídka
DashboardExport.pfScanState    = nil           -- inkrementální stav rozpracovaného PF přepočtu (1 native call/tick)
DashboardExport.statusCache    = {}            -- farmlandId → { data, expiresAt } — FieldUtil.getFieldStatus výsledky
DashboardExport.STATUS_TTL     = 60000         -- ms — plow/lime/weed/stone se mění jen polní prací; invalidace i přes detectFieldChanges
DashboardExport.currencyCache  = nil           -- { data, expiresAt } — AdditionalCurrencies XML čtení (disk I/O)
DashboardExport.CURRENCY_TTL   = 60000         -- ms — měna se za hru prakticky nemění; drží disk I/O mimo hot path
DashboardExport.pricesCache    = nil           -- { data, expiresAt } — sell-point ceny
DashboardExport.PRICES_TTL     = 20000         -- ms — ceny FS25 ekonomiky se hýbou v řádu herních dnů, ne sekund
DashboardExport.fsSnapshot     = nil           -- field → raw getFieldState() v rámci JEDNOHO exportu (viz detectFieldChanges)
DashboardExport.DEBUG          = false         -- true = plný PERF log každý tick
DashboardExport.PERF_LOG_MS    = 25            -- ms — nad tímto prahem se PERF řádek loguje vždy
DashboardExport.PERF_LOG_FIRST = 5             -- prvních N exportů loguj vždy (baseline po startu)
DashboardExport.settings       = nil           -- DashboardSettings — co se exportuje (viz DashboardSettings.lua), naplní loadMap()

-- ─────────────────────────────────────────────────────────────────────────────
-- JSON encoder (pure Lua, no deps)
-- Handles: nil → null, booleans, numbers (integer + float), strings (escaped),
-- arrays (table with numeric 1..N keys), objects (everything else).
-- ─────────────────────────────────────────────────────────────────────────────

local JSON_ESCAPES = {
    ['\\'] = '\\\\', ['"'] = '\\"', ['\n'] = '\\n', ['\r'] = '\\r', ['\t'] = '\\t',
}
local ESCAPE_CLASS = '[%z\1-\31\\"]'

local function escapeRepl(c)
    return JSON_ESCAPES[c] or string.format('\\u%04x', string.byte(c))
end

-- gsub allocates a fresh string even when it replaces nothing; find allocates
-- nothing. Almost every string in the payload (field/crop/vehicle names) needs
-- no escaping at all, so the find guard skips the allocation entirely.
local function escapeStr(s)
    if string.find(s, ESCAPE_CLASS) == nil then return s end
    return (string.gsub(s, ESCAPE_CLASS, escapeRepl))
end

-- '"key":' prefixes, built once per distinct key. Without this, escapeStr runs
-- for every key of every record — 179 fields × 25 keys = 4475 gsub calls per
-- tick over ~25 distinct keys. Keys are string literals from this file plus
-- stringified farmland ids (geometry file), so the cache is bounded.
local keyPrefixCache = {}

local function keyPrefix(k)
    local p = keyPrefixCache[k]
    if p == nil then
        p = '"' .. escapeStr(k) .. '":'
        keyPrefixCache[k] = p
    end
    return p
end

-- Small non-negative integers dominate the payload (growth states, levels,
-- percentages, counts, ids) — precomputed strings keep them out of
-- string.format, which allocates on every call.
local SMALL_INT = {}
for i = 0, 512 do SMALL_INT[i] = string.format("%d", i) end

local function numberToStr(v)
    if v ~= v or v == math.huge or v == -math.huge then return "null" end
    if v == math.floor(v) then
        if v >= 0 and v <= 512 then return SMALL_INT[v] end
        if math.abs(v) < 1e15 then return string.format("%d", v) end
    end
    return (string.format("%.4f", v):gsub("%.?0+$", ""))
end

-- Append the encoding of `v` to `buf` starting at index `n`; returns the new n.
--
-- The index rides in and out of the recursion instead of using `#buf + 1`,
-- which is an O(log n) length probe and would run ~19 000 times per tick.
--
-- Array test is a fast path: a table is an array iff [1] exists. The payload
-- never mixes numeric and string keys in one table and every array here is
-- filled sequentially, so the old full `pairs` scan (an extra O(n) pass just to
-- decide — 179 iterations for `fields` alone) bought nothing.
local function encTo(buf, n, v)
    local tv = type(v)
    if v == nil then
        n = n + 1; buf[n] = "null"
    elseif tv == "boolean" then
        n = n + 1; buf[n] = v and "true" or "false"
    elseif tv == "number" then
        n = n + 1; buf[n] = numberToStr(v)
    elseif tv == "string" then
        buf[n + 1] = '"'
        buf[n + 2] = escapeStr(v)
        buf[n + 3] = '"'
        n = n + 3
    elseif tv == "table" then
        if v.__emptyArray then
            n = n + 1; buf[n] = "[]"
        elseif v[1] ~= nil then
            n = n + 1; buf[n] = "["
            for i = 1, #v do
                if i > 1 then n = n + 1; buf[n] = "," end
                n = encTo(buf, n, v[i])
            end
            n = n + 1; buf[n] = "]"
        else
            n = n + 1; buf[n] = "{"
            local first = true
            for k, val in pairs(v) do
                if type(k) == "string" then
                    if first then first = false else n = n + 1; buf[n] = "," end
                    n = n + 1; buf[n] = keyPrefix(k)
                    n = encTo(buf, n, val)
                end
            end
            n = n + 1; buf[n] = "}"
        end
    else
        n = n + 1; buf[n] = "null"
    end
    return n
end

-- Reused across ticks so the table keeps its capacity: a fresh table would grow
-- from empty to ~19 000 slots every export, re-allocating and copying about a
-- dozen times on the way. Entries are cleared afterwards so the previous tick's
-- strings stay collectable. Not reentrant — nothing here encodes recursively.
local encBuf = {}

local function encodeJson(v)
    local n = encTo(encBuf, 0, v)
    local s = table.concat(encBuf, "", 1, n)
    for i = 1, n do encBuf[i] = nil end
    return s
end

-- Empty array sentinel — distinguishes [] from {} during JSON encode
local function emptyArray() return { __emptyArray = true } end

-- ─────────────────────────────────────────────────────────────────────────────
-- Small helpers
-- ─────────────────────────────────────────────────────────────────────────────

local function safeCall(fn, ...)
    local ok, ret = pcall(fn, ...)
    if ok then return ret end
    return nil
end

-- Memoizace v rámci jednoho update ticku: getFarmId se volá ~10-15× za tick
-- (collectFields, collectVehicles, collectStorages, tickFieldScan, …). farmId
-- se během jednoho framu nemění, tak ho spočítáme jednou. update() cache resetuje.
local farmIdCache = nil

local function getFarmId()
    if farmIdCache ~= nil then return farmIdCache end
    if g_currentMission and g_currentMission.getFarmId then
        farmIdCache = g_currentMission:getFarmId() or 1
    else
        farmIdCache = 1
    end
    return farmIdCache
end

local function round2(n) return math.floor((n or 0) * 100 + 0.5) / 100 end
local function round0(n) return math.floor((n or 0) + 0.5) end

-- Owner farm id without allocating a closure. safeCall takes varargs, so a
-- method can be passed as (fn, self) instead of being wrapped in
-- `function() return o:getOwnerFarmId() end` — which allocates a fresh closure
-- (it captures `o`) on every single call. This runs per vehicle at 4 Hz from
-- writePositions and per placeable/vehicle on every export.
local function ownerFarmId(o)
    return (o.getOwnerFarmId and safeCall(o.getOwnerFarmId, o)) or o.ownerFarmId or 0
end

-- Engine yaw → compass bearing for the Live Map: 0° = north, growing clockwise
-- (east 90°, south 180°, west 270°).
--
-- The engine's yaw is NOT that bearing. MultiCharacters derives a facing yaw
-- from a direction vector as `math.atan2(dx, dz)` (MultiCharacterManager.lua:1423,
-- live-proven — it is what turns the character on exiting a vehicle), so a yaw of
-- θ points along (sin θ, cos θ). Since north is -Z and east is +X, a compass
-- bearing A points along (sin A, -cos A). Equating the two gives A = 180 - θ:
-- yaw 0 faces SOUTH, yaw 180 faces north.
--
-- Note this is a reflection plus an offset, not a rotation — an earlier -90 fix
-- assumed a pure rotation and was wrong by ~55°. Confirmed in game 2026-07-26:
-- the arrow tracks the real facing on both foot and vehicles.
-- Lua's modulo is floor-based, so the result is always in [0, 360).
local function headingFromYaw(yawRad)
    return round2((180 - math.deg(yawRad or 0)) % 360)
end

-- Squared perpendicular distance of point (px,pz) to segment (ax,az)-(bx,bz).
local function segDist2(px, pz, ax, az, bx, bz)
    local dx, dz = bx - ax, bz - az
    local len2 = dx * dx + dz * dz
    local t = 0
    if len2 > 0 then
        t = ((px - ax) * dx + (pz - az) * dz) / len2
        if t < 0 then t = 0 elseif t > 1 then t = 1 end
    end
    local ex, ez = px - (ax + t * dx), pz - (az + t * dz)
    return ex * ex + ez * ez
end

-- Douglas-Peucker line simplification (recursive). Marks points to keep in
-- `keep`. Preserves corners, drops near-collinear points — turns FS25's dense
-- field outlines (100+ pts) into a handful without visible change on a map.
local function dpSimplify(pts, tol2, first, last, keep)
    local maxD, idx = -1, -1
    for i = first + 1, last - 1 do
        local d = segDist2(pts[i][1], pts[i][2], pts[first][1], pts[first][2], pts[last][1], pts[last][2])
        if d > maxD then maxD = d; idx = i end
    end
    if idx > 0 and maxD > tol2 then
        dpSimplify(pts, tol2, first, idx, keep)
        keep[idx] = true
        dpSimplify(pts, tol2, idx, last, keep)
    end
end

local function pctOf(value, capacity)
    if not capacity or capacity == 0 then return 0 end
    return math.floor((value / capacity) * 100 + 0.5)
end

-- ─────────────────────────────────────────────────────────────────────────────
-- Fruit catalog — every crop the map supports (name + Czech title)
-- ─────────────────────────────────────────────────────────────────────────────

function DashboardExport:collectAvailableFruits()
    -- Session-static: the fruit catalog (incl. plantable/harvestable windows)
    -- never changes while a save is loaded — compute once, reuse the table.
    if self.fruitCatalogCache then return self.fruitCatalogCache end

    local out = {}
    if g_fruitTypeManager == nil then return out end

    -- Sowing / harvesting windows are season-period-aware. The mission's
    -- growthMode setting (SEASONAL vs NON_SEASONAL) decides whether
    -- ft:getIsPlantableInPeriod returns true outside the natural sowing
    -- window. Must be passed in or the API returns false for everything
    -- mid-summer / mid-winter.
    -- See knowledge/fs25-crop-calendar-api.md
    local growthMode = (g_currentMission and g_currentMission.missionInfo
                         and g_currentMission.missionInfo.growthMode) or 1

    local seen = {}
    for _, ft in pairs(g_fruitTypeManager.fruitTypes or {}) do
        if type(ft) == "table" and ft.name and not seen[ft.name] then
            seen[ft.name] = true
            local fillTitle = (ft.fillType and (ft.fillType.title or ft.fillType.name)) or nil

            -- Bitmask-style arrays (1..12) for sowing + harvest windows.
            -- The two FruitTypeDesc methods are the only public API for this
            -- — there's no array of months on the descriptor itself.
            local plantable, harvestable = {}, {}
            for p = 1, 12 do
                local okPlant = (ft.getIsPlantableInPeriod
                                  and safeCall(function() return ft:getIsPlantableInPeriod(growthMode, p) end))
                                  or false
                local okHarv  = (ft.getIsHarvestableInPeriod
                                  and safeCall(function() return ft:getIsHarvestableInPeriod(growthMode, p) end))
                                  or false
                plantable[p]   = okPlant   and true or false
                harvestable[p] = okHarv    and true or false
            end

            table.insert(out, {
                name      = tostring(ft.name),
                title     = ft.title and tostring(ft.title) or "",
                fillTitle = fillTitle and tostring(fillTitle) or "",
                -- Per-fruit field-mechanic flags — frontend uses these to decide
                -- whether a field with this crop needs rolling/lime/cultivation.
                -- FS25 default for needsRolling is true; some fruits (corn, beet,
                -- rice, sugarcane) override it to false.
                needsRolling          = ft.needsRolling ~= false,
                consumesLime          = ft.consumesLime ~= false,
                growthRequiresLime    = ft.growthRequiresLime == true,
                isCultivationAllowed  = ft.isCultivationAllowed ~= false,
                allowsSeeding         = ft.allowsSeeding ~= false,
                -- Calendar planning data
                plantableMonths       = plantable,    -- bool[1..12]
                harvestableMonths     = harvestable,  -- bool[1..12]
                regrows               = ft.regrows == true,
                firstRegrowthState    = ft.firstRegrowthState or 1,
                startSprayLevel       = ft.startSprayLevel or 0,
                numGrowthStates       = ft.numGrowthStates or 0,
                minHarvestingGrowthState = ft.minHarvestingGrowthState or 0,
            })
        end
    end

    table.sort(out, function(a, b) return (a.title or a.name) < (b.title or b.name) end)
    if #out > 0 then self.fruitCatalogCache = out end  -- don't cache an empty early read
    return out
end

-- ─────────────────────────────────────────────────────────────────────────────
-- Game time + day
-- ─────────────────────────────────────────────────────────────────────────────

function DashboardExport:collectGameTime()
    if not (g_currentMission and g_currentMission.environment) then
        return { gameDay = 1, gameTime = "00:00" }
    end
    local env = g_currentMission.environment
    local day = env.currentDay or 1
    local minutesSinceMidnight = math.floor((env.dayTime or 0) / 60000)
    local h = math.floor(minutesSinceMidnight / 60) % 24
    local m = minutesSinceMidnight % 60
    -- FS25: a "period" is a month (1..12). daysPerPeriod is configurable per save.
    local month = env.currentPeriod or 1
    local daysPerMonth = env.daysPerPeriod or 1
    local dayInMonth
    if env.getDayInPeriodFromDay and env.currentMonotonicDay then
        dayInMonth = env:getDayInPeriodFromDay(env.currentMonotonicDay)
    end
    -- Year. FS25 exposes it as env.currentYear when the save has progressed
    -- past day 1; fall back to a count derived from the monotonic day so we
    -- never show "nil".
    local year = env.currentYear
    if year == nil and env.currentMonotonicDay then
        year = math.floor((env.currentMonotonicDay - 1) / (12 * daysPerMonth)) + 1
    end
    return {
        gameDay      = day,
        gameYear     = year or 1,
        gameMonth    = month,
        dayInMonth   = dayInMonth,
        daysPerMonth = daysPerMonth,
        gameTime     = string.format("%02d:%02d", h, m),
    }
end

-- ─────────────────────────────────────────────────────────────────────────────
-- Weather — current type + temperature + day's min/max
-- Pattern from FS25_ExtendedGameInfoDisplay
-- ─────────────────────────────────────────────────────────────────────────────

-- FS25 WeatherType enum → Czech label (verified from in-game icon names)
local WEATHER_CS = {
    [0] = "Jasno",
    [1] = "Slunečno",
    [2] = "Polojasno",
    [3] = "Oblačno",
    [4] = "Déšť",
    [5] = "Mrholení",
    [6] = "Sníh",
    [7] = "Bouřka",
    [8] = "Kroupy",
    [9] = "Mlha",
}

function DashboardExport:collectWeather()
    local out = {
        typeId = -1, title = "", temperature = 0, temperatureMin = 0, temperatureMax = 0,
        forecast = emptyArray(),
    }
    if not (g_currentMission and g_currentMission.environment and g_currentMission.environment.weather) then
        return out
    end
    local env     = g_currentMission.environment
    local weather = env.weather

    local typeId = safeCall(function() return weather:getCurrentWeatherType() end)
    if typeId ~= nil then
        out.typeId = typeId
        out.title  = WEATHER_CS[typeId] or ("typ_" .. tostring(typeId))
    end

    local cur = safeCall(function() return weather.forecast:getCurrentWeather() end)
    if cur and cur.temperature then out.temperature = round2(cur.temperature) end

    -- getCurrentMinMaxTemperatures() returns two values; safeCall only captures the first.
    -- Use pcall directly so both are available.
    local ok, minC, maxC = pcall(function() return weather:getCurrentMinMaxTemperatures() end)
    if ok then
        if type(minC) == "number" then out.temperatureMin = round2(minC) end
        if type(maxC) == "number" then out.temperatureMax = round2(maxC) end
    end

    -- Multi-day forecast — preferred path is `weather.forecast.items` (FS25's
    -- internal WeatherForecast keeps a queue of upcoming weather points with
    -- day, dayTime, type, min/max temperature). Fallback to iterating
    -- `weather:getNextWeatherType(dayTime, day)` for the next 3 days when the
    -- richer structure isn't accessible.
    local currentDay = env.currentDay or 1
    local forecast   = {}
    local seenDays   = {}

    if weather.forecast and type(weather.forecast.items) == "table" then
        for _, item in ipairs(weather.forecast.items) do
            local d = item.day
            if d and d > currentDay and not seenDays[d] and #forecast < 3 then
                seenDays[d] = true
                local title = WEATHER_CS[item.weatherType] or ""
                local rec   = {
                    day        = d,
                    daysAhead  = d - currentDay,
                    typeId     = item.weatherType or -1,
                    title      = title,
                }
                if type(item.minTemperature) == "number" then rec.temperatureMin = round2(item.minTemperature) end
                if type(item.maxTemperature) == "number" then rec.temperatureMax = round2(item.maxTemperature) end
                table.insert(forecast, rec)
            end
        end
    end

    -- Fallback if items[] didn't yield enough entries: poll noon of the next 3 days.
    if #forecast < 3 and weather.getNextWeatherType then
        local noon = 12 * 60 * 60 * 1000   -- daytime in ms
        for offset = 1, 3 do
            local d = currentDay + offset
            if not seenDays[d] then
                local nextType = safeCall(function() return weather:getNextWeatherType(noon, d) end)
                if nextType ~= nil then
                    seenDays[d] = true
                    table.insert(forecast, {
                        day       = d,
                        daysAhead = offset,
                        typeId    = nextType,
                        title     = WEATHER_CS[nextType] or "",
                    })
                end
            end
            if #forecast >= 3 then break end
        end
    end

    if #forecast > 0 then out.forecast = forecast end
    return out
end

-- ─────────────────────────────────────────────────────────────────────────────
-- Farm balance
-- ─────────────────────────────────────────────────────────────────────────────

function DashboardExport:collectFarmBalance()
    local farmId = getFarmId()
    if g_farmManager and g_farmManager.getFarmById then
        local farm = g_farmManager:getFarmById(farmId)
        if farm and farm.money then return farm.money end
    end
    return 0
end

-- ─────────────────────────────────────────────────────────────────────────────
-- Currency — detect FS25_additionalCurrencies mod selection so the dashboard
-- can render money the same way the in-game HUD does.
-- farmBalance / prices in the payload are ALWAYS raw euro values; the frontend
-- multiplies by factor when converter == true.
--
-- FS25 mods run in isolated Lua environments; AdditionalCurrencies' global is
-- not accessible from our environment. We read its settings + currencies XML
-- files directly from disk instead.
-- ─────────────────────────────────────────────────────────────────────────────

function DashboardExport:collectCurrency()
    -- TTL cache: computeCurrency čte dva XML soubory z disku (blokující I/O),
    -- což je jediné disk-I/O na 2s hot path a zdroj nepravidelných spiků. Měna
    -- se za hru prakticky nemění, tak stačí refresh po CURRENCY_TTL.
    local now = g_currentMission and g_currentMission.time or 0
    if self.currencyCache and self.currencyCache.expiresAt > now then
        return self.currencyCache.data
    end
    local out = self:computeCurrency()
    self.currencyCache = { data = out, expiresAt = now + self.CURRENCY_TTL }
    return out
end

function DashboardExport:computeCurrency()
    local out = { code = "EUR", symbol = "€", factor = 1, prefix = true, converter = false, modActive = false }

    -- Derive the other mod's settings directory from ours.
    -- g_currentModSettingsDirectory is like ".../modSettings/FS25_Dashboard/"
    local base = g_currentModSettingsDirectory
                 and g_currentModSettingsDirectory:match("^(.+[/\\])[^/\\]+[/\\]*$")
    if not base then return out end

    local settingsFile = XMLFile.loadIfExists("acSettingsXML",
        base .. "FS25_additionalCurrencies/settings.xml")
    if settingsFile == nil then return out end  -- mod not active / no saved state

    local currencyIdx = settingsFile:getInt("settings.currency", 1)
    local converter   = settingsFile:getBool("settings.converter", false)
    settingsFile:delete()

    -- currencies.xml lives inside the mod zip; FS25 mounts zip contents as a
    -- virtual directory so g_modsDirectory .. "ModName/file" resolves correctly.
    local configFile = XMLFile.loadIfExists("acCurrenciesXML",
        g_modsDirectory .. "FS25_additionalCurrencies/currencies.xml")

    local euroFactor, dolarFactor, poundFactor = 1, 1.06, 0.83
    if configFile then
        euroFactor  = configFile:getFloat("currencies#euroFactor",  1)
        dolarFactor = configFile:getFloat("currencies#dolarFactor", 1.06)
        poundFactor = configFile:getFloat("currencies#poundFactor", 0.83)
    end

    -- Index matches AdditionalCurrencies' own scheme: 1=EUR, 2=USD, 3=GBP, 4+=custom
    local currencies = {
        { code="EUR", symbol="€",  factor=euroFactor,  prefix=true  },
        { code="USD", symbol="$",  factor=dolarFactor, prefix=true  },
        { code="GBP", symbol="£",  factor=poundFactor, prefix=true  },
    }

    if configFile then
        local SYMBOL_TO_CODE = {
            ["R$"]="BRL",  ["CN¥"]="CNY", ["Kč"]="CZK",  ["Ft"]="HUF",
            ["¥"]="JPY",   ["kr"]="NOK",  ["zł"]="PLN",  ["lei"]="RON",
            ["руб"]="RUB", ["₩"]="KRW",   ["CHF"]="CHF", ["TL"]="TRY",
            ["грн"]="UAH",
        }
        local i = 0
        while true do
            local key = string.format("currencies.currency(%d)", i)
            if not configFile:hasProperty(key) then break end
            local symbol = configFile:getString(key .. "#symbol", "?")
            local prefix = configFile:getBool(key .. "#prefixSymbol", true)
            local factor = configFile:getFloat(key .. "#factor", 1)
            table.insert(currencies, {
                code   = SYMBOL_TO_CODE[symbol] or symbol,
                symbol = symbol,
                factor = factor,
                prefix = prefix,
            })
            i = i + 1
        end
        configFile:delete()
    end

    local cur = currencies[currencyIdx]
    if not cur then return out end

    out.modActive = true
    out.code      = cur.code
    out.symbol    = cur.symbol
    out.factor    = cur.factor
    out.prefix    = cur.prefix
    out.converter = converter

    return out
end

-- ─────────────────────────────────────────────────────────────────────────────
-- Save metadata — name, map, save date (mirrors what server can also read)
-- ─────────────────────────────────────────────────────────────────────────────

function DashboardExport:collectSaveMeta()
    local out = { name = "", mapTitle = "", saveDateFormatted = "" }
    if g_currentMission and g_currentMission.missionInfo then
        local info = g_currentMission.missionInfo
        out.name = info.savegameName or info.name or ""
        out.mapTitle = info.mapTitle or ""
        out.saveDateFormatted = info.saveDateFormatted or ""
    end
    return out
end

-- ─────────────────────────────────────────────────────────────────────────────
-- Game settings — difficulty toggles that decide which field mechanics matter.
-- The dashboard uses these to suppress badges for actions the player has turned
-- off (e.g. don't tell them to lime when limeRequired is false). All other
-- field state stays in the payload — these flags only gate the UI.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- Price forecast — per-fillType seasonal multiplier curve (12 months).
-- FS25 stores it as `fillType.economy.factors[period]` (period 1..12 ≈
-- EARLY_SPRING..LATE_WINTER, but the in-game calendar starts at MARCH which
-- in CZ savegame layout is currentPeriod=1). The curve is static for the
-- session, so we send it just once per WS tick; the frontend can use it to
-- predict future prices: forecast_price = pricePerTon × factor[future_period].
-- ─────────────────────────────────────────────────────────────────────────────

function DashboardExport:collectPriceForecast()
    local out = {
        currentPeriod = 1,
        daysPerPeriod = 1,
        fillTypes     = {},
    }
    if g_currentMission and g_currentMission.environment then
        out.currentPeriod = g_currentMission.environment.currentPeriod or 1
        out.daysPerPeriod = g_currentMission.environment.daysPerPeriod or 1
    end
    -- The factor curve is session-static; only currentPeriod/daysPerPeriod
    -- above change at runtime. Reuse the fillTypes table once built.
    if self.priceForecastCache then
        out.fillTypes = self.priceForecastCache
        return out
    end
    if not g_fillTypeManager then return out end

    for _, ft in pairs(g_fillTypeManager.fillTypes or {}) do
        if type(ft) == "table" and ft.economy and ft.economy.factors
           and ft.pricePerLiter and ft.pricePerLiter > 0 then
            local factors = {}
            for period = 1, 12 do
                factors[period] = ft.economy.factors[period] or 1
            end
            -- pricePerTon = pricePerLiter / massPerLiter   (mass-per-liter * 1000 gives kg/m³)
            -- `ft.massPerLiter` can be 0 in mods (the `or` fallback doesn't
            -- catch it because 0 is truthy in Lua) — guard explicitly to
            -- avoid a hard divide-by-zero that aborts the whole tick.
            local massPerLiter = ft.massPerLiter
            if not massPerLiter or massPerLiter <= 0 then massPerLiter = 0.001 end
            local pricePerTonBase = ft.pricePerLiter / massPerLiter
            -- name = canonical filltype name (matches what collectPrices emits as item.name title)
            table.insert(out.fillTypes, {
                name        = (ft.title or ft.name or ""),  -- displayable name; matches prices[].items[].name
                fillType    = ft.name or "",                -- enum key (e.g. WHEAT)
                pricePerTon = math.floor(pricePerTonBase + 0.5),
                factors     = factors,
            })
        end
    end

    table.sort(out.fillTypes, function(a, b) return (a.name or "") < (b.name or "") end)
    if #out.fillTypes > 0 then self.priceForecastCache = out.fillTypes end
    return out
end

function DashboardExport:collectGameSettings()
    local out = {
        weedsEnabled           = true,
        stonesEnabled          = true,
        plowingRequiredEnabled = true,
        limeRequired           = true,
    }
    if g_currentMission and g_currentMission.missionInfo then
        local info = g_currentMission.missionInfo
        if info.weedsEnabled           ~= nil then out.weedsEnabled           = info.weedsEnabled           end
        if info.stonesEnabled          ~= nil then out.stonesEnabled          = info.stonesEnabled          end
        if info.plowingRequiredEnabled ~= nil then out.plowingRequiredEnabled = info.plowingRequiredEnabled end
        if info.limeRequired           ~= nil then out.limeRequired           = info.limeRequired           end
    end
    return out
end

-- ─────────────────────────────────────────────────────────────────────────────
-- Fields — iterate farmlands, use farmland.field as back-ref to the field
-- object, then field:getFieldState() for current fruit/growth.
-- ─────────────────────────────────────────────────────────────────────────────

-- Authoritative single-point fruit lookup: reads the live density map at a
-- world position and returns the engine's current truth for what's growing.
-- This is what tools like the in-game crop scanner use. fieldState.fruitTypeIndex
-- is *not* reliable (it can lag the actual density map by a season on community
-- maps, and resolves to wrong indices on maps that don't follow vanilla order).
-- Recurring refresh is driven incrementally by tickFieldScan() — direct probes
-- from the export path happen only to seed a missing cache entry.
local function probeFruitAt(wx, wz)
    if not (FSDensityMapUtil and FSDensityMapUtil.getFruitTypeIndexAtWorldPos) then
        return 0, 0
    end
    local idx, growth = FSDensityMapUtil.getFruitTypeIndexAtWorldPos(wx, wz)
    return (type(idx) == "number" and idx) or 0,
           (type(growth) == "number" and growth) or 0
end

-- Best-of-N sample to be robust against the field centroid landing on a
-- non-fruit pixel (boundary, tramline, edge of an irregular plot). We probe
-- the centroid plus 4 offsets at radius r=sqrt(areaHa*10000)/4 and pick the
-- most-common non-zero fruit index. Ties broken by centroid value.
function DashboardExport:probeFieldFruit(field)
    if not (field and field.posX and field.posZ) then return 0, 0 end
    local r = math.min(40, math.max(8, math.sqrt((field.areaHa or 0) * 10000) / 4))
    local samples = {
        { field.posX,     field.posZ },        -- centroid (preferred on tie)
        { field.posX + r, field.posZ },
        { field.posX - r, field.posZ },
        { field.posX,     field.posZ + r },
        { field.posX,     field.posZ - r },
    }
    local counts, growthByIdx = {}, {}
    for _, s in ipairs(samples) do
        local idx, growth = probeFruitAt(s[1], s[2])
        if idx > 0 then
            counts[idx] = (counts[idx] or 0) + 1
            if growthByIdx[idx] == nil or growth > growthByIdx[idx] then
                growthByIdx[idx] = growth
            end
        end
    end
    -- Pick winner: highest count; centroid (first sample) gets tiebreak by
    -- being processed first when counts are equal.
    local bestIdx, bestCount = 0, 0
    for idx, c in pairs(counts) do
        if c > bestCount then bestIdx, bestCount = idx, c end
    end
    return bestIdx, growthByIdx[bestIdx] or 0
end

-- Fruit lookup strategy: density map je pravda (fieldState umí zaostávat
-- o sezónu a na komunitních mapách mapovat na špatné indexy), ale živý probe
-- pro každé pole při každém exportu neškáluje s velikostí mapy. Proto se čte
-- fruitCache: vlastněná pole průběžně obnovuje tickFieldScan, živý 5bodový
-- probe se dělá jen jako seed chybějícího záznamu (a re-probe expirovaného
-- cizího pole). Growth se bere živě z fieldState, pokud se jeho fruit shoduje
-- s cachovaným — jinak z cache.
function DashboardExport:getFieldFruit(field, farmlandId, owned)
    local now = g_currentMission and g_currentMission.time or 0

    -- Živé fieldState čtení (density-map dotaz) jen pro VLASTNÍ pole. U cizích je
    -- růst kosmetika a jejich fruit stačí z cache (refresh přes FRUIT_TTL_OTHER =
    -- ~10 min) — ušetří to jeden density dotaz na cizí pole každý export.
    -- detectFieldChanges čte lastFsFruit taky jen pro vlastní pole, takže vynechání
    -- getFieldState u cizích polí nerozbije detekci setí/sklizně.
    local fsFruit, fsGrowth = 0, 0
    if owned then
        -- detectFieldChanges() already queried this field's state earlier in the
        -- same export; reuse it rather than hitting the density map twice.
        -- `false` there means the call returned nil, `nil` means it never ran
        -- (no fruitCache entry yet, i.e. first export for this field).
        local snap = self.fsSnapshot
        local raw = snap and snap[field]
        if raw == nil then
            raw = safeCall(field.getFieldState, field) or false
            if snap then snap[field] = raw end
        end
        local fs = raw or nil
        if not fs or not fs.isValid then fs = field.fieldState end
        fsFruit  = fs and fs.fruitTypeIndex or 0
        fsGrowth = fs and fs.growthState or 0
    end

    local cached = self.fruitCache[farmlandId]
    if not cached or (not owned and cached.expiresAt <= now) then
        local probeIdx, probeGrowth = self:probeFieldFruit(field)
        cached = {
            fruitIdx    = probeIdx,
            growth      = probeGrowth,
            expiresAt   = now + (owned and self.FRUIT_TTL or self.FRUIT_TTL_OTHER),
            lastFsFruit = fsFruit,
        }
        self.fruitCache[farmlandId] = cached
    end

    local idx = cached.fruitIdx or 0
    local growth = (fsFruit == idx) and fsGrowth or (cached.growth or 0)
    if idx > 0 then return idx, growth end
    return fsFruit > 0 and fsFruit or nil, fsGrowth
end

-- Incremental density scan: one chunk of FRUITS_PER_TICK queries per call.
-- Cycles through owned farmlands, refreshing whichever has the oldest cache.
function DashboardExport:tickFieldScan()
    if not (FSDensityMapUtil and FSDensityMapUtil.getFruitArea
            and g_farmlandManager and g_fruitTypeManager) then return end

    local now = g_currentMission and g_currentMission.time or 0

    -- Pick a fresh target if no scan is running.
    if not self.scanState then
        local farmId = getFarmId()
        local mapping = (g_fieldManager and g_fieldManager.farmlandIdFieldMapping) or {}
        local pick, pickExpires = nil, math.huge
        for _, fl in pairs(g_farmlandManager.farmlands or {}) do
            local ownerId = fl.farmId or fl.ownerFarmId or 0
            if ownerId == farmId then
                local field = mapping[fl.id] or fl.field
                if field and field.posX and field.posZ then
                    local cached = self.fruitCache[fl.id]
                    local exp = cached and cached.expiresAt or 0
                    if exp < pickExpires then
                        pickExpires = exp
                        pick = { farmlandId = fl.id, fieldRef = field }
                    end
                end
            end
        end
        if not pick or pickExpires > now then return end  -- nothing to refresh yet

        local fruitList = {}
        for idx, _ in pairs(g_fruitTypeManager.fruitTypes or {}) do
            if type(idx) == "number" and idx > 0 then table.insert(fruitList, idx) end
        end
        table.sort(fruitList)
        self.scanState = {
            farmlandId = pick.farmlandId,
            fieldRef   = pick.fieldRef,
            fruitList  = fruitList,
            cursor     = 1,
            partial    = {},
        }
    end

    local st = self.scanState
    local field = st.fieldRef
    local side = math.sqrt((field.areaHa or 0) * 10000) * 1.5
    local s = math.max(20, side / 2)
    local minX, minZ = field.posX - s, field.posZ - s
    local maxX, maxZ = field.posX + s, field.posZ + s

    local endCursor = math.min(st.cursor + self.FRUITS_PER_CHUNK - 1, #st.fruitList)
    for i = st.cursor, endCursor do
        local idx = st.fruitList[i]
        local area = safeCall(function()
            return FSDensityMapUtil.getFruitArea(idx, minX, minZ, maxX, minZ, minX, maxZ)
        end)
        if type(area) == "number" and area > 0 then
            st.partial[idx] = area
        end
    end
    st.cursor = endCursor + 1

    if st.cursor > #st.fruitList then
        local bestIdx, bestArea = 0, 0
        for idx, area in pairs(st.partial) do
            if area > bestArea then bestArea = area; bestIdx = idx end
        end
        -- Snapshot of fieldState.fruitTypeIndex at finalize time — used by the
        -- change detector to spot edits (sow/harvest) and trigger a fresh scan.
        local fs = safeCall(field.getFieldState, field) or field.fieldState
        local lastFs = fs and fs.fruitTypeIndex or 0
        -- The scan square is 1.5× the field's side, so over half of it lies
        -- outside the field — roadside grass and neighbour plots routinely
        -- outweigh the crop (issue #2: every field decayed to grass 0 % once
        -- its cache expired). The probe samples inside the field, so it wins
        -- whenever it hits a crop; the scan winner counts only if the engine's
        -- own field state confirms it, otherwise 0 lets getFieldFruit fall back
        -- to fieldState.
        local pIdx, pGrowth = self:probeFieldFruit(field)
        local fruitIdx, growth = 0, 0
        if pIdx > 0 then
            fruitIdx, growth = pIdx, pGrowth
        elseif bestIdx > 0 and bestIdx == lastFs then
            fruitIdx, growth = bestIdx, fs.growthState or 0
        end
        self.fruitCache[st.farmlandId] = {
            fruitIdx   = fruitIdx,
            growth     = growth,
            expiresAt  = now + self.FRUIT_TTL,
            lastFsFruit = lastFs,
        }
        self.scanState = nil
    end
end

-- Cheap per-tick check: if engine's fieldState fruit changed since we cached,
-- invalidate so the next tickFieldScan re-probes density for that field.
-- This catches player/AI sow/harvest within one export tick without polling
-- the density map every tick.
function DashboardExport:detectFieldChanges()
    if not (g_farmlandManager and g_fieldManager) then return end
    local farmId = getFarmId()
    local mapping = g_fieldManager.farmlandIdFieldMapping or {}
    -- Snapshot the raw getFieldState() result for this export. That call
    -- re-queries the density map (see the file header), and getFieldFruit()
    -- needs the same reading for the same owned fields moments later in the
    -- very same tick — it used to repeat the query for every owned field.
    --
    -- Raw, not normalized: this function falls back to field.fieldState when
    -- the call returns nil, getFieldFruit also rejects a non-isValid state.
    -- Storing the raw value lets each caller keep its own rule. `false` records
    -- "asked, got nil" so a miss is distinguishable from "not asked".
    --
    -- Keyed by the field object, not an id: collectFields emits records in two
    -- overlapping id spaces (farmland id vs field number) — same reason
    -- getFieldPolygon keys its cache this way.
    local snap = {}
    self.fsSnapshot = snap
    for _, fl in pairs(g_farmlandManager.farmlands or {}) do
        local ownerId = fl.farmId or fl.ownerFarmId or 0
        if ownerId == farmId then
            local field = mapping[fl.id] or fl.field
            local cached = field and self.fruitCache[fl.id]
            if cached then
                local raw = safeCall(field.getFieldState, field)
                snap[field] = raw or false
                local fs = raw or field.fieldState
                local nowFs = fs and fs.fruitTypeIndex or 0
                if nowFs ~= cached.lastFsFruit then
                    cached.expiresAt = 0  -- invalidate; tickFieldScan will pick it up
                    self.statusCache[fl.id] = nil  -- sow/harvest mění i plow/weed stav
                end
            end
        end
    end
end

function DashboardExport:collectFieldStatus(farmlandId, field)
    -- Returns FieldUtil-derived needs flags (plowing, lime, fertilizer, weeds,
    -- stones). Cached per farmland: the flags change only through field work,
    -- so a TTL refresh + invalidation from detectFieldChanges is enough.
    local now = g_currentMission and g_currentMission.time or 0
    local cached = self.statusCache[farmlandId]
    if cached and cached.expiresAt > now then return cached.data end

    local out = {
        needsPlowing       = false,
        needsCultivating   = false,
        needsLime          = false,
        fertilizationLevel = 0,
        weedLevel          = 0,
        stoneLevel         = 0,
    }
    if FieldUtil == nil or FieldUtil.getFieldStatus == nil then return out end
    local status = safeCall(FieldUtil.getFieldStatus, field)
    if not status then return out end

    if status.plowFactor          ~= nil then out.needsPlowing       = status.plowFactor < 0.5 end
    if status.needsLime           ~= nil then out.needsLime          = status.needsLime end
    if status.fertilizationFactor ~= nil then out.fertilizationLevel = math.floor(status.fertilizationFactor * 2 + 0.5) end
    if status.weedFactor          ~= nil then out.weedLevel          = math.floor(status.weedFactor * 3 + 0.5) end
    if status.stoneFactor         ~= nil then out.stoneLevel         = math.floor(status.stoneFactor * 3 + 0.5) end

    -- expiry rozptýlit podle farmlandId, ať po startu neexpirují všechna pole
    -- v jednom exportním ticku najednou
    self.statusCache[farmlandId] = {
        data = out,
        expiresAt = now + self.STATUS_TTL + (farmlandId % 20) * 500,
    }
    return out
end

-- ─────────────────────────────────────────────────────────────────────────────
-- Precision Farming (volitelný cross-mod read; FS25_precisionFarming 1.5)
-- API ověřeno runtime introspekcí 2026-07-06 (DashControl pf_field) — FS22
-- signatury platí i v FS25. Bez PF vrací vše nil a payload PF klíče nemá.
-- Sémantika viditelnosti: density mapy N/pH jsou vždy plné, ale hra hodnoty
-- skrývá, dokud hráč neodebere vzorek půdy (coverMap maska) — proto
-- getTypeIndexAtWorldPos vrací 0 na nevzorkovaném poli a my zrcadlíme totéž
-- (nitrogenActual/phActual = nil, dokud sampled == 0).
-- ─────────────────────────────────────────────────────────────────────────────

-- The handle is session-static (the PF mod cannot appear or vanish mid-save —
-- see collectPFMeta), but getFieldPF asked for it once per field per export.
-- Only a POSITIVE result is cached: at save load PF may not have initialized
-- g_precisionFarming yet, and caching that miss would disable PF for the whole
-- session. Cleared in deleteMap.
local pfHandleCache = nil

local function pfHandle()
    if pfHandleCache ~= nil then return pfHandleCache end
    if g_modIsLoaded and g_modIsLoaded["FS25_precisionFarming"]
        and FS25_precisionFarming ~= nil then
        pfHandleCache = FS25_precisionFarming.g_precisionFarming
        return pfHandleCache
    end
    return nil
end

-- PF soilType.name bývá l10n klíč ("$l10n_ui_soilType…") — přelož, jinak vrať beze změny.
local function pfText(s)
    if type(s) == "string" and s:sub(1, 6) == "$l10n_" then
        local ok, txt = pcall(function() return g_i18n:getText(s:sub(7)) end)
        if ok and txt then return txt end
    end
    return s
end

-- PF density-map dotazy jsou DRAHÉ na straně cizího módu (naměřeno ~15-20ms/call —
-- 3 pole × ~20 volání najednou = ~1s freeze v jednom tiku, viz PLAN-precision-farming.md
-- perf incident 2026-07-09). Proto se počítá inkrementálně: max 1 native call za
-- SCAN_PERIOD (500ms), stejný princip jako tickFieldScan pro fruit density.
--
-- Dva klíčové perf škrty (2026-07-13):
--   1) ŽÁDNÝ getFarmlandSampleState (cover mapa celé parcely, ~300ms/call, nedělitelný).
--      `sampled` se odvozuje z bodových sond: getTypeIndexAtWorldPos vrací 0 na
--      nevzorkovaném poli — stejný cover mechanismus, jen bodově a zdarma. UI ho
--      stejně čte jen jako boolean (>0).
--   2) Cizí pole se NEvzorkují body — N/pH cizích parcel je ve hře skryté, takže
--      dostanou jen yieldPotential + soilType z farmland.soilDistribution (zdarma).
--      Tím scanner nemarní native volání a stíhá refresh vlastních polí v TTL.
function DashboardExport:pfPickTarget()
    if g_farmlandManager == nil or g_farmlandManager.farmlands == nil then return nil end
    local now = (g_currentMission and g_currentMission.time) or 0
    local currentFarmId = getFarmId()
    local mapping = (g_fieldManager and g_fieldManager.farmlandIdFieldMapping) or {}
    local pick, pickExpires = nil, math.huge
    for _, fl in pairs(g_farmlandManager.farmlands) do
        if fl and fl.id then
            local ownerId = fl.farmId or fl.ownerFarmId or 0
            local cached = self.pfCache[fl.id]
            local exp = cached and cached.expiresAt or 0
            if exp <= now and exp < pickExpires then
                pickExpires = exp
                pick = { farmlandId = fl.id, field = mapping[fl.id] or fl.field, farmland = fl,
                         owned = (ownerId == currentFarmId) }
            end
        end
    end
    return pick
end

function DashboardExport:pfBeginScan(pick)
    local dist = pick.farmland and pick.farmland.soilDistribution
    local distList = {}
    if type(dist) == "table" then
        for i, frac in pairs(dist) do
            local idx = tonumber(i) or 0
            if idx > 0 and type(frac) == "number" and frac > 0 then
                table.insert(distList, { idx = idx, frac = frac })
            end
        end
    end

    -- Bodové N/pH/soilType sondy jen pro VLASTNÍ pole — cizí parcely mají N/pH
    -- ve hře skryté, takže se spokojí s yieldPotential+soilType z distribuce.
    local points = {}
    local field = pick.field
    if pick.owned and field and field.posX and field.posZ then
        local r = math.min(40, math.max(8, math.sqrt((field.areaHa or 0) * 10000) / 4))
        points = {
            { field.posX,     field.posZ },
            { field.posX + r, field.posZ },
            { field.posX - r, field.posZ },
            { field.posX,     field.posZ + r },
            { field.posX,     field.posZ - r },
        }
    end

    self.pfScanState = {
        farmlandId    = pick.farmlandId,
        field         = field,
        owned         = pick.owned,
        distList      = distList,
        distCursor    = 1,
        points        = points,
        pointCursor   = 1,
        pointSubphase = 1,   -- 1=soilType, 2=nitrogen, 3=pH
        domIdx = 0, domFrac = 0, wYield = 0,
        nSum = 0, phSum = 0, cnt = 0,
        soilCounts = {},
        phase = "dist",
        out = {},
    }
end

-- Provede přesně JEDNU native operaci (max 1 cross-mod density-map call) a
-- posune stavový automat o krok dál. Volat opakovaně, dokud phase == "done".
function DashboardExport:pfStep(pf)
    local st = self.pfScanState

    if st.phase == "dist" then
        if st.distCursor <= #st.distList then
            local e = st.distList[st.distCursor]
            local yp = safeCall(function() return pf.soilMap:getYieldPotentialBySoilTypeIndex(e.idx) end) or 1
            st.wYield = st.wYield + yp * e.frac
            if e.frac > st.domFrac then st.domFrac = e.frac; st.domIdx = e.idx end
            st.distCursor = st.distCursor + 1
        end
        if st.distCursor > #st.distList then st.phase = "points" end

    elseif st.phase == "points" then
        if st.pointCursor > #st.points then
            st.phase = "target"
        else
            local p = st.points[st.pointCursor]
            if st.pointSubphase == 1 then
                local sIdx = safeCall(function() return pf.soilMap:getTypeIndexAtWorldPos(p[1], p[2]) end) or 0
                if sIdx > 0 then
                    st.soilCounts[sIdx] = (st.soilCounts[sIdx] or 0) + 1
                    st.pointSubphase = 2
                else
                    st.pointCursor = st.pointCursor + 1
                end
            elseif st.pointSubphase == 2 then
                st.nSum = st.nSum + (safeCall(function() return pf.nitrogenMap:getLevelAtWorldPos(p[1], p[2]) end) or 0)
                st.pointSubphase = 3
            else
                st.phSum = st.phSum + (safeCall(function() return pf.pHMap:getLevelAtWorldPos(p[1], p[2]) end) or 0)
                st.cnt = st.cnt + 1
                st.pointCursor = st.pointCursor + 1
                st.pointSubphase = 1
            end
        end

    elseif st.phase == "target" then
        -- sampled odvozen z bodových sond: getTypeIndexAtWorldPos vrací 0 na
        -- nevzorkovaném poli, takže cnt>0 == pole je (aspoň v sondách) vzorkované.
        -- Cizí pole mají prázdné points → cnt==0 → sampled=0 (N/pH stejně skryté).
        st.out.sampled = (st.cnt > 0) and 1 or 0
        if st.cnt > 0 then
            local bIdx, bCnt = 0, 0
            for i, c in pairs(st.soilCounts) do
                if c > bCnt then bIdx, bCnt = i, c end
            end
            if bIdx > 0 then st.domIdx = bIdx end   -- vzorkovaná realita přebíjí distribuci
            st.out.nitrogenActual = round2(safeCall(function()
                return pf.nitrogenMap:getNitrogenValueFromInternalValue(st.nSum / st.cnt) end) or 0)
            st.out.phActual = round2(safeCall(function()
                return pf.pHMap:getPhValueFromInternalValue(st.phSum / st.cnt) end) or 0)
            -- getTargetLevelAtWorldPos vrací interní stav → převod na kg N/ha
            local nTarget = safeCall(function()
                local internal = pf.nitrogenMap:getTargetLevelAtWorldPos(st.field.posX, st.field.posZ)
                return (internal and internal > 0)
                    and pf.nitrogenMap:getNitrogenValueFromInternalValue(internal) or 0
            end) or 0
            if nTarget > 0 then st.out.nitrogenTarget = round2(nTarget) end
        end
        st.phase = "soiltype"

    elseif st.phase == "soiltype" then
        if st.domIdx > 0 then
            local soilSt = pf.soilMap.soilTypes and pf.soilMap.soilTypes[st.domIdx]
            st.out.soilTypeIndex = st.domIdx
            st.out.soilType = (soilSt and pfText(soilSt.name or soilSt.title)) or tostring(st.domIdx)
            -- getOptimalPHValueForSoilTypeIndex vrací interní stav → převod na pH
            local phT = safeCall(function()
                local internal = pf.pHMap:getOptimalPHValueForSoilTypeIndex(st.domIdx)
                return (internal and internal > 0)
                    and pf.pHMap:getPhValueFromInternalValue(internal) or 0
            end) or 0
            if phT > 0 then st.out.phTarget = round2(phT) end
        end
        if st.wYield > 0 then st.out.yieldPotential = round2(st.wYield) end
        st.phase = "done"
    end
end

function DashboardExport:tickPFScan()
    local pf = pfHandle()
    if not pf then return end

    if not self.pfScanState then
        local pick = self:pfPickTarget()
        if not pick then return end
        self:pfBeginScan(pick)
    end

    -- Per-step timing: pfStep dělá max 1 native call. Cover fáze (~300ms) je
    -- zrušená; nejdražší zbývající krok je bodová N/pH sonda (~15-20ms). Log
    -- s názvem fáze ukáže, kdyby přesto něco přeteklo 50ms.
    local stepPhase    = self.pfScanState.phase
    local stepFarmland = self.pfScanState.farmlandId
    local t0 = getTimeSec()
    self:pfStep(pf)
    local stepMs = (getTimeSec() - t0) * 1000
    if stepMs > 50 then
        Logging.info(string.format("[%s] PERF pfStep phase=%s farmland=%s took=%.1fms",
            self.MOD_NAME, tostring(stepPhase), tostring(stepFarmland), stepMs))
    end

    local st = self.pfScanState
    if st.phase == "done" then
        local now = (g_currentMission and g_currentMission.time) or 0
        self.pfCache[st.farmlandId] = {
            data = st.out,
            expiresAt = now + (st.owned and self.PF_TTL_OWNED or self.PF_TTL_OTHER),
        }
        self.pfScanState = nil
    end
end

-- Čistě čtení z cache — žádný cross-mod call, žádné riziko frame hitchu.
-- Data doplňuje/obnovuje tickPFScan() na pozadí (viz update()).
function DashboardExport:getFieldPF(farmlandId, field, farmland, owned)
    if not pfHandle() then return nil end
    local cached = self.pfCache[farmlandId]
    return cached and cached.data or nil
end

-- Top-level katalog půdních typů pro legendu/UI. Session-statický (PF mod se
-- nemůže objevit ani zmizet za běhu savu) — počítá se jen jednou.
function DashboardExport:collectPFMeta()
    if self.pfMetaCache then return self.pfMetaCache end
    local pf = pfHandle()
    if not pf then
        self.pfMetaCache = { active = false }
        return self.pfMetaCache
    end
    local meta = { active = true }
    local types = {}
    local soilTypes = pf.soilMap and pf.soilMap.soilTypes
    if type(soilTypes) == "table" then
        for i, st in ipairs(soilTypes) do
            table.insert(types, {
                index = i,
                name = pfText(st.name or st.title or tostring(i)),
                yieldPotential = safeCall(function()
                    return pf.soilMap:getYieldPotentialBySoilTypeIndex(i) end) or 1,
            })
        end
    end
    if #types > 0 then
        meta.soilTypes = types
        self.pfMetaCache = meta  -- cache only once soilMap is fully initialized
    end
    return meta
end

function DashboardExport:buildFieldRecord(farmlandId, field, ownerFarmId, currentFarmId, farmland)
    if field == nil then return nil end

    local owned = (ownerFarmId == currentFarmId)

    -- Two distinct measurements:
    --   area           = cultivable field area (FS25 "field" — used for yield,
    --                    seed cost, profit calc; this is what matters for farming)
    --   farmlandAreaHa = parcel area as shown in the in-game "Zemědělská půda"
    --                    popup (whole parcel incl. grass/forest/yard). Surfaced
    --                    as a tooltip in the dashboard for cross-reference.
    local area = field.areaHa or 0
    if area > 100 then area = area / 10000 end       -- m² → ha if needed
    area = round2(area)

    local farmlandAreaHa = nil
    if farmland then
        if farmland.areaInHa and farmland.areaInHa > 0 then
            farmlandAreaHa = round2(farmland.areaInHa)
        elseif farmland.totalFieldArea and farmland.totalFieldArea > 0 then
            farmlandAreaHa = round2(farmland.totalFieldArea / 10000)
        end
    end

    local fruitTypeIndex, growthState = self:getFieldFruit(field, farmlandId, owned)
    local plannedIdx = field.plannedFruitTypeIndex or 0

    local fruitTypeId, fruitName = "", ""
    -- Denominator for the "X/Y" growth-phase display: the state at which the
    -- crop is harvest-ready. `numGrowthStates` also counts the cut/withered
    -- sentinel states, so using it as max produces nonsense like "7/5" once
    -- the field is harvested — see isCut/isWithered branches below.
    local maxGrowth   = 0
    local growthPct   = 0
    local isReady     = false
    local isCut       = false
    local isWithered  = false
    local daysToHarvest = 0

    if fruitTypeIndex and fruitTypeIndex > 0 and g_fruitTypeManager then
        local ft = g_fruitTypeManager:getFruitTypeByIndex(fruitTypeIndex)
        if ft ~= nil then
            fruitTypeId = ft.name or ""
            fruitName   = (ft.fillType and (ft.fillType.title or ft.fillType.name)) or ft.title or ft.name or ""
            maxGrowth   = ft.maxHarvestingGrowthState or ((ft.numGrowthStates or 7) - 1)

            -- Classify the raw density-map state. cutState / witheredState are
            -- sentinel values outside the growing range and must not feed the
            -- growth-percentage math (would yield >100%, capped to 99%).
            local witheredCheck = ft.getIsWithered and ft:getIsWithered(growthState)
            local isCutState    = (ft.cutStates and ft.cutStates[growthState]) or (growthState == ft.cutState and growthState > 0)

            if witheredCheck then
                isWithered = true
            elseif ft.getIsHarvestReady and ft:getIsHarvestReady(growthState) then
                isReady   = true
                growthPct = 100
            elseif isCutState then
                isCut = true
            else
                local startState = ft.minHarvestingGrowthState or 5
                if startState > 0 then
                    growthPct = math.min(99, math.floor(growthState / startState * 100))
                end
                daysToHarvest = math.max(0, (ft.minHarvestingGrowthState or 5) - growthState)
            end
        end
    end

    local plannedFruit = ""
    if plannedIdx > 0 and g_fruitTypeManager then
        local pft = g_fruitTypeManager:getFruitTypeByIndex(plannedIdx)
        if pft then plannedFruit = pft.name or "" end
    end

    -- Outline goes to the geometry file keyed by the same id the record carries,
    -- not into the record itself — see GEOMETRY_FILE.
    self:recordGeometry(farmlandId, self:getFieldPolygon(field))

    local cond = self:collectFieldStatus(farmlandId, field)
    -- "Needs sowing" reflects the physical state of the field: owned, no crop
    -- currently growing on the density map. `plannedFruitTypeIndex` is FS25's
    -- intent flag (set after harvest or by manual choice) and is independent —
    -- we surface it separately as `plannedFruit` so the UI can hint at the
    -- next-planned crop without suppressing the yellow "needs sowing" bar.
    local needsSowing = owned and (fruitTypeIndex == nil or fruitTypeIndex <= 0)

    return {
        id               = farmlandId,                            -- match game UI "Zemědělská půda" number
        farmlandId       = farmlandId,
        area             = area,
        farmlandAreaHa   = farmlandAreaHa,
        -- Purchase price of the parcel, straight off the farmland object (the
        -- same field the in-game land-buy screen shows). Present on owned
        -- parcels too, where it reads as the sale value. 0/absent means the map
        -- doesn't sell this one.
        farmlandPrice    = farmland and farmland.price and round0(farmland.price) or 0,
        -- World coords for the Live Map, rounded to whole metres — the field's
        -- own outline is already stored that way (collectFieldPolygon), so
        -- centimetre precision on the centroid was both inconsistent and the
        -- most expensive number shape to encode (%.4f + a trailing-zero gsub,
        -- twice per field).
        -- Guarded: round0(nil) would return 0 and drop the marker in the middle
        -- of the map instead of leaving the key absent.
        posX             = field.posX and round0(field.posX) or nil,
        posZ             = field.posZ and round0(field.posZ) or nil,

        owned            = owned,
        fruitTypeId      = fruitTypeId,
        fruitName        = fruitName,
        growthState      = growthState,
        maxGrowthState   = maxGrowth,
        growthPercent    = growthPct,
        isReadyToHarvest = isReady,
        isCut            = isCut,
        isWithered       = isWithered,
        daysToHarvest    = daysToHarvest,
        needsSowing      = needsSowing,
        plannedFruit     = plannedFruit,
        needsPlowing       = cond.needsPlowing,
        needsCultivating   = cond.needsCultivating,
        needsLime          = cond.needsLime,
        fertilizationLevel = cond.fertilizationLevel,
        weedLevel          = cond.weedLevel,
        stoneLevel         = cond.stoneLevel,
        pf                 = self:getFieldPF(farmlandId, field, farmland, owned),
    }
end

-- Field records carry a lot of "nothing to report" — an unowned or parcel-only
-- field sends false/0/"" for most of the condition block. Measured on a live
-- 179-field payload that was 49 013 B of 146 KB (34 %) spent restating
-- defaults. Dropping them here is what STRIP_DEFAULTS below undoes on the
-- server, so the shape the frontend sees is unchanged.
--
-- Values are matched by identity (`==`), so a real 0 that happens to equal the
-- default is dropped too — which is exactly the point: the server puts the same
-- 0 back. Anything absent from this table is always sent.
local FIELD_DEFAULTS = {
    fruitTypeId        = "",
    fruitName          = "",
    growthState        = 0,
    maxGrowthState     = 0,
    growthPercent      = 0,
    isReadyToHarvest   = false,
    isCut              = false,
    isWithered         = false,
    daysToHarvest      = 0,
    needsSowing        = false,
    plannedFruit       = "",
    needsPlowing       = false,
    needsCultivating   = false,
    needsLime          = false,
    fertilizationLevel = 0,
    weedLevel          = 0,
    stoneLevel         = 0,
    owned              = false,
    farmlandPrice      = 0,
    -- NOT isParcelOnly: it is only ever set (to true) on parcel-only records and
    -- absent everywhere else, so listing it would save nothing while making the
    -- server add `false` to records that never carried the key.
}

local function stripFieldDefaults(rec)
    for k, default in pairs(FIELD_DEFAULTS) do
        if rec[k] == default then rec[k] = nil end
    end
    return rec
end

-- Field shape for the Live Map. Preferred source is `field.densityMapPolygon`
-- (pointsX/pointsZ arrays, already in world space) — the same source the LiveMap
-- Companion mod uses; it is the engine's own field outline, so it matches the
-- in-game map exactly and needs no I3D node walk. Fallback to `field.polygonPoints`
-- (I3D scene nodes → getWorldTranslation) for anything without a densityMapPolygon.
-- Geometry is STATIC — computed once per field and cached. Coords rounded to whole
-- metres to keep the JSON payload small. See knowledge/fs25-field-boundary-geometry.md.
function DashboardExport:collectFieldPolygon(field)
    if field == nil then return nil end
    local raw = {}
    local usedFallback = false

    local dmp = field.densityMapPolygon
    if type(dmp) == "table" and type(dmp.pointsX) == "table" and type(dmp.pointsZ) == "table" then
        for i, x in ipairs(dmp.pointsX) do
            local z = dmp.pointsZ[i]
            if type(x) == "number" and type(z) == "number" then
                raw[#raw + 1] = { x, z }
            end
        end
    end

    if #raw < 3 then   -- no densityMapPolygon (or too few points): fall back to I3D nodes
        usedFallback = true
        raw = {}
        local points = field.polygonPoints
        if points == nil and field.getPolygonPoints then
            points = safeCall(function() return field:getPolygonPoints() end)
        end
        if type(points) == "table" then
            for _, node in ipairs(points) do
                if type(node) == "number" and node ~= 0 then
                    local x, _, z = getWorldTranslation(node)
                    raw[#raw + 1] = { x, z }
                end
            end
        end
    end

    local n = #raw
    if n < 3 then return nil end

    -- DIAG: record which source produced this polygon (logged once by collectFields)
    if usedFallback then
        self._polySrcFallback = (self._polySrcFallback or 0) + 1
    else
        self._polySrcDMP = (self._polySrcDMP or 0) + 1
    end

    -- Simplify: FS25 outlines carry 100+ vertices; ~4 m tolerance keeps the
    -- shape but cuts the JSON payload by ~5×. Endpoints of the ring are always
    -- kept; DP fills in the significant vertices between them.
    local keep = { [1] = true, [n] = true }
    dpSimplify(raw, 16, 1, n, keep)   -- tol² = 4 m²·… (16 = 4 m)
    local out = {}
    for i = 1, n do
        if keep[i] then out[#out + 1] = { round0(raw[i][1]), round0(raw[i][2]) } end
    end
    if #out < 3 then return nil end
    return out
end

-- Keyed by the field object itself, not by an id: collectFields() reaches here
-- twice with different id spaces — farmland.id on the farmland walk, the field
-- number on the fallback walk — and those two overlap, so an id key hands one
-- field another field's outline. The field reference is unambiguous.
function DashboardExport:getFieldPolygon(field)
    if field == nil then return nil end
    self.fieldPolyCache = self.fieldPolyCache or {}
    local cached = self.fieldPolyCache[field]
    if cached ~= nil then return cached or nil end   -- `false` = computed, no polygon

    -- Budgeted: a map with 90+ fields would otherwise build every outline in
    -- the first export's frame. Whatever doesn't fit arrives in a later export.
    if (self._fieldPolyBudget or 0) <= 0 then return nil end
    self._fieldPolyBudget = self._fieldPolyBudget - 1

    local poly = safeCall(function() return self:collectFieldPolygon(field) end) or false
    self.fieldPolyCache[field] = poly
    return poly or nil
end

-- ─────────────────────────────────────────────────────────────────────────────
-- Farmland parcel outlines — parcels WITHOUT a cultivable field (meadow/forest/
-- unused) have no field.polygonPoints; their shape lives only in the farmland
-- bit-vector info layer. Scan it ONCE (static per map, cached forever), bucket
-- grid cells per farmlandId, then trace each parcel's outline from its pixel
-- edge segments. Downsampled for speed; DP smooths the stair-step. World
-- transform matches field polygons (terrain-centred). See research in
-- knowledge/fs25-field-boundary-geometry.md.
-- ─────────────────────────────────────────────────────────────────────────────
local FL_KEYMUL = 100000   -- grid-cell / vertex packing multiplier (grid dim < this)

-- Phase A — sample the farmland bit-vector into one cell set per parcel.
-- At ~512² effective resolution that is a quarter-million engine reads: far too
-- much for a single frame on a large map, so it walks row by row under a
-- millisecond budget and resumes on the next tick. `flScan` carries the cursor;
-- `farmlandScanDone` flips once the last row is in (or the map is unavailable,
-- so callers stop waiting on it).
function DashboardExport:tickFarmlandScan(budgetMs)
    if self.farmlandScanDone then return end

    local st = self.flScan
    if st == nil then
        st = { z = 0 }
        self.flScan = st
        self.farmlandMasks = {}
        local fm = g_farmlandManager
        local map = fm and getBitVectorMapPoint
            and ((fm.getLocalMap and safeCall(function() return fm:getLocalMap() end)) or fm.localMap)
        local W, H = fm and fm.localMapWidth, fm and fm.localMapHeight
        if map and (not W or not H) and getBitVectorMapSize then
            local a, b = getBitVectorMapSize(map)
            W = W or a; H = H or b
        end
        if not (map and W and H and W > 0 and H > 0) then
            self.farmlandScanDone = true   -- nothing to scan; parcels stay outline-less
            self.flScan = nil
            return
        end
        st.map  = map
        st.bits = fm.numberOfBits
            or (getBitVectorMapNumChannels and getBitVectorMapNumChannels(map)) or 8
        st.notBuyable = FarmlandManager and FarmlandManager.NOT_BUYABLE_FARM_ID
        self.flMapW, self.flMapH = W, H
        self.flStep = math.max(1, math.floor(W / 512))
        self.flTs   = (g_currentMission and g_currentMission.terrainSize) or 2048
    end

    local masks, step = self.farmlandMasks, self.flStep
    local W, H = self.flMapW, self.flMapH
    local map, bits, notBuyable = st.map, st.bits, st.notBuyable
    local t0 = getTimeSec()
    while st.z < H do
        local gz = math.floor(st.z / step)
        for x = 0, W - 1, step do
            local id = getBitVectorMapPoint(map, x, st.z, 0, bits)
            if id and id > 0 and id ~= notBuyable then
                local m = masks[id]
                if not m then m = {}; masks[id] = m end
                m[math.floor(x / step) * FL_KEYMUL + gz] = true
            end
        end
        st.z = st.z + step
        if (getTimeSec() - t0) * 1000 >= budgetMs then return end
    end

    self.farmlandScanDone = true
    self.flScan = nil
end

-- Phase B — turn queued parcels into outlines, again under a budget. One trace
-- is normally well under a millisecond, but a fragmented parcel can be much
-- worse, so the budget is checked after every one.
function DashboardExport:tickFarmlandTrace(budgetMs)
    local q = self.flTraceQueue
    if q == nil then return end
    self.farmlandPolyCache = self.farmlandPolyCache or {}
    local t0 = getTimeSec()
    while #q > 0 do
        local id = table.remove(q, 1)
        self.flTraceQueued[id] = nil
        local m = self.farmlandMasks and self.farmlandMasks[id]
        self.farmlandPolyCache[id] = (m and safeCall(function() return self:traceMaskOutline(m) end)) or false
        self.geomParcels = (self.geomParcels or 0) + 1
        if (getTimeSec() - t0) * 1000 >= budgetMs then return end
    end
end

-- Driven every frame from update(): scan first, then trace. Idle until an export
-- actually asks for a parcel outline, so maps with no parcel-only farmland never
-- pay. Runs per-frame rather than per-scan-chunk because a sub-millisecond slice
-- 60× a second finishes the whole job in seconds, where the same total work
-- taken in bigger bites every 500 ms would drag on for half a minute.
function DashboardExport:tickMapGeometry(budgetMs)
    local q = self.flTraceQueue
    if q == nil or #q == 0 then return end

    local t0 = getTimeSec()
    if not self.farmlandScanDone then
        self:tickFarmlandScan(budgetMs)
    else
        self:tickFarmlandTrace(budgetMs)
    end
    self.geomMsTotal = (self.geomMsTotal or 0) + (getTimeSec() - t0) * 1000
    self.geomFrames  = (self.geomFrames or 0) + 1

    if #q == 0 and self.farmlandScanDone and not self.geomLogged then
        self.geomLogged = true
        Logging.info(string.format("[%s] live-map geometry ready — %d parcel outlines, %.0f ms spread over %d frames",
            self.MOD_NAME, self.geomParcels or 0, self.geomMsTotal, self.geomFrames or 0))
    end
end

-- Trace a cell-set into its outer ring: emit CW boundary edges (a cell side is
-- boundary iff the neighbour across it is outside), then chain them.
function DashboardExport:traceMaskOutline(cells)
    local nextV = {}
    for key in pairs(cells) do
        local gx = math.floor(key / FL_KEYMUL)
        local gz = key - gx * FL_KEYMUL
        if not cells[gx * FL_KEYMUL + (gz - 1)] then nextV[gx * FL_KEYMUL + gz]           = (gx + 1) * FL_KEYMUL + gz       end -- top   L→R
        if not cells[(gx + 1) * FL_KEYMUL + gz] then nextV[(gx + 1) * FL_KEYMUL + gz]     = (gx + 1) * FL_KEYMUL + (gz + 1) end -- right T→B
        if not cells[gx * FL_KEYMUL + (gz + 1)] then nextV[(gx + 1) * FL_KEYMUL + (gz + 1)] = gx * FL_KEYMUL + (gz + 1)     end -- bot   R→L
        if not cells[(gx - 1) * FL_KEYMUL + gz] then nextV[gx * FL_KEYMUL + (gz + 1)]     = gx * FL_KEYMUL + gz             end -- left  B→T
    end
    local start
    for v in pairs(nextV) do start = v; break end
    if not start then return nil end
    -- Stop on ANY revisited vertex, not just on `start`. Where a parcel pinches
    -- to a diagonal touch, one vertex carries two outgoing edges and the second
    -- write wins, so the chain can enter a loop that never passes through
    -- `start` again. Watching only `start` let those run to the guard, and since
    -- dpSimplify below is O(n²), a 50k-vertex ring cost over a second — this was
    -- measured at ~1.2 s per parcel. Bounding by "already seen" caps the ring at
    -- the real number of boundary vertices (~150 for a typical parcel).
    local ring, v, seen = {}, start, {}
    repeat
        seen[v] = true
        local vx = math.floor(v / FL_KEYMUL)
        ring[#ring + 1] = { vx, v - vx * FL_KEYMUL }
        v = nextV[v]
    until v == nil or seen[v]
    if #ring < 3 then return nil end

    local step, W, H, ts = self.flStep, self.flMapW, self.flMapH, self.flTs
    local f = ts / W
    local raw = {}
    for _, p in ipairs(ring) do
        raw[#raw + 1] = { (p[1] * step - W * 0.5) * f, (p[2] * step - H * 0.5) * f }
    end
    local n = #raw
    local keep = { [1] = true, [n] = true }
    dpSimplify(raw, 25, 1, n, keep)   -- ~5 m tolerance
    local out = {}
    for i = 1, n do if keep[i] then out[#out + 1] = { round0(raw[i][1]), round0(raw[i][2]) } end end
    if #out < 3 then return nil end
    return out
end

-- Non-blocking: hand back the outline if it is ready, otherwise queue it and
-- return nil. tickMapGeometry() fills it in over the following ticks and a
-- later export carries it — the alternative was scanning the whole bit-vector
-- and tracing every parcel inside one frame.
function DashboardExport:getFarmlandPoly(id)
    self.farmlandPolyCache = self.farmlandPolyCache or {}
    local cached = self.farmlandPolyCache[id]
    if cached ~= nil then return cached or nil end

    self.flTraceQueue   = self.flTraceQueue or {}
    self.flTraceQueued  = self.flTraceQueued or {}
    if not self.flTraceQueued[id] then
        self.flTraceQueued[id] = true
        self.flTraceQueue[#self.flTraceQueue + 1] = id
    end
    return nil
end

-- Collect an outline under the same id the field/parcel record carries, so the
-- server can join the two without knowing how either id was derived.
function DashboardExport:recordGeometry(id, poly)
    if poly == nil or id == nil then return end
    self.geomPolys = self.geomPolys or {}
    if self.geomPolys[id] == nil then
        self.geomPolys[id] = poly
        self.geometryWritten = false   -- something new to publish
    end
end

-- Write the outline file once the whole set is built. "Built" means two things
-- are quiet: no field outline consumed budget this export (so they are all
-- cached) and the parcel trace queue has drained.
function DashboardExport:maybeWriteGeometry()
    if self.geometryWritten then return end
    if self.geomPolys == nil then return end
    if (self._fieldPolyBudget or 0) < self.FIELD_POLY_PER_EXPORT then return end
    if self.flTraceQueue ~= nil and #self.flTraceQueue > 0 then return end
    if not self.farmlandScanDone then return end

    -- Keys must be strings: encodeJson's object branch skips non-string keys
    -- outright, and a gap-free set of numeric ids would encode as an ARRAY and
    -- lose the ids entirely. Both failure modes are silent.
    local out, n = {}, 0
    for id, poly in pairs(self.geomPolys) do
        out[tostring(id)] = poly
        n = n + 1
    end
    if n == 0 then return end

    local t0 = getTimeSec()
    local json = encodeJson({ count = n, polys = out })
    local f = io.open(self.GEOMETRY_FILE, "w")
    if f == nil then return end   -- retry next export
    f:write(json)
    f:close()
    self.geometryWritten = true
    Logging.info(string.format("[%s] map geometry written — %d outlines, %.0f ms (one-off, not in the 2 s payload)",
        self.MOD_NAME, n, (getTimeSec() - t0) * 1000))
end

function DashboardExport:collectFields()
    local out = {}
    if g_farmlandManager == nil or g_farmlandManager.farmlands == nil then return out end

    local currentFarmId = getFarmId()
    local mapping = (g_fieldManager and g_fieldManager.farmlandIdFieldMapping) or {}
    local seen = {}
    local seenFields = {}   -- field objects already emitted (by reference)
    self._fieldPolyBudget = self.FIELD_POLY_PER_EXPORT
    -- field object → the id its record was emitted under. Contracts hold a
    -- direct field reference but no id, and the two id spaces here (farmland id
    -- vs field number) mean there is no way to derive it afterwards.
    self.fieldIdByRef = {}

    -- Primary: walk farmlands, look up field via FieldManager's official mapping.
    -- For owned farmlands with no field (meadow/yard), still emit a stub so they
    -- appear in the dashboard.
    for _, farmland in pairs(g_farmlandManager.farmlands) do
        if farmland and farmland.id and not seen[farmland.id] then
            local field   = mapping[farmland.id] or farmland.field
            local ownerId = farmland.farmId or farmland.ownerFarmId or 0
            if field ~= nil then
                local rec = self:buildFieldRecord(farmland.id, field, ownerId, currentFarmId, farmland)
                if rec then
                    out[#out + 1] = rec
                    seen[farmland.id] = true
                    seenFields[field] = true
                    self.fieldIdByRef[field] = farmland.id
                end
            else
                -- Parcel with no cultivable field (meadow/forest/unused). The
                -- in-game PDA map still draws it, so emit it with its outline
                -- traced from the farmland bit-vector and its parcel centroid.
                -- `isParcelOnly` lets field tables filter these out while the
                -- map still shows them.
                self:recordGeometry(farmland.id, self:getFarmlandPoly(farmland.id))

                local area = 0
                if farmland.areaInHa and farmland.areaInHa > 0 then
                    area = round2(farmland.areaInHa)
                elseif farmland.totalFieldArea and farmland.totalFieldArea > 0 then
                    area = round2(farmland.totalFieldArea / 10000)
                end
                out[#out + 1] = {
                    id                 = farmland.id,
                    farmlandId         = farmland.id,
                    posX               = round0(farmland.xWorldPos or 0),
                    posZ               = round0(farmland.zWorldPos or 0),
                    area               = area,
                    farmlandAreaHa     = area,    -- no field → both are the same
                    farmlandPrice      = farmland.price and round0(farmland.price) or 0,
                    owned              = (ownerId == currentFarmId),
                    isParcelOnly       = true,
                    fruitTypeId        = "",
                    fruitName          = "",
                    growthState        = 0,
                    maxGrowthState     = 0,
                    growthPercent      = 0,
                    isReadyToHarvest   = false,
                    isCut              = false,
                    isWithered         = false,
                    daysToHarvest      = 0,
                    needsSowing        = false,
                    plannedFruit       = "",
                    needsPlowing       = false,
                    needsCultivating   = false,
                    needsLime          = false,
                    fertilizationLevel = 0,
                    weedLevel          = 0,
                    stoneLevel         = 0,
                    pf                 = self:getFieldPF(farmland.id, nil, farmland, ownerId == currentFarmId),
                }
                seen[farmland.id] = true
            end
        end
    end

    -- Fill in every remaining field. The in-game PDA map numbers *fields*
    -- (g_fieldManager.fields is 1-indexed by field number), and some fields —
    -- unowned/peripheral ones without their own farmland — are missed by the
    -- farmland walk above. Emit them keyed by field number so the map's field
    -- count matches the game. `seenFields` skips fields already emitted (by
    -- reference), so a field owned via a farmland keeps its farmland id.
    if g_fieldManager and g_fieldManager.fields then
        for fieldNo, field in pairs(g_fieldManager.fields) do
            if field ~= nil and not seenFields[field] then
                local fl = field.farmland
                local ownerId = (fl and (fl.farmId or fl.ownerFarmId)) or 0
                local rec = self:buildFieldRecord(fieldNo, field, ownerId, currentFarmId, fl)
                if rec then
                    out[#out + 1] = rec
                    seenFields[field] = true
                    self.fieldIdByRef[field] = fieldNo
                end
            end
        end
    end


    table.sort(out, function(a, b) return (a.id or 0) < (b.id or 0) end)

    -- DIAG (once): report which source the cultivable-field outlines came from —
    -- densityMapPolygon (preferred) vs the polygonPoints I3D fallback. Waits for
    -- an export that spent none of its budget: that is the first one where every
    -- outline was already cached, so the counts are final.
    if not self._polySrcLogged
        and self._fieldPolyBudget == self.FIELD_POLY_PER_EXPORT
        and ((self._polySrcDMP or 0) + (self._polySrcFallback or 0)) > 0 then
        self._polySrcLogged = true
        Logging.info(string.format("[%s][DIAG] field outline source: densityMapPolygon=%d fallback(polygonPoints)=%d",
            self.MOD_NAME, self._polySrcDMP or 0, self._polySrcFallback or 0))
    end

    return out
end

-- ─────────────────────────────────────────────────────────────────────────────
-- Vehicles — name, type, hours, fuel, AdBlue, in-use
-- ─────────────────────────────────────────────────────────────────────────────

-- Recognise fuel-like fillTypes by name (engine consumables)
local FUEL_FILLTYPES = {
    DIESEL        = true,
    GASOLINE      = true,
    METHANE       = true,
    ELECTRICCHARGE = true,
    HYDROGEN      = true,
}

-- Store title je pro daný configFileName neměnný — cache napořád (false = "bez titulku")
local storeTitleCache = {}

local function vehicleStoreTitle(v)
    if not (v.configFileName and g_storeManager and g_storeManager.getItemByXMLFilename) then return nil end
    local hit = storeTitleCache[v.configFileName]
    if hit ~= nil then return hit or nil end

    local title = nil
    local item = safeCall(g_storeManager.getItemByXMLFilename, g_storeManager, v.configFileName)
    if item then
        local brand = ""
        if item.brandIndex and g_brandManager and g_brandManager.getBrandByIndex then
            local b = safeCall(g_brandManager.getBrandByIndex, g_brandManager, item.brandIndex)
            if b then brand = b.title or b.name or "" end
        end
        -- "None" / "NONE" is FS25's sentinel for no-brand items; treat as no brand
        if brand == "None" or brand == "NONE" then brand = "" end
        local model = item.name or item.shopTitle or ""
        if brand ~= "" and model ~= "" then
            title = brand .. " " .. model
        elseif model ~= "" then
            title = model
        end
    end
    storeTitleCache[v.configFileName] = title or false
    return title
end

-- ─── Implements / fillUnit ──────────────────────────────────────────────────
-- For each vehicle we surface its attached implements that *carry something*
-- (trailers, harvester body, seeders, sprayers). Tools without storage (plows,
-- cultivators) get filtered out via `capacity > 100 L`.
--
-- See knowledge/fs25-implements-fillunits.md for source-of-truth API refs.

-- "Is this fillUnit real storage worth showing?"
-- Just capacity > 100 L. Anything bigger than a plow's LIME pseudo-tank
-- is a real bin (trailer / harvester body / seed hopper / sprayer tank).
-- We deliberately do NOT require showOnHud or a populated supportedFill-
-- Types table — many implement mods omit those, and we'd rather show an
-- empty grass pickup wagon (label = "—", level = 0 / 50t) than hide it.
local function isStorageFillUnit(unit)
    return (unit.capacity or 0) > 100
end

-- Resolve a display label for the unit's current contents. Falls back
-- through: current fillType → last carried type → "EMPTY" (frontend
-- renders that as an em-dash). We deliberately do NOT guess from
-- supportedFillTypes: tanks that support many types (front-loader
-- buckets, pickup wagons, multi-purpose trailers) would pick an
-- arbitrary one (e.g. WHEAT for a bucket that could hold anything).
-- The implement's own name already conveys what bin it is — the label
-- only needs to say what's currently in it, or that it's empty.
-- Module-scope (dřív vnitřní closure resolveFillTypeLabel — alokovala se
-- při každém volání, tj. per fillUnit napříč vehicles i implements).
-- fillType index → descriptor, memoized. The mapping is session-static (fill
-- types come from the loaded map/mods and cannot change while a save runs), but
-- every lookup used to be a pcall into the engine — and lookups run per fillUnit
-- per allowed fillType, which for a multi-purpose tank is dozens per vehicle per
-- export. `false` caches a known miss. Cleared in deleteMap.
local fillTypeDescCache = {}

local function fillTypeDesc(idx)
    if not (idx and idx ~= 0 and g_fillTypeManager) then return nil end
    local hit = fillTypeDescCache[idx]
    if hit ~= nil then return hit or nil end
    local ft = safeCall(g_fillTypeManager.getFillTypeByIndex, g_fillTypeManager, idx)
    fillTypeDescCache[idx] = ft or false
    return ft
end

local function fillTypeLabelLookup(idx)
    local ft = fillTypeDesc(idx)
    if ft and ft.name and ft.name ~= "" and ft.name ~= "UNKNOWN" then
        return ft.name, (ft.title and ft.title ~= "Unknown") and ft.title or ft.name
    end
    return nil, nil
end

local function resolveFillTypeLabel(unit)
    local n, t = fillTypeLabelLookup(unit.fillType or 0)
    if n then return n, t end
    n, t = fillTypeLabelLookup(unit.lastValidFillType or 0)
    if n then return n, t end
    return "EMPTY", "—"
end

local function getImplementFillUnits(impl)
    local obj = impl.object
    if not (obj and obj.spec_fillUnit and obj.spec_fillUnit.fillUnits) then return nil end
    local result = {}
    for _, unit in ipairs(obj.spec_fillUnit.fillUnits) do
        if isStorageFillUnit(unit) then
            local ftName, ftTitle = resolveFillTypeLabel(unit)
            table.insert(result, {
                fillType  = ftName,
                typeTitle = ftTitle,
                levelL    = math.floor(unit.fillLevel or 0),
                capacityL = math.floor(unit.capacity or 0),
                percent   = pctOf(unit.fillLevel or 0, unit.capacity or 0),
            })
        end
    end
    return #result > 0 and result or nil
end

-- A self-propelled machine carries its STORAGE in its own fill units alongside
-- the fuel/DEF units (a combine's grain tank, a self-propelled sprayer's tank).
-- collectImplements only walks ATTACHED implements, so those tanks were never
-- surfaced — a combine showed no fill. Collect them here, excluding fuel/DEF
-- (those are already shown as the fuel bar).
local function fillTypeName(idx)
    local ft = fillTypeDesc(idx)
    return ft and ft.name or nil
end

local function isFuelOrDefUnit(unit)
    local n = fillTypeName(unit.lastValidFillType)
    if n then return FUEL_FILLTYPES[n] or n == "DEF" end
    -- No current contents — inspect the allowed set. A pure fuel/DEF tank
    -- allows only fuel/DEF types; a crop/liquid tank allows other types too.
    if type(unit.fillTypes) == "table" then
        local sawAny, sawNonFuel = false, false
        for idx in pairs(unit.fillTypes) do
            local nm = fillTypeName(idx)
            if nm then
                sawAny = true
                if not (FUEL_FILLTYPES[nm] or nm == "DEF") then sawNonFuel = true end
            end
        end
        if sawAny and not sawNonFuel then return true end
    end
    return false
end

local function getVehicleStorageFillUnits(v)
    if not (v.spec_fillUnit and v.spec_fillUnit.fillUnits) then return nil end
    local result = {}
    for _, unit in ipairs(v.spec_fillUnit.fillUnits) do
        if isStorageFillUnit(unit) and not isFuelOrDefUnit(unit) then
            local ftName, ftTitle = resolveFillTypeLabel(unit)
            table.insert(result, {
                fillType  = ftName,
                typeTitle = ftTitle,
                levelL    = math.floor(unit.fillLevel or 0),
                capacityL = math.floor(unit.capacity or 0),
                percent   = pctOf(unit.fillLevel or 0, unit.capacity or 0),
            })
        end
    end
    return #result > 0 and result or nil
end

local function collectImplements(vehicle, depth)
    depth = depth or 0
    if depth > 3 then return {} end                      -- anti-loop guard
    if not (vehicle and vehicle.getAttachedImplements) then return {} end
    local result = {}
    for _, impl in pairs(safeCall(vehicle.getAttachedImplements, vehicle) or {}) do
        if impl.object then
            local fillUnits = getImplementFillUnits(impl)
            if fillUnits then
                table.insert(result, {
                    name      = (impl.object.getName and safeCall(function() return impl.object:getName() end)) or "",
                    fillUnits = fillUnits,
                })
            end
            -- Recurse: trailer-with-trailer, header on combine, etc.
            local sub = collectImplements(impl.object, depth + 1)
            for _, s in ipairs(sub) do result[#result + 1] = s end
        end
    end
    return result
end

-- ─── AI task detection ──────────────────────────────────────────────────────
-- Three sources, in priority order — first one that says "active" wins:
--   1. AutoDrive   — richest data (ETA + waypoint progress + destinations)
--   2. Courseplay  — fieldwork progress 0..1 (nil during drive-to)
--   3. Vanilla AI  — job class name + helper name; no progress / ETA
--
-- Each helper returns nil if its mod isn't installed or the vehicle has no
-- active task — so the caller can fall through cleanly without crashes.
-- See src/Dashboard/docs/RESEARCH-NEXT.md (Bod 1) for the source-of-truth
-- field paths and gotchas.

local function getVanillaAITask(v)
    local spec = v.spec_aiJobVehicle
    if spec == nil or spec.job == nil then return nil end
    -- Some jobs expose `isRunning`; ignore the brief window between stop
    -- and `aiJobFinished` where job is still non-nil but already done.
    if spec.job.isRunning ~= nil and not spec.job.isRunning then return nil end

    local jobType = nil
    if g_currentMission and g_currentMission.aiJobTypeManager then
        jobType = safeCall(function()
            return g_currentMission.aiJobTypeManager:getJobTypeByIndex(spec.job.jobTypeIndex)
        end)
    end
    local helperName
    if spec.job.getHelperName then
        helperName = safeCall(function() return spec.job:getHelperName() end)
    end
    return {
        source    = "vanilla",
        jobClass  = (jobType and jobType.name) or "AIJob",
        helper    = helperName,
        taskIndex = spec.job.currentTaskIndex,   -- 1 = driving to field, 2 = working
    }
end

local function getCourseplayTask(v)
    -- CP injects methods on the vehicle metatable at load time. If CP isn't
    -- installed, these are simply nil — guard everything.
    if v.getIsCpActive == nil then return nil end
    local active = safeCall(function() return v:getIsCpActive() end)
    if not active then return nil end

    local progress = nil
    if v.getCpFieldWorkProgress then
        local p = safeCall(function() return v:getCpFieldWorkProgress() end)
        if p ~= nil then progress = math.floor(p * 100 + 0.5) end
    end
    local hasCourse = false
    if v.hasCpCourse then
        hasCourse = safeCall(function() return v:hasCpCourse() end) or false
    end

    -- Remaining time. CP keeps a preformatted string ("1h 29min" / "12min")
    -- on its CpStatus instance — synced to clients via streamReadString, so
    -- it's safe to read here. Pipeline:
    --   CpRemainingTime.lua → AIDriveStrategyFieldWorkCourse:setWaypointData()
    --   → CpStatus.remainingTimeText → :getTimeRemainingText().
    local remainingText, currentWp, totalWps = nil, nil, nil
    if v.getCpStatus then
        local status = safeCall(function() return v:getCpStatus() end)
        if status then
            if status.getTimeRemainingText then
                local t = safeCall(function() return status:getTimeRemainingText() end)
                if t ~= nil and t ~= "" then remainingText = t end
            end
            -- Waypoint indices (also on CpStatus) — fallback progress source
            currentWp = status.currentWaypointIx
            totalWps  = status.numberOfWaypoints
        end
    end

    return {
        source         = "courseplay",
        jobClass       = "Courseplay",
        progress       = progress,         -- 0..100 or nil during drive-to phase
        remainingText  = remainingText,    -- preformatted string from CpStatus
        currentWp      = currentWp,
        totalWps       = totalWps,
        hasCourse      = hasCourse,
    }
end

local function getAutoDriveTask(v)
    if not (v.ad and v.ad.stateModule) then return nil end
    local sm = v.ad.stateModule
    local active = safeCall(function() return sm:isActive() end)
    if not active then return nil end

    local mode = sm.getMode      and safeCall(function() return sm:getMode() end) or nil
    local dest1 = sm.getFirstMarkerName  and safeCall(function() return sm:getFirstMarkerName()  end) or nil
    local dest2 = sm.getSecondMarkerName and safeCall(function() return sm:getSecondMarkerName() end) or nil
    local remainSec = sm.getRemainingDriveTime
                      and safeCall(function() return sm:getRemainingDriveTime() end) or nil

    -- Waypoint progress: pcall directly (safeCall drops 2nd return).
    local progress
    if v.ad.drivePathModule and v.ad.drivePathModule.getWayPoints then
        local ok, wps, wpIdx = pcall(function() return v.ad.drivePathModule:getWayPoints() end)
        if ok and type(wps) == "table" and wpIdx and #wps > 0 then
            progress = math.floor(wpIdx / #wps * 100 + 0.5)
        end
    end

    -- Compose a single human-friendly destination string.
    local destination
    if dest1 and dest2 then destination = dest1 .. " → " .. dest2
    elseif dest1 then        destination = dest1
    elseif dest2 then        destination = dest2 end

    return {
        source      = "autodrive",
        jobClass    = "AutoDrive",
        mode        = mode,           -- 1=DRIVETO, 2=PICKUPANDDELIVER, 3=DELIVERTO, 4=LOAD, 5=UNLOAD, 6=BGA
        destination = destination,
        etaSeconds  = (remainSec and remainSec > 0) and remainSec or nil,
        progress    = progress,
    }
end

local function getAITask(v)
    return getAutoDriveTask(v) or getCourseplayTask(v) or getVanillaAITask(v)
end

-- Local player world position + heading, for the Live Map. Falls back to the
-- vehicle the player is currently driving (own position is frozen/stale while
-- seated). See knowledge/fs25-player-vehicle-position-api.md.
function DashboardExport:collectPlayer()
    local player = g_localPlayer
    if player == nil then return nil end

    if player.getIsInVehicle and safeCall(player.getIsInVehicle, player) then
        local v = safeCall(player.getCurrentVehicle, player)
        if v and v.rootNode then
            local vx, _, vz = getWorldTranslation(v.rootNode)
            local _, headingRad, _ = getWorldRotation(v.rootNode)
            return { x = round2(vx), z = round2(vz), headingDeg = headingFromYaw(headingRad) }
        end
        return nil
    end

    -- getWorldTranslation always returns exactly 3 values (x, y, z) — unlike
    -- player:getPosition(), whose return arity turned out to be unreliable
    -- (runtime-observed to silently drop z via Lua multi-return truncation).
    if player.rootNode == nil then return nil end
    local x, _, z = getWorldTranslation(player.rootNode)

    -- Prefer getYaw() — the character rotates via a separate camera/root node,
    -- so getWorldRotation(rootNode) is not a reliable heading source.
    local yaw = (player.getYaw and safeCall(player.getYaw, player)) or 0
    return { x = round2(x), z = round2(z), headingDeg = headingFromYaw(yaw) }
end

-- ─────────────────────────────────────────────────────────────────────────────
-- Fast position channel
--
-- Positions are the only thing in the payload that changes every frame; crops,
-- silos, prices and the rest move on a scale of minutes. Exporting all of it
-- fast enough to look live would mean paying the full ~10 ms encode several
-- times a second, so positions get their own tiny file on a short period while
-- the main export stays at 2 s. Keys are one letter — this is rewritten four
-- times a second and every byte is encode work.
-- ─────────────────────────────────────────────────────────────────────────────
-- ─────────────────────────────────────────────────────────────────────────────
-- AI routes for the Live Map
--
-- Two sources, both handing out world coordinates:
--   AutoDrive  — v.ad.drivePathModule:getWayPoints() → {x=,z=} list + current ix
--                (DrivePathModule.lua:384)
--   Courseplay — v:getFieldWorkCourse() → Course, :getWaypointPosition(ix) → x,y,z
--                (Course.lua:495)
-- Vanilla AI has neither: its path is computed while driving and never exists
-- as a list, so helper jobs get no route line.
--
-- A route only changes when a vehicle is given a new job, so the simplified
-- geometry is cached per vehicle. `routeMeta` is the cheap identity check that
-- decides whether to rebuild — a fieldwork course can hold thousands of
-- waypoints and reading them all every tick would cost more than the positions.
-- ─────────────────────────────────────────────────────────────────────────────
local ROUTE_TOL2 = 9   -- 3 m; finer than that is invisible at map scale

local function simplifyPath(pts)
    local n = #pts
    local out = {}
    if n <= 2 then
        for i = 1, n do out[i] = { round0(pts[i][1]), round0(pts[i][2]) } end
        return out
    end
    local keep = { [1] = true, [n] = true }
    dpSimplify(pts, ROUTE_TOL2, 1, n, keep)
    for i = 1, n do
        if keep[i] then out[#out + 1] = { round0(pts[i][1]), round0(pts[i][2]) } end
    end
    return out
end

-- Returns src, count, currentIx, signature, handle — where `handle` is whatever
-- the full read needs later (the waypoint table for AD, the Course for CP).
function DashboardExport:routeMeta(v)
    if v.ad and v.ad.drivePathModule and v.ad.drivePathModule.getWayPoints then
        local ok, wps, idx = pcall(function() return v.ad.drivePathModule:getWayPoints() end)
        if ok and type(wps) == "table" and #wps >= 2 and wps[1] and wps[1].x then
            return "ad", #wps, idx or 1,
                string.format("ad|%d|%d|%d", #wps, round0(wps[1].x), round0(wps[#wps].x or 0)), wps
        end
    end
    if v.getFieldWorkCourse then
        local course = safeCall(v.getFieldWorkCourse, v)
        if course and course.getNumberOfWaypoints then
            local n = safeCall(course.getNumberOfWaypoints, course) or 0
            if n >= 2 then
                local x1 = safeCall(course.getWaypointPosition, course, 1) or 0
                local xn = safeCall(course.getWaypointPosition, course, n) or 0
                local cur = (course.getCurrentWaypointIx
                    and safeCall(course.getCurrentWaypointIx, course)) or 1
                return "cp", n, cur, string.format("cp|%d|%d|%d", n, round0(x1), round0(xn)), course
            end
        end
    end
    return nil
end

function DashboardExport:routePoints(src, handle, n)
    if src == "ad" then
        local pts = {}
        for i = 1, #handle do
            local w = handle[i]
            if w and w.x and w.z then pts[#pts + 1] = { w.x, w.z } end
        end
        return pts
    end
    return safeCall(function()
        local pts = {}
        for i = 1, n do
            local x, _, z = handle:getWaypointPosition(i)
            if x and z then pts[#pts + 1] = { x, z } end
        end
        return pts
    end) or {}
end

function DashboardExport:collectRoutes()
    if not (g_currentMission and g_currentMission.vehicleSystem) then return nil end
    self.routeCache = self.routeCache or {}
    local farmId = getFarmId()
    local out = {}

    for _, v in pairs(g_currentMission.vehicleSystem.vehicles or {}) do
        if v and v.rootNode then
            local ownerId = ownerFarmId(v)
            if ownerId == farmId then
                local src, n, cur, sig, handle = self:routeMeta(v)
                if src ~= nil then
                    local name = (v.getName and v:getName()) or ""
                    local c = self.routeCache[name]
                    if c == nil or c.sig ~= sig then
                        c = { sig = sig, p = simplifyPath(self:routePoints(src, handle, n)) }
                        self.routeCache[name] = c
                    end
                    if #c.p >= 2 then
                        out[#out + 1] = {
                            v = name,
                            s = src,
                            f = round2(math.max(0, math.min(1, cur / n))),   -- fraction driven
                            p = c.p,
                        }
                    end
                end
            end
        end
    end
    return #out > 0 and out or nil
end

function DashboardExport:writePositions()
    if not (g_currentMission and g_currentMission.vehicleSystem) then return end

    local out = { vehicles = {} }
    local p = self:collectPlayer()
    if p then out.player = { x = p.x, z = p.z, h = p.headingDeg } end

    local farmId = getFarmId()
    local list = out.vehicles
    for _, v in pairs(g_currentMission.vehicleSystem.vehicles or {}) do
        -- Same gate as collectVehicles, so the map never shows a marker the
        -- vehicle table doesn't list.
        local hasRealMotor = v and v.spec_motorized and v.spec_motorized.motor ~= nil
        if hasRealMotor and v.spec_drivable ~= nil and v.rootNode then
            local ownerId = ownerFarmId(v)
            if ownerId == farmId then
                local vx, _, vz = getWorldTranslation(v.rootNode)
                local _, yaw, _ = getWorldRotation(v.rootNode)
                list[#list + 1] = {
                    n = (v.getName and v:getName()) or "",
                    x = round2(vx), z = round2(vz), h = headingFromYaw(yaw),
                }
            end
        end
    end
    if #list == 0 then out.vehicles = emptyArray() end

    -- Routes ride along every 8th frame (~2 s). They change only on a new job,
    -- so sending them at the full 4 Hz would be hundreds of points of pure
    -- repetition; always emitting the key on those frames (even empty) is what
    -- lets the client clear a route once a job ends.
    self.posFrame = (self.posFrame or 0) + 1
    if self.posFrame % 8 == 0 then
        out.routes = self:collectRoutes() or emptyArray()
    end

    -- FS25 has no socket/HTTP API for mods — a file the server watches is the
    -- only channel out. `io.open`/write/close is a synchronous call on the game
    -- thread though, so skip it entirely when nothing actually moved (parked
    -- vehicle, player AFK at a menu): most of a play session is exactly that,
    -- and this is the one part of the channel we CAN cut. Building `out` still
    -- costs the same; only the disk write (and the server's watcher wake-up)
    -- is avoided.
    local json = encodeJson(out)
    if json == self.lastPosJson then return end

    local t0 = getTimeSec()
    local f = io.open(self.POSITIONS_FILE, "w")
    if f == nil then return end
    f:write(json)
    f:close()
    self.lastPosJson = json

    if not self.posLogged then
        self.posLogged = true
        Logging.info(string.format("[%s] position channel live — %d vehicles, %.1f ms per write, every %d ms",
            self.MOD_NAME, #list, (getTimeSec() - t0) * 1000, self.POSITION_PERIOD))
    end
end

function DashboardExport:collectVehicles()
    local out = {}
    if not (g_currentMission and g_currentMission.vehicleSystem) then return out end
    local farmId = getFarmId()

    for _, v in pairs(g_currentMission.vehicleSystem.vehicles or {}) do
        -- Cheap spec checks BEFORE the owner lookup: ownerFarmId() may pcall
        -- into the engine, and it used to run for every vehicle on the map only
        -- for most of them to fail these two plain field tests. writePositions
        -- already gates in this order.
        --
        -- Require a real driveable vehicle (excludes rest-station placeables that have
        -- vestigial spec_motorized but no driving cockpit). Wheelbarrows etc. ARE drivable
        -- and stay in the list (with fuelCapacity=0) — that's fine, user can hide them in UI.
        local hasRealMotor = v and v.spec_motorized and v.spec_motorized.motor ~= nil
        local isDrivable   = v and v.spec_drivable ~= nil
        if hasRealMotor and isDrivable and ownerFarmId(v) == farmId then
            local rec = {
                name        = v.getName and v:getName() or "",
                typeName    = vehicleStoreTitle(v) or (v.typeName and tostring(v.typeName)) or "",
                motorHours  = 0,
                fuelCapacity = 0,
                fuelLiters   = 0,
                fuelPercent  = 0,
                isInUse      = false,
            }

            if v.spec_wearable and v.spec_wearable.operatingTime then
                rec.motorHours = round2(v.spec_wearable.operatingTime / 60 / 60 / 1000)
            end

            -- Fuel detection: walk fillUnits, match by fillType.name (FS25 canonical).
            -- A unit's currently-loaded fillType is in lastValidFillType; if unset, scan its
            -- fillTypes table (allowed types) for a fuel match.
            if v.spec_fillUnit and v.spec_fillUnit.fillUnits then
                for _, unit in pairs(v.spec_fillUnit.fillUnits) do
                    -- fillTypeName (module scope, ř. výše) vrací canonical ft.name
                    -- ("DIESEL"…) — dřív zde stála identická closure `nameOf`
                    -- alokovaná per fillUnit per vozidlo.
                    local matchedName = fillTypeName(unit.lastValidFillType)
                    if matchedName == nil and type(unit.fillTypes) == "table" then
                        for idx, _ in pairs(unit.fillTypes) do
                            local n = fillTypeName(idx)
                            if n and (FUEL_FILLTYPES[n] or n == "DEF") then matchedName = n; break end
                        end
                    end

                    if matchedName and FUEL_FILLTYPES[matchedName] then
                        rec.fuelCapacity = math.floor(unit.capacity or 0)
                        rec.fuelLiters   = math.floor(unit.fillLevel or 0)
                        rec.fuelType     = matchedName
                    elseif matchedName == "DEF" then
                        rec.adBlueCapacity = math.floor(unit.capacity or 0)
                        rec.adBluePercent  = pctOf(unit.fillLevel or 0, unit.capacity or 0)
                    end
                end
            end
            rec.fuelPercent = pctOf(rec.fuelLiters, rec.fuelCapacity)

            -- Pull in AI / Courseplay / AutoDrive state (nil if vehicle idle)
            rec.aiTask = getAITask(v)

            -- Attached implements with storage (trailers / harvesters / seeders).
            -- Tools without capacity (plows etc.) are filtered inside the helper.
            local impls = collectImplements(v) or {}
            -- The machine's OWN storage tank (combine grain tank, sprayer tank)
            -- comes first, named after the vehicle so the frontend shows just
            -- the fill (e.g. "Pšenice 45%") without repeating the name.
            local ownTanks = getVehicleStorageFillUnits(v)
            if ownTanks then table.insert(impls, 1, { name = rec.name, fillUnits = ownTanks }) end
            if #impls > 0 then rec.implements = impls end

            -- Current speed in km/h (getLastSpeed already returns km/h, NOT m/ms).
            -- See knowledge/vehicle-damage-speed-api.md.
            local speedKmh = 0
            if v.getLastSpeed then
                speedKmh = math.floor((safeCall(v.getLastSpeed, v) or 0) + 0.5)
            end
            rec.speedKmh = speedKmh

            -- Condition % = (1 - damage) * 100. getDamageAmount() is 0..1 damage;
            -- the menu shows condition, which is the inverse. Guard for vehicles
            -- without the wearable spec.
            if v.spec_wearable and v.getDamageAmount then
                local dmg = safeCall(v.getDamageAmount, v)
                if type(dmg) == "number" then
                    rec.conditionPercent = math.floor((1 - dmg) * 100 + 0.5)
                end
            end

            -- in-use: AI active, controlled by player, or moving. Note:
            -- spec_aiVehicle was the FS22 path; FS25 uses spec_aiJobVehicle.
            rec.isInUse = (rec.aiTask ~= nil)
                       or (v == g_currentMission.controlledVehicle)
                       or (speedKmh > 0)
                       or false

            -- World position + heading for the Live Map. Always via rootNode —
            -- vehicles have no getWorldTranslation() method of their own.
            -- See knowledge/fs25-player-vehicle-position-api.md.
            if v.rootNode then
                local vx, _, vz = getWorldTranslation(v.rootNode)
                local _, headingRad, _ = getWorldRotation(v.rootNode)
                rec.x = round2(vx)
                rec.z = round2(vz)
                rec.headingDeg = headingFromYaw(headingRad)
            end

            out[#out + 1] = rec
        end
    end

    return out
end

-- ─────────────────────────────────────────────────────────────────────────────
-- Animals (husbandries) — count, productivity, food/water/straw/milk/manure
-- ─────────────────────────────────────────────────────────────────────────────

local function fillPctFromHusbandry(placeable, getter, fillType)
    local lvl = placeable[getter] and placeable[getter](placeable, fillType) or 0
    local capGetter = getter:gsub("FillLevel", "Capacity")
    local cap = placeable[capGetter] and placeable[capGetter](placeable, fillType) or 0
    return pctOf(lvl, cap)
end

-- Animal type / subtype localization. FS25 has no canonical `ui_animal_*` i18n
-- keys — `g_i18n:getText` returns `"Missing 'X' in l10n_*.xml"` for everything
-- we tried. The animal-system XML stores titles in storeItem / category, not
-- as a simple per-type lookup. We just emit the enum name (`at.name`) and the
-- dashboard frontend has a Czech mapping (COW → Kráva, …) — cleaner separation.
local function localizeAnimalName(at)
    if not at then return "" end
    if at.fillType and (at.fillType.title or at.fillType.name) then
        return at.fillType.title or at.fillType.name
    end
    return at.title or at.name or ""
end

-- Returns (level, capacity, percent). Returns nil tuple if spec/getter missing.
local function fillReading(placeable, fillType)
    if not (placeable and fillType and placeable.getHusbandryFillLevel) then return nil end
    local lvl = safeCall(function() return placeable:getHusbandryFillLevel(fillType) end) or 0
    local cap = safeCall(function() return placeable:getHusbandryCapacity(fillType) end) or 0
    return math.floor(lvl), math.floor(cap), pctOf(lvl, cap)
end

-- One pass over the placeable list per export, bucketed by the spec each
-- consumer cares about. The list used to be walked three times (animals,
-- storages, prices), and each walk resolved the owner farm id through a pcall
-- for every placeable on the map — several hundred redundant pcalls per export.
--
-- The ownership tests are deliberately NOT unified: collectAnimals matched
-- `ownerId == farmId` while isOwnedBy() also required `ownerId > 0`. getFarmId()
-- can return 0 (`x or 1` keeps a literal 0, since 0 is truthy in Lua), and in
-- that case the two rules genuinely disagree. Selling stations are unfiltered —
-- prices are public.
function DashboardExport:collectPlaceableBuckets()
    local buckets = { husbandry = {}, storage = {}, selling = {}, production = {} }
    local ps = g_currentMission and g_currentMission.placeableSystem
    if not (ps and ps.placeables) then return buckets end
    local farmId = getFarmId()

    for _, p in pairs(ps.placeables) do
        if p then
            if p.spec_sellingStation then
                buckets.selling[#buckets.selling + 1] = p
            end
            local ownerId = ownerFarmId(p)
            if ownerId == farmId then
                if p.spec_husbandryAnimals then
                    buckets.husbandry[#buckets.husbandry + 1] = p
                end
                if ownerId > 0 then
                    -- A placeable carries exactly one storage spec in practice.
                    if p.spec_silo then
                        buckets.storage[#buckets.storage + 1] = { p = p, kind = "silo" }
                    elseif p.spec_bunkerSilo then
                        buckets.storage[#buckets.storage + 1] = { p = p, kind = "bunker" }
                    elseif p.spec_objectStorage then
                        buckets.storage[#buckets.storage + 1] = { p = p, kind = "object" }
                    end
                    if p.spec_productionPoint then
                        buckets.production[#buckets.production + 1] = p
                    end
                end
            end
        end
    end
    return buckets
end

function DashboardExport:collectAnimals(buckets)
    local out = {}

    for _, placeable in ipairs(buckets.husbandry) do
        local spec = placeable.spec_husbandryAnimals
        -- waterPercent etc. intentionally omitted from defaults — only present when
        -- the corresponding spec exists. Pigs/sheep don't have water; frontend hides
        -- the badge when the property is missing.
        local rec = {
            husbandryName       = placeable.getName and placeable:getName() or "",
            type                = nil,
            typeTitle           = nil,
            count               = 0,
            maxCount            = 0,
            productivity        = 0,
            foodPercent         = 0,
            clusters            = emptyArray(),
        }

        -- Animal type: enum name (COW, PIG, ...) + localized title (Kráva, Prase, ...)
        if spec.animalTypeIndex and g_currentMission.animalSystem then
            local at = safeCall(function() return g_currentMission.animalSystem:getTypeByIndex(spec.animalTypeIndex) end)
            if at then
                rec.type = at.name
                rec.typeTitle = localizeAnimalName(at)
            end
        end

        -- Capacity
        if spec.getMaxNumOfAnimals then
            rec.maxCount = safeCall(function() return spec:getMaxNumOfAnimals() end) or 0
        end

        -- Cluster details — per-subtype breakdown for the detail view
        if spec.clusterSystem then
            local clusters = safeCall(function() return spec.clusterSystem:getClusters() end) or {}
            local total, healthSum, n = 0, 0, 0
            local clusterList = {}
            for _, c in ipairs(clusters) do
                local subTypeName, subTypeTitle = "", ""
                local subType = nil
                if c.subTypeIndex and g_currentMission.animalSystem then
                    subType = safeCall(function() return g_currentMission.animalSystem:getSubTypeByIndex(c.subTypeIndex) end)
                    if subType then
                        subTypeName  = subType.name or ""
                        subTypeTitle = localizeAnimalName(subType)
                    end
                end

                -- Reproduction state — we want to tell the user *why* the
                -- reproduction counter is or isn't moving. Engine values:
                --   subType.supportsReproduction  → bool (some species can't breed at all)
                --   subType.reproductionMinAgeMonth, reproductionMinHealth
                --   cluster:getCanReproduce()      → bool, all gates passed right now
                --   cluster:getReproductionFactor()→ float, 0 = paused, >0 = active rate
                --   cluster.reproduction           → 0-100 progress counter
                local supportsRepro = subType and (subType.supportsReproduction ~= false) or false
                local minAge        = (subType and subType.reproductionMinAgeMonth) or 0
                local minHealth     = (subType and subType.reproductionMinHealth)   or 0
                local canRepro      = (c.getCanReproduce       and safeCall(function() return c:getCanReproduce()       end)) or false
                local repFactor     = (c.getReproductionFactor and safeCall(function() return c:getReproductionFactor() end)) or 0
                local reproPct      = math.floor((c.reproduction or 0) + 0.5)
                local age           = c.age or 0

                -- Derive a single status enum the frontend can render directly.
                --   unsupported — species/subtype doesn't reproduce at all
                --   young       — not old enough yet (waiting to mature)
                --   blocked     — old enough but engine says can't reproduce
                --                 (health too low, missing partner, manual-hold mod, …)
                --   ready       — at 100 %, birth imminent next tick
                --   cycling     — actively progressing toward 100 %
                --   paused      — gated by factor=0 (e.g. manual-reproduction mod)
                local status
                if not supportsRepro then
                    status = 'unsupported'
                elseif age < minAge then
                    status = 'young'
                elseif reproPct >= 100 then
                    status = 'ready'
                elseif not canRepro then
                    status = 'blocked'
                elseif repFactor <= 0 then
                    status = 'paused'
                else
                    status = 'cycling'
                end

                total = total + (c.numAnimals or 0)
                healthSum = healthSum + (c.health or 0)
                n = n + 1
                table.insert(clusterList, {
                    subType         = subTypeName,
                    subTypeTitle    = subTypeTitle,
                    count           = c.numAnimals or 0,
                    health          = math.floor((c.health or 0) + 0.5),
                    age             = age,
                    reproduction    = reproPct,
                    reproStatus     = status,
                    canReproduce    = canRepro,
                    reproFactor     = repFactor,
                    minAgeMonth     = minAge,
                    minHealth       = minHealth,
                    supportsRepro   = supportsRepro,
                    sellPrice       = (c.getSellPrice and math.floor(safeCall(function() return c:getSellPrice() end) or 0)) or 0,
                })
            end
            rec.count = total
            if n > 0 then rec.productivity = math.floor(healthSum / n + 0.5) end
            if #clusterList > 0 then rec.clusters = clusterList end

            -- Husbandry-level summary for the compact row:
            --   reproductionPercent — highest cluster %
            --   reproductionStatus  — "best" status across clusters, in priority
            --   ready > cycling > paused > blocked > young > unsupported
            -- so the badge reflects "the most promising cluster" rather than
            -- being dragged down by a single young/blocked one.
            local STATUS_RANK = { ready=5, cycling=4, paused=3, blocked=2, young=1, unsupported=0 }
            local maxRepro, bestStatus, bestRank = 0, 'unsupported', -1
            for _, c in ipairs(clusterList) do
                if c.reproduction and c.reproduction > maxRepro then maxRepro = c.reproduction end
                local r = STATUS_RANK[c.reproStatus] or -1
                if r > bestRank then bestRank = r; bestStatus = c.reproStatus end
            end
            rec.reproductionPercent = maxRepro
            rec.reproductionStatus  = bestStatus
        end

        -- Food (overall)
        if placeable.spec_husbandryFood and placeable.getTotalFood and placeable.getFoodCapacity then
            local f, c = safeCall(function() return placeable:getTotalFood() end) or 0,
                         safeCall(function() return placeable:getFoodCapacity() end) or 0
            rec.foodLiters   = math.floor(f)
            rec.foodCapacity = math.floor(c)
            rec.foodPercent  = pctOf(f, c)
        end

        -- Water — only when manually supplied (auto-water troughs hide the row).
        -- Some chow types (pigs, sheep, rabbits, chickens on this map) don't have
        -- spec_husbandryWater at all → no water badge in dashboard.
        local wSpec = placeable.spec_husbandryWater
        if wSpec and wSpec.fillType and not wSpec.automaticWaterSupply then
            local l, c, p = fillReading(placeable, wSpec.fillType)
            if l ~= nil and c and c > 0 then
                rec.waterLiters   = l
                rec.waterCapacity = c
                rec.waterPercent  = p
            end
        end

        -- Straw
        local sSpec = placeable.spec_husbandryStraw
        if sSpec and sSpec.inputFillType then
            local l, c, p = fillReading(placeable, sSpec.inputFillType)
            if l ~= nil then
                rec.strawLiters   = l
                rec.strawCapacity = c
                rec.strawPercent  = p
            end
        end

        -- Milk (max % across active fill types; report dominant fill type)
        local mSpec = placeable.spec_husbandryMilk
        if mSpec and mSpec.activeFillTypes then
            -- Sentinel -1 so the FIRST read always wins, even when the
            -- silo is empty (p == 0). The old `p > maxPct` started at 0
            -- and rejected empties, so milkCapacity stayed 0 and the
            -- detail modal hid the milk row entirely.
            local maxPct, maxLvl, maxCap, maxName = -1, 0, 0, ""
            for _, ft in pairs(mSpec.activeFillTypes) do
                local l, c, p = fillReading(placeable, ft)
                if p ~= nil and p >= maxPct then
                    maxPct, maxLvl, maxCap = p, l, c
                    local ftDesc = fillTypeDesc(ft)
                    maxName = (ftDesc and (ftDesc.title or ftDesc.name)) or ""
                end
            end
            if maxPct < 0 then maxPct = 0 end
            rec.milkPercent  = maxPct
            rec.milkLiters   = maxLvl
            rec.milkCapacity = maxCap
            rec.milkType     = maxName
        end

        -- Solid manure (heap)
        if placeable.spec_manureHeap and placeable.spec_manureHeap.manureHeap then
            local mh = placeable.spec_manureHeap.manureHeap
            local lvl = safeCall(function() return mh:getFillLevel(mh.fillTypeIndex) end) or 0
            local cap = safeCall(function() return mh:getCapacity(mh.fillTypeIndex) end) or 0
            rec.manureLiters   = math.floor(lvl)
            rec.manureCapacity = math.floor(cap)
            rec.manurePercent  = pctOf(lvl, cap)
        end

        -- Liquid manure
        local lmSpec = placeable.spec_husbandryLiquidManure
        if lmSpec and lmSpec.fillType then
            local l, c, p = fillReading(placeable, lmSpec.fillType)
            if l ~= nil then
                rec.liquidManureLiters   = l
                rec.liquidManureCapacity = c
                rec.liquidManurePercent  = p
            end
        end

        -- Pallet outputs (wool from sheep, eggs from poultry, goat milk from
        -- goats). Unlike milk, these are NOT a husbandry fill level — they
        -- spawn as physical pallets. spec_husbandryPallets has no getter; we
        -- read its tables directly: fillLevels = liters across pallets in the
        -- spawn trigger, pendingLiters = output not yet materialized into a
        -- pallet, capacities = maxNumPallets × palletCap. activeFillTypes is
        -- only populated while producing animals are present.
        --
        -- A combined sheep+goat barn has TWO active fill types at once (wool
        -- AND goat milk), so we emit ALL of them as an array — the old code
        -- kept only the highest-level one, which let goat milk (4 l) hide the
        -- wool (0 l) entirely.
        local pSpec = placeable.spec_husbandryPallets
        if pSpec and pSpec.activeFillTypes and #pSpec.activeFillTypes > 0 then
            local pallets = {}
            for _, ft in ipairs(pSpec.activeFillTypes) do
                local lvl = (pSpec.fillLevels and pSpec.fillLevels[ft] or 0)
                          + (pSpec.pendingLiters and pSpec.pendingLiters[ft] or 0)
                local cap = (pSpec.capacities and pSpec.capacities[ft]) or 0
                local ftDesc = fillTypeDesc(ft)
                table.insert(pallets, {
                    type     = (ftDesc and (ftDesc.title or ftDesc.name)) or "",
                    liters   = math.floor(lvl),
                    capacity = math.floor(cap),
                    percent  = pctOf(lvl, cap),
                })
            end
            if #pallets > 0 then
                rec.pallets = pallets
            end
        end

        out[#out + 1] = rec
    end

    return out
end

-- ─────────────────────────────────────────────────────────────────────────────
-- Storage — owned placeables that hold something:
--   • spec_silo            (běžná sila)
--   • spec_bunkerSilo      (silážní jáma)
--   • spec_objectStorage   (sklad balíků/palet)
--   • spec_productionPoint (produkce / kompostér — vstupy i výstupy)
-- ─────────────────────────────────────────────────────────────────────────────

-- Vrací human-readable title ("Pšenice") pro zobrazení skladu/produkce —
-- ODLIŠNÉ od fillTypeName (ř. 1374), která vrací canonical name ("WHEAT") pro
-- fuel matching. Dřív obě sdílely jméno a druhá stínila první, což bylo matoucí.
local function fillTypeTitle(fillType)
    local ftDesc = fillTypeDesc(fillType)
    return (ftDesc and (ftDesc.title or ftDesc.name)) or tostring(fillType)
end

local function collectSiloRec(placeable, farmId)
    local spec = placeable.spec_silo
    if not (spec and spec.loadingStation) then return nil end
    local rec = {
        type        = "silo",
        storageName = placeable.getName and placeable:getName() or "",
        items       = {},
    }
    local fills = safeCall(function() return spec.loadingStation:getAllFillLevels(farmId) end) or {}
    local capByType = {}
    for _, storage in pairs(safeCall(function() return spec.loadingStation:getSourceStorages() end) or {}) do
        if storage.capacities then
            for ft, cap in pairs(storage.capacities) do
                capByType[ft] = (capByType[ft] or 0) + cap
            end
        end
    end
    for fillType, level in pairs(fills) do
        if level and level > 0.1 then
            table.insert(rec.items, {
                name     = fillTypeTitle(fillType),
                amount   = math.floor(level),
                capacity = math.floor(capByType[fillType] or 0),
            })
        end
    end
    return rec
end

local function collectBunkerRec(placeable)
    local spec = placeable.spec_bunkerSilo
    local bs   = spec and spec.bunkerSilo
    if not bs then return nil end
    local rec = {
        type        = "bunkerSilo",
        storageName = placeable.getName and placeable:getName() or "Silážní jáma",
        items       = {},
    }
    local level = bs.fillLevel or 0
    -- po fermentaci výstup, jinak vstupní materiál
    local ft = (bs.state == 4 or bs.state == 3) and bs.outputFillType or bs.inputFillType
    if level > 0.1 and ft and ft > 0 then
        table.insert(rec.items, {
            name     = fillTypeTitle(ft),
            amount   = math.floor(level),
            capacity = 0,  -- bunker silo nemá pevnou kapacitu
        })
    end
    return rec
end

local function collectObjectStorageRec(placeable)
    local spec = placeable.spec_objectStorage
    if not spec then return nil end
    local rec = {
        type        = "objectStorage",
        storageName = placeable.getName and placeable:getName() or "Sklad",
        items       = {},
    }
    local cap   = spec.capacity or 0
    local total = spec.numStoredObjects or 0
    local infos = safeCall(function() return placeable:getObjectStorageObjectInfos() end) or {}
    if #infos > 0 then
        for _, info in ipairs(infos) do
            if (info.numObjects or 0) > 0 then
                -- Game UI uses objects[1]:getDialogText() — see PlaceableObjectStorage line 1037
                local name = "Objekt"
                local first = info.objects and info.objects[1]
                if first then
                    local title = first.getDialogText and safeCall(function() return first:getDialogText() end)
                    if type(title) == "string" and #title > 0 then
                        name = title
                    elseif first.fillType then
                        name = fillTypeTitle(first.fillType)
                    end
                end
                table.insert(rec.items, {
                    name     = name,
                    amount   = info.numObjects,
                    capacity = cap,
                })
            end
        end
    elseif total > 0 then
        table.insert(rec.items, {
            name     = "Objekty",
            amount   = total,
            capacity = cap,
        })
    end
    return rec
end

local function byItemName(a, b) return a.name < b.name end

function DashboardExport:collectStorages(buckets)
    local out = {}
    local farmId = getFarmId()

    -- The bucket pass already resolved ownership and which storage spec each
    -- placeable carries, so this only dispatches. safeCall takes varargs, so the
    -- collect*Rec calls need no wrapper closure either.
    for _, entry in ipairs(buckets.storage) do
        local placeable, kind = entry.p, entry.kind
        local rec
        if kind == "silo" then
            rec = safeCall(collectSiloRec, placeable, farmId)
        elseif kind == "bunker" then
            rec = safeCall(collectBunkerRec, placeable)
        else
            rec = safeCall(collectObjectStorageRec, placeable)
        end
        if rec then
            table.sort(rec.items, byItemName)
            if #rec.items == 0 then rec.items = emptyArray() end
            out[#out + 1] = rec
        end
    end
    return out
end

-- ─────────────────────────────────────────────────────────────────────────────
-- Productions — owned placeables with spec_productionPoint. Each has a unified
-- input/output storage plus a list of recipes (productions). We report stock,
-- recipe inputs/outputs, throughput and active state.
-- ─────────────────────────────────────────────────────────────────────────────

local PRODUCTION_STATUS = {
    [1] = "active",
    [2] = "inactive",
    [3] = "noInput",
    [4] = "outputFull",
}

local function productionStatusKey(pp, production)
    -- ProductionPoint.PROD_STATUS_ACTIVE / INACTIVE / NO_INPUT / OUTPUT_FULL = 1..4
    local code = safeCall(function() return pp:getProductionStatus(production.id) end)
    if type(code) == "number" then return PRODUCTION_STATUS[code] or "unknown" end
    -- Fallback: check active flag
    local active = safeCall(function() return pp:getIsProductionEnabled(production.id) end)
    if active then return "active" end
    return "inactive"
end

-- Build one production record from a ProductionPoint object. `nameHint` is
-- the owning placeable's display name (the pp itself may not have getName).
local function buildProductionRecord(pp, nameHint)
    local storage = pp and pp.storage
    if not storage then return nil end
    local rec = {
        name        = nameHint or (pp.getName and pp:getName()) or "Výrobna",
        items       = {},
        productions = {},
    }

    -- Stockpile (inputs + outputs share one storage)
    local fills = safeCall(function() return storage:getFillLevels() end) or {}
    for fillType, level in pairs(fills) do
        if level and level > 0.1 then
            local cap = safeCall(function() return storage:getCapacity(fillType) end) or 0
            table.insert(rec.items, {
                name     = fillTypeTitle(fillType),
                amount   = math.floor(level),
                capacity = math.floor(cap),
            })
        end
    end
    table.sort(rec.items, function(a, b) return a.name < b.name end)
    if #rec.items == 0 then rec.items = emptyArray() end

    -- Recipes
    for _, production in pairs(pp.productions or {}) do
        local r = {
            name          = production.name or production.id or "",
            status        = productionStatusKey(pp, production),
            cyclesPerHour = production.cyclesPerHour or 0,
            costsPerHour  = production.costsPerActiveHour or 0,
            inputs        = {},
            outputs       = {},
        }
        for _, inp in ipairs(production.inputs or {}) do
            table.insert(r.inputs, {
                name   = fillTypeTitle(inp.type or inp.fillTypeIndex or 0),
                amount = inp.amount or 0,
            })
        end
        for _, outp in ipairs(production.outputs or {}) do
            table.insert(r.outputs, {
                name   = fillTypeTitle(outp.type or outp.fillTypeIndex or 0),
                amount = outp.amount or 0,
            })
        end
        if #r.inputs  == 0 then r.inputs  = emptyArray() end
        if #r.outputs == 0 then r.outputs = emptyArray() end
        table.insert(rec.productions, r)
    end
    if #rec.productions == 0 then rec.productions = emptyArray() end
    return rec
end

-- Productions — all production points owned by the farm. Primary source is
-- g_currentMission.productionChainManager:getProductionPointsForFarmId() which
-- returns ProductionPoint objects directly and is NOT subject to the
-- placeable-ownership pitfall that hid all-but-one production (a production
-- with isFinalized=false has its pp owner overwritten to AccessHandler.EVERYONE
-- so the old isOwnedBy() placeable scan dropped it). See
-- knowledge/fs25-production-points.md. Falls back to the placeable scan when
-- the chain manager isn't available.
function DashboardExport:collectProductions(buckets)
    local out = {}
    local farmId = getFarmId()
    local pcm = g_currentMission and g_currentMission.productionChainManager

    if pcm and pcm.getProductionPointsForFarmId then
        local pps = safeCall(pcm.getProductionPointsForFarmId, pcm, farmId) or {}
        for _, pp in ipairs(pps) do
            local placeable = pp.owningPlaceable
            local nameHint  = placeable and placeable.getName and placeable:getName() or nil
            local rec = buildProductionRecord(pp, nameHint)
            if rec then out[#out + 1] = rec end
        end
        if self.DEBUG then
            Logging.info(string.format("[FS25_Dashboard][DIAG] productions via chainManager: %d", #out))
        end
        return out
    end

    -- Fallback: owned production placeables (older engine / chain manager
    -- missing), already filtered by the bucket pass.
    for _, placeable in ipairs(buckets.production) do
        local spec = placeable.spec_productionPoint
        local pp   = spec and spec.productionPoint
        if pp then
            local nameHint = placeable.getName and placeable:getName() or nil
            local rec = buildProductionRecord(pp, nameHint)
            if rec then out[#out + 1] = rec end
        end
    end
    return out
end

-- ─────────────────────────────────────────────────────────────────────────────
-- Prices — sellPoint, items[].pricePerTon
-- We walk selling stations on the map and report their current price per fillType
-- ─────────────────────────────────────────────────────────────────────────────

function DashboardExport:collectPrices(buckets)
    -- TTL cache: computePrices iteruje všechny sell-pointy × accepted fill types
    -- s native cenovými voláními. Ceny se v FS25 hýbou v řádu herních dnů, tak
    -- 2s refresh je zbytečně agresivní — stačí PRICES_TTL.
    local now = g_currentMission and g_currentMission.time or 0
    if self.pricesCache and self.pricesCache.expiresAt > now then
        return self.pricesCache.data
    end
    local out = self:computePrices(buckets)
    self.pricesCache = { data = out, expiresAt = now + self.PRICES_TTL }
    return out
end

function DashboardExport:computePrices(buckets)
    local out = {}

    for _, placeable in ipairs(buckets.selling) do
        local spec = placeable.spec_sellingStation
        local ss = spec and spec.sellingStation
        if ss then
            local rec = {
                sellPoint = placeable.getName and placeable:getName() or (ss.stationName or "Selling Station"),
                items     = {},
            }
            -- acceptedFillTypes is keyed by fillTypeIndex; fillTypePrices fallback same shape.
            local accepted = ss.acceptedFillTypes or ss.fillTypePrices
            if type(accepted) == "table" then
                for ftIdx, _ in pairs(accepted) do
                    if type(ftIdx) == "number" and ftIdx > 0 then
                        local price = safeCall(function() return ss:getEffectiveFillTypePrice(ftIdx) end)
                              or safeCall(function() return ss:getPriceMultiplier(ftIdx) and ss:getPriceMultiplier(ftIdx) * (g_fillTypeManager:getFillTypeByIndex(ftIdx).pricePerLiter or 0) end)
                        if price and price > 0 then
                            local ft = fillTypeDesc(ftIdx)
                            -- `or` only catches nil — 0 is truthy in Lua, and some
                            -- fill types really do carry massPerLiter = 0, which
                            -- divided by zero on every tick.
                            local massPerLiter = (ft and ft.massPerLiter) or 0
                            if massPerLiter <= 0 then massPerLiter = 0.001 end
                            local pricePerTon = price / massPerLiter
                            rec.items[#rec.items + 1] = {
                                name        = (ft and (ft.title or ft.name)) or tostring(ftIdx),
                                pricePerTon = math.floor(pricePerTon + 0.5),
                            }
                        end
                    end
                end
            end
            table.sort(rec.items, byItemName)
            if #rec.items > 0 then
                out[#out + 1] = rec
            end
        end
    end
    return out
end

-- ─────────────────────────────────────────────────────────────────────────────
-- Event detection (sowing / harvest) per field
-- ─────────────────────────────────────────────────────────────────────────────

function DashboardExport:detectFieldEvents(currentFields)
    local now = getDate and getDate("%Y-%m-%dT%H:%M:%S") or os.date("!%Y-%m-%dT%H:%M:%SZ")
    local gameDay = (g_currentMission and g_currentMission.environment and g_currentMission.environment.currentDay) or 0

    for _, f in ipairs(currentFields) do
        if f.owned then
            local prev = self.prevFields[f.id]
            if prev ~= nil then
                -- Sowing: previously empty fruit, now has fruit
                if (prev.fruitTypeId == "" or prev.fruitTypeId == nil) and f.fruitTypeId ~= "" then
                    table.insert(self.pendingEvents, {
                        timestamp = now,
                        gameDay   = gameDay,
                        fieldId   = f.id,
                        type      = "sowing",
                        fruitName = f.fruitName,
                        fruitTypeId = f.fruitTypeId,
                        area      = f.area,
                    })
                end
                -- Harvest: was ready, now empty/different
                if prev.isReady and (f.fruitTypeId == "" or f.fruitTypeId ~= prev.fruitTypeId) then
                    table.insert(self.pendingEvents, {
                        timestamp = now,
                        gameDay   = gameDay,
                        fieldId   = f.id,
                        type      = "harvest",
                        fruitName = prev.fruitName,
                        fruitTypeId = prev.fruitTypeId,
                        area      = f.area,
                        wasReady  = true,
                        growthAtHarvest = prev.growthState or 0,
                    })
                end
            end
            self.prevFields[f.id] = {
                fruitTypeId = f.fruitTypeId,
                fruitName   = f.fruitName,
                growthState = f.growthState,
                isReady     = f.isReadyToHarvest,
                area        = f.area,
            }
        end
    end
end

-- ─────────────────────────────────────────────────────────────────────────────
-- Map hotspots — stations/buildings the in-game map shows (selling points,
-- silos, shops, productions, animal pens, fuel). Positions come from each
-- placeable's own map hotspots (spec_hotspots.mapHotspots → worldX/worldZ), the
-- same source the LiveMap Companion mod uses. Near-static, so cache once.
-- ─────────────────────────────────────────────────────────────────────────────
function DashboardExport:placeableHotspotCategory(typeIndex)
    local T = PlaceableHotspot and PlaceableHotspot.TYPE
    if not T then return "other" end
    if typeIndex == T.PRODUCTION_POINT then return "production"
    elseif typeIndex == T.SHOP or typeIndex == T.SHOP_ANIMAL then return "shop"
    elseif typeIndex == T.FUEL then return "fuel"
    elseif typeIndex == T.UNLOADING or typeIndex == T.UNLOADING_TRAIN then return "sell"
    elseif typeIndex == T.LOADING then return "silo"
    elseif typeIndex == T.CHICKEN or typeIndex == T.PIG or typeIndex == T.SHEEP
        or typeIndex == T.COW or typeIndex == T.HORSE or typeIndex == T.BEE then return "animal"
    elseif typeIndex == T.FARM then return "farm"
    end
    return "other"
end

function DashboardExport:collectMapHotspots()
    if self.mapHotspotsCache ~= nil then return self.mapHotspotsCache end

    local out = {}
    local ps = g_currentMission and g_currentMission.placeableSystem
    if not (ps and ps.placeables) then return out end   -- not ready yet: don't cache

    for _, p in pairs(ps.placeables) do
        local spec = p.spec_hotspots
        local hotspots = spec and spec.mapHotspots
        if type(hotspots) == "table" then
            local name = (p.getName and safeCall(function() return p:getName() end)) or p.typeName or ""
            for _, h in pairs(hotspots) do
                local x, z = h.worldX, h.worldZ
                if type(x) == "number" and type(z) == "number" then
                    local cat = self:placeableHotspotCategory(h.placeableType)
                    if cat ~= "other" and cat ~= "farm" then   -- farm/other add clutter, skip
                        out[#out + 1] = { t = cat, x = round0(x), z = round0(z), name = tostring(name) }
                    end
                end
            end
        end
    end

    if #out > 0 then self.mapHotspotsCache = out end
    return out
end

-- ─────────────────────────────────────────────────────────────────────────────
-- Contracts (missions)
--
-- `g_missionManager.missions` holds every mission on the map — the ones offered
-- on the board as well as the ones a farm has taken on. A mission that has been
-- accepted carries the accepting `farmId`, which is the only filter needed to
-- get "my contracts". Field-work missions additionally hold a direct reference
-- to their field (AbstractFieldMission.field), resolved to a dashboard id via
-- fieldIdByRef built during collectFields.
-- See giantsDocu AbstractMission (58/566) + MissionManager (58/567).
-- ─────────────────────────────────────────────────────────────────────────────
function DashboardExport:collectContracts()
    local mm = g_missionManager
    if mm == nil then return nil end
    local missions = (mm.getMissions and safeCall(mm.getMissions, mm)) or mm.missions
    if type(missions) ~= "table" then return nil end

    local farmId = getFarmId()
    local out = {}

    for _, m in ipairs(missions) do
        if m ~= nil and m.farmId == farmId then
            local completion = safeCall(m.getCompletion, m)
            local minutes    = safeCall(m.getMinutesLeft, m)
            local reward     = safeCall(m.getTotalReward, m)
                            or safeCall(m.getReward, m)

            -- Field is only present on field-work contracts; transport and
            -- similar types legitimately have none.
            local fieldId
            if m.field ~= nil then
                fieldId = self.fieldIdByRef and self.fieldIdByRef[m.field]
                    or m.field.fieldId or m.field.farmlandId
            end

            out[#out + 1] = {
                title       = safeCall(m.getTitle, m) or "",
                type        = safeCall(m.getMissionTypeName, m)
                              or (m.type and m.type.name) or "",
                fieldId     = fieldId,
                reward      = round2(reward or 0),
                completion  = round2((completion or 0) * 100),
                minutesLeft = minutes and round0(minutes) or nil,
                isRunning   = safeCall(m.getIsRunning, m) or false,
                isFinished  = safeCall(m.getIsFinished, m) or false,
            }
        end
    end

    table.sort(out, function(a, b) return (a.fieldId or 9e9) < (b.fieldId or 9e9) end)
    return out
end

-- ─────────────────────────────────────────────────────────────────────────────
-- Output assembly + write
-- ─────────────────────────────────────────────────────────────────────────────

local PAYLOAD_ARRAY_KEYS = {
    "vehicles", "animals", "storage", "productions", "mapHotspots",
    "contracts", "prices", "availableFruits",
}

function DashboardExport:buildPayload()
    local time = self:collectGameTime()
    local fields = self:collectFields()
    self:detectFieldEvents(fields)

    -- Strip AFTER event detection, never before: detectFieldEvents compares
    -- `f.fruitTypeId ~= ""` to spot sowing, and a stripped (nil) value is not
    -- equal to "" — every empty field would fire a phantom sowing event.
    for i = 1, #fields do stripFieldDefaults(fields[i]) end

    -- priceForecast keeps its live period fields; the 12-month factor curve
    -- (the bulk of it) rides the static file once written.
    local forecast = self:collectPriceForecast()

    -- One walk over the placeables, shared by animals/storage/productions/prices.
    local buckets = self:collectPlaceableBuckets()

    local payload = {
        schemaVersion   = DashboardExport.SCHEMA_VERSION,
        modVersion      = DashboardExport.MOD_VERSION,
        gameDay         = time.gameDay,
        gameYear        = time.gameYear,
        gameMonth       = time.gameMonth,
        dayInMonth      = time.dayInMonth,
        daysPerMonth    = time.daysPerMonth,
        gameTime        = time.gameTime,
        farmBalance     = self:collectFarmBalance(),
        currency        = self:collectCurrency(),
        saveMeta        = self:collectSaveMeta(),
        gameSettings    = self:collectGameSettings(),
        priceForecast   = {
            currentPeriod = forecast.currentPeriod,
            daysPerPeriod = forecast.daysPerPeriod,
        },
        weather         = self:collectWeather(),
        pf              = self:collectPFMeta(),
        mapSize         = g_currentMission and g_currentMission.terrainSize or nil,
        player          = self:collectPlayer(),
        fields          = #fields > 0 and fields or emptyArray(),
        vehicles        = self:collectVehicles(),
        animals         = self:collectAnimals(buckets),
        storage         = self:collectStorages(buckets),
        productions     = self:collectProductions(buckets),
        mapHotspots     = (self.settings == nil or self.settings:getLiveMapEnabled())
                              and self:collectMapHotspots() or emptyArray(),
        contracts       = self:collectContracts(),
        prices          = self:collectPrices(buckets),
        events          = #self.pendingEvents > 0 and self.pendingEvents or emptyArray(),
    }

    -- Until the static file is on disk, keep carrying the full sections so the
    -- server (and a freshly opened page) is never left without a fruit catalog
    -- or a forecast curve. Costs one or two fat exports at session start.
    if not self.staticWritten then
        payload.availableFruits          = self:collectAvailableFruits()
        payload.priceForecast.fillTypes  = forecast.fillTypes
    end

    -- Ensure arrays stay arrays in JSON (even when empty)
    for _, key in ipairs(PAYLOAD_ARRAY_KEYS) do
        if type(payload[key]) == "table" and #payload[key] == 0 then
            payload[key] = emptyArray()
        end
    end

    return payload
end

-- ─────────────────────────────────────────────────────────────────────────────
-- Session-static sections get their own file, same pattern and same reason as
-- GEOMETRY_FILE: encoding them into every 2 s export spends game frame time on
-- data that cannot change while a save is loaded. Measured on a live payload:
-- availableFruits 13.6 KB (9.4 %) + priceForecast.fillTypes 25.9 KB (18.0 %) —
-- 27.4 % of 146 KB, re-encoded ~1800×/hour. The server merges them back in
-- enrich(), so the shape the frontend sees does not change.
function DashboardExport:maybeWriteStatic()
    if self.staticWritten then return end

    local fruits   = self:collectAvailableFruits()
    local forecast = self:collectPriceForecast()
    -- Both sources cache themselves only once non-empty; writing an early read
    -- would freeze an empty catalog into the file for the whole session.
    if #fruits == 0 or #forecast.fillTypes == 0 then return end

    local t0 = getTimeSec()
    local json = encodeJson({
        modVersion             = self.MOD_VERSION,
        availableFruits        = fruits,
        priceForecastFillTypes = forecast.fillTypes,
    })
    local f = io.open(self.STATIC_FILE, "w")
    if f == nil then return end   -- retry on the next export
    f:write(json)
    f:close()
    self.staticWritten = true
    Logging.info(string.format("[%s] static sections written — %d crops, %d fillTypes, %.0f ms (one-off, off the 2 s payload)",
        self.MOD_NAME, #fruits, #forecast.fillTypes, (getTimeSec() - t0) * 1000))
end

function DashboardExport:writeOutput(payload)
    local t0 = getTimeSec()
    local json = encodeJson(payload)
    self.lastEncodeMs = (getTimeSec() - t0) * 1000
    local f = io.open(self.OUTPUT_FILE, "w")
    if f then
        f:write(json)
        f:close()
        -- after successful write, clear events queue (server has them now)
        self.pendingEvents = {}
        return true
    end
    return false
end

-- ─────────────────────────────────────────────────────────────────────────────
-- Diagnostic probe (one-shot, helps troubleshoot field/farmland mapping)
-- ─────────────────────────────────────────────────────────────────────────────

function DashboardExport:dumpDiagnostics()
    if self.diagDumped then return end
    self.diagDumped = true

    local farmId = getFarmId()
    Logging.info(string.format("[%s] Output: %s", self.MOD_NAME, self.OUTPUT_FILE))

    local fruits = self:collectAvailableFruits()
    Logging.info(string.format("[%s] Fruit catalog: %d crops", self.MOD_NAME, #fruits))

    if g_farmlandManager and g_farmlandManager.farmlands then
        local owned, total = 0, 0
        for _, fl in pairs(g_farmlandManager.farmlands) do
            total = total + 1
            local ownerId = fl.farmId or fl.ownerFarmId or 0
            if ownerId == farmId then owned = owned + 1 end
        end
        Logging.info(string.format("[%s] Farmlands: total=%d owned=%d (farmId=%d)",
            self.MOD_NAME, total, owned, farmId))
    end

    if g_fieldManager and g_fieldManager.fields then
        local n = 0
        for _ in pairs(g_fieldManager.fields) do n = n + 1 end
        Logging.info(string.format("[%s] Field objects: %d", self.MOD_NAME, n))
    end

end

-- ─────────────────────────────────────────────────────────────────────────────
-- Mod lifecycle
-- ─────────────────────────────────────────────────────────────────────────────

function DashboardExport:loadMap(name)
    -- Blank last session's outlines. The file is not keyed by map, so switching
    -- maps would otherwise let the server serve the previous map's shapes for
    -- the few seconds until this one finishes tracing.
    local f = io.open(self.GEOMETRY_FILE, "w")
    if f then f:write('{"count":0,"polys":{}}'); f:close() end

    -- Same reasoning for the static sections: a different map has a different
    -- crop catalog. Blank it and let this session rewrite it; until then the
    -- payload carries both sections inline (see buildPayload).
    self.staticWritten = false
    local s = io.open(self.STATIC_FILE, "w")
    if s then s:write('{}'); s:close() end

    self.settings = DashboardSettings.new()
    self.settings:load()
    if not self.settings:getLiveMapEnabled() then
        self:clearLiveMapOutputs()
    end
    DashboardSettingsFrame.installHook()

    Logging.info(string.format("[%s] loaded — will export every %d ms",
        self.MOD_NAME, self.EXPORT_PERIOD))
end

-- Živá mapa vypnutá — nechceme na disku ležet stará data z předchozí session
-- (pozice, obrysy polí), která by se v dashboardu jevila jako aktuální.
function DashboardExport:clearLiveMapOutputs()
    local p = io.open(self.POSITIONS_FILE, "w")
    if p then p:write('{"vehicles":[]}'); p:close() end

    local g = io.open(self.GEOMETRY_FILE, "w")
    if g then g:write('{"count":0,"polys":{}}'); g:close() end

    self.flTraceQueue, self.flTraceQueued = nil, nil
    self.mapHotspotsCache = nil
    -- Force the next writePositions() (once re-enabled) to write for real
    -- instead of comparing against a stale pre-pause signature and skipping.
    self.lastPosJson = nil
end

function DashboardExport:update(dt)
    if not (g_currentMission and g_currentMission.isRunning) then return end

    farmIdCache = nil  -- fresh farmId jednou za frame; sdílí ho scan i export

    self:dumpDiagnostics()

    -- Živá mapa (viz DashboardSettings) — pokud je vypnutá, přeskočit obrysy
    -- polí/parcel i 4Hz kanál s pozicemi. Zbytek exportu (pole, vozidla,
    -- zvířata, sklady, ceny...) běží dál beze změny.
    local liveMap = self.settings == nil or self.settings:getLiveMapEnabled()

    if liveMap then
        -- Live-map geometry: a thin slice every frame until it is built, then free.
        self:tickMapGeometry(self.GEOM_BUDGET_MS)

        -- Positions on their own short period, independent of the 2 s export.
        self.posAccumMs = (self.posAccumMs or 0) + dt
        if self.posAccumMs >= self.POSITION_PERIOD then
            self.posAccumMs = 0
            self:writePositions()
        end
    end

    -- Throttle density-map scans to one chunk every SCAN_PERIOD ms.
    self.scanAccumMs = self.scanAccumMs + dt
    if self.scanAccumMs >= self.SCAN_PERIOD then
        self.scanAccumMs = 0
        local st0 = getTimeSec()
        self:tickFieldScan()
        local scanMs = (getTimeSec() - st0) * 1000

        local pf0 = getTimeSec()
        self:tickPFScan()
        local pfMs = (getTimeSec() - pf0) * 1000

        -- Threshold, not `> 1 ms`: a normal chunk takes 1-6 ms, so the old
        -- condition logged ~2 lines a second. See PERF_LOG_MS.
        if self.DEBUG or scanMs > self.PERF_LOG_MS or pfMs > self.PERF_LOG_MS then
            Logging.info(string.format("[%s] PERF scan=%.1fms pf=%.1fms", self.MOD_NAME, scanMs, pfMs))
        end
    end

    self.lastExportAt = self.lastExportAt + dt
    if self.lastExportAt < self.EXPORT_PERIOD then return end
    self.lastExportAt = 0

    self:detectFieldChanges()  -- cheap; invalidates cache on sow/harvest

    local t0 = getTimeSec()
    local payload = self:buildPayload()
    local buildMs = (getTimeSec() - t0) * 1000
    self:writeOutput(payload)
    local totalMs = (getTimeSec() - t0) * 1000
    local encodeMs = self.lastEncodeMs or 0

    -- The per-export snapshot is only valid for the export that just ran.
    self.fsSnapshot = nil

    -- Used to log every export (0.5 lines/s, ~9000 lines/hour). An oversized
    -- log.txt is not free: tailing it is what broke save-dir detection once.
    -- Keep the first few for a startup baseline, then only report outliers.
    self.exportCount = (self.exportCount or 0) + 1
    if self.DEBUG or self.exportCount <= self.PERF_LOG_FIRST or totalMs > self.PERF_LOG_MS then
        Logging.info(string.format("[%s] PERF export #%d total=%.1fms build=%.1fms encode=%.1fms write=%.1fms",
            self.MOD_NAME, self.exportCount, totalMs, buildMs, encodeMs, totalMs - buildMs - encodeMs))
    end

    -- After the export, never during it: these write their own files and must
    -- not add to the tick the payload already paid for.
    self:maybeWriteStatic()
    self:maybeWriteGeometry()
end

function DashboardExport:deleteMap()
    -- Output file stays on disk for the server to read post-exit. Live-map
    -- geometry however is per-map: drop it, or loading a second savegame in the
    -- same session reuses the previous map's outlines and cell masks.
    self.fieldPolyCache    = nil
    self.farmlandPolyCache = nil
    self.farmlandMasks     = nil
    self.flScan            = nil
    self.farmlandScanDone  = false
    self.flTraceQueue      = nil
    self.flTraceQueued     = nil
    self.mapHotspotsCache  = nil
    self.geomLogged        = false
    self.geomPolys         = nil
    self.geometryWritten   = false
    self.geomMsTotal, self.geomFrames, self.geomParcels = nil, nil, nil
    self.hpPrev, self.hpSamples = nil, nil

    -- Session-scoped caches. These are per-SAVE, not per-map-file: the crop
    -- catalog and the price curve differ between maps, and the static file is
    -- now written once from these caches — a stale one would be served for the
    -- whole next session instead of just one tick.
    self.staticWritten     = false
    self.fruitCatalogCache = nil
    self.priceForecastCache = nil
    self.pfMetaCache       = nil
    self.fruitCache        = {}
    self.statusCache       = {}
    self.pfCache           = {}
    self.scanState         = nil
    self.pfScanState       = nil
    self.currencyCache     = nil
    self.pricesCache       = nil
    self.fsSnapshot        = nil
    self.prevFields        = {}
    self.fieldIdByRef      = nil
    self.exportCount       = nil
    self.diagDumped        = false
    self.lastPosJson       = nil
    self.posLogged         = false

    -- Module-scope caches keyed by engine indices / config paths. A different
    -- save can load a different mod set, so a stale entry would name the wrong
    -- fill type or store item for the rest of the session.
    fillTypeDescCache = {}
    storeTitleCache   = {}
    pfHandleCache     = nil
end

addModEventListener(DashboardExport)
