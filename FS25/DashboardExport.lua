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
DashboardExport.MOD_VERSION    = "1.1.2.13"
-- SCHEMA_VERSION tracks the dashboard_data.json shape — bump ONLY on breaking
-- changes (renamed/removed fields). Server has MIN/MAX bounds and warns on
-- mismatch. See src/Dashboard/docs/COMPATIBILITY.md.
DashboardExport.SCHEMA_VERSION = 1
DashboardExport.EXPORT_PERIOD  = 2000          -- ms between writes
DashboardExport.OUTPUT_FILE    = (getUserProfileAppPath and (getUserProfileAppPath() .. "dashboard_data.json"))
                                  or "dashboard_data.json"

-- Runtime state
DashboardExport.prevFields     = {}            -- fieldId → { fruitTypeId, growthState, isReady, area } (event detection)
DashboardExport.fruitCache     = {}            -- farmlandId → { fruitIdx, growth, expiresAt } (avoid hammering density map)
DashboardExport.FRUIT_TTL      = 300000        -- ms — safety re-scan once per 5 min (change detector invalidates sooner on edits)
DashboardExport.scanState      = nil           -- { farmlandId, fieldRef, fruitList, cursor, partial } — current incremental scan
DashboardExport.scanAccumMs    = 0             -- ms accumulated for scan pacing
DashboardExport.SCAN_PERIOD    = 500           -- ms between scan chunks
DashboardExport.FRUITS_PER_CHUNK = 5           -- density queries per chunk
DashboardExport.prevBalance    = nil           -- last seen balance (delta detection — server actually does this; we just emit current)
DashboardExport.lastExportAt   = 0
DashboardExport.lastDirtyAt    = 0
DashboardExport.diagDumped     = false         -- one-shot startup probe
DashboardExport.pendingEvents  = {}            -- queued sow/harvest events until next write

-- ─────────────────────────────────────────────────────────────────────────────
-- JSON encoder (pure Lua, no deps)
-- Handles: nil → null, booleans, numbers (integer + float), strings (escaped),
-- arrays (table with numeric 1..N keys), objects (everything else).
-- ─────────────────────────────────────────────────────────────────────────────

local function escapeStr(s)
    s = tostring(s)
    s = s:gsub('\\', '\\\\')
    s = s:gsub('"',  '\\"')
    s = s:gsub('\n', '\\n')
    s = s:gsub('\r', '\\r')
    s = s:gsub('\t', '\\t')
    s = s:gsub('[%z\1-\8\11-\12\14-\31]', function(c) return string.format('\\u%04x', string.byte(c)) end)
    return s
end

local function isArray(t)
    local n = 0
    for k, _ in pairs(t) do
        if type(k) ~= "number" then return false end
        if k > n then n = k end
    end
    -- consider empty tables arrays only if explicitly marked; otherwise object
    if n == 0 then return false end
    for i = 1, n do if t[i] == nil then return false end end
    return true, n
end

local function encodeJson(v)
    local tv = type(v)
    if v == nil then
        return "null"
    elseif tv == "boolean" then
        return v and "true" or "false"
    elseif tv == "number" then
        if v ~= v or v == math.huge or v == -math.huge then return "null" end
        if v == math.floor(v) and math.abs(v) < 1e15 then
            return string.format("%d", v)
        end
        return string.format("%.4f", v):gsub("%.?0+$", "")
    elseif tv == "string" then
        return '"' .. escapeStr(v) .. '"'
    elseif tv == "table" then
        if v.__emptyArray then return "[]" end
        local arr, n = isArray(v)
        if arr then
            local parts = {}
            for i = 1, n do parts[i] = encodeJson(v[i]) end
            return "[" .. table.concat(parts, ",") .. "]"
        else
            local parts = {}
            for k, val in pairs(v) do
                if type(k) == "string" then
                    parts[#parts + 1] = '"' .. escapeStr(k) .. '":' .. encodeJson(val)
                end
            end
            return "{" .. table.concat(parts, ",") .. "}"
        end
    end
    return "null"
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

local function getFarmId()
    if g_currentMission and g_currentMission.getFarmId then
        return g_currentMission:getFarmId() or 1
    end
    return 1
end

local function round2(n) return math.floor((n or 0) * 100 + 0.5) / 100 end

local function pctOf(value, capacity)
    if not capacity or capacity == 0 then return 0 end
    return math.floor((value / capacity) * 100 + 0.5)
end

-- ─────────────────────────────────────────────────────────────────────────────
-- Fruit catalog — every crop the map supports (name + Czech title)
-- ─────────────────────────────────────────────────────────────────────────────

function DashboardExport:collectAvailableFruits()
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

-- Cached density-derived fruit per farmland. The actual density-map scan is
-- driven incrementally by tickFieldScan() (called from update()) to spread
-- the cost — see FRUITS_PER_TICK. Here we only read the cache and fall back
-- to fieldState if no cached value exists yet.
-- Authoritative single-point fruit lookup: reads the live density map at a
-- world position and returns the engine's current truth for what's growing.
-- This is what tools like the in-game crop scanner use. fieldState.fruitTypeIndex
-- is *not* reliable (it can lag the actual density map by a season on community
-- maps, and resolves to wrong indices on maps that don't follow vanilla order).
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

function DashboardExport:getFieldFruit(field, farmlandId)
    -- Primary: density-map probe (truth). Returns (idx, growthState).
    local probeIdx, probeGrowth = self:probeFieldFruit(field)

    -- Read fieldState only for diagnostics + fallback when probe fails.
    local fs = safeCall(function() return field:getFieldState() end)
    if not fs or not fs.isValid then fs = field.fieldState end
    local fsFruit  = fs and fs.fruitTypeIndex or 0
    local fsGrowth = fs and fs.growthState or 0

    -- Diagnostic log when probe and fieldState disagree, throttled to avoid
    -- spam (one per farmland per 30s).
    if self.diagLastLog == nil then self.diagLastLog = {} end
    local now = g_currentMission and g_currentMission.time or 0
    local lastT = self.diagLastLog[farmlandId or 0] or 0
    if probeIdx ~= fsFruit and now - lastT > 30000 then
        self.diagLastLog[farmlandId or 0] = now
        local probeName = "—"
        local fsName    = "—"
        if g_fruitTypeManager then
            local pf = probeIdx > 0 and g_fruitTypeManager:getFruitTypeByIndex(probeIdx) or nil
            local ff = fsFruit  > 0 and g_fruitTypeManager:getFruitTypeByIndex(fsFruit)  or nil
            probeName = (pf and pf.name) or "—"
            fsName    = (ff and ff.name) or "—"
        end
        print(string.format(
            "[FS25_Dashboard][FRUIT-DIAG] farmlandId=%s probe=%d(%s,gs=%d) fieldState=%d(%s,gs=%d)",
            tostring(farmlandId), probeIdx, probeName, probeGrowth, fsFruit, fsName, fsGrowth))
    end

    if probeIdx > 0 then return probeIdx, probeGrowth end
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
        local fs = safeCall(function() return field:getFieldState() end) or field.fieldState
        local lastFs = fs and fs.fruitTypeIndex or 0
        self.fruitCache[st.farmlandId] = {
            fruitIdx   = bestIdx,
            growth     = 0,
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
    for _, fl in pairs(g_farmlandManager.farmlands or {}) do
        local ownerId = fl.farmId or fl.ownerFarmId or 0
        if ownerId == farmId then
            local field = mapping[fl.id] or fl.field
            local cached = field and self.fruitCache[fl.id]
            if cached then
                local fs = safeCall(function() return field:getFieldState() end) or field.fieldState
                local nowFs = fs and fs.fruitTypeIndex or 0
                if nowFs ~= cached.lastFsFruit then
                    cached.expiresAt = 0  -- invalidate; tickFieldScan will pick it up
                end
            end
        end
    end
end

function DashboardExport:collectFieldStatus(field)
    -- Returns FieldUtil-derived needs flags (plowing, lime, fertilizer, weeds, stones)
    local out = {
        needsPlowing       = false,
        needsCultivating   = false,
        needsLime          = false,
        fertilizationLevel = 0,
        weedLevel          = 0,
        stoneLevel         = 0,
    }
    if FieldUtil == nil or FieldUtil.getFieldStatus == nil then return out end
    local status = safeCall(function() return FieldUtil.getFieldStatus(field) end)
    if not status then return out end

    if status.plowFactor          ~= nil then out.needsPlowing       = status.plowFactor < 0.5 end
    if status.needsLime           ~= nil then out.needsLime          = status.needsLime end
    if status.fertilizationFactor ~= nil then out.fertilizationLevel = math.floor(status.fertilizationFactor * 2 + 0.5) end
    if status.weedFactor          ~= nil then out.weedLevel          = math.floor(status.weedFactor * 3 + 0.5) end
    if status.stoneFactor         ~= nil then out.stoneLevel         = math.floor(status.stoneFactor * 3 + 0.5) end

    return out
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

    local fruitTypeIndex, growthState = self:getFieldFruit(field, farmlandId)
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

    local cond = self:collectFieldStatus(field)
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
    }
end

function DashboardExport:collectFields()
    local out = {}
    if g_farmlandManager == nil or g_farmlandManager.farmlands == nil then return out end

    local currentFarmId = getFarmId()
    local mapping = (g_fieldManager and g_fieldManager.farmlandIdFieldMapping) or {}
    local seen = {}

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
                    table.insert(out, rec)
                    seen[farmland.id] = true
                end
            elseif ownerId == currentFarmId then
                local area = 0
                if farmland.totalFieldArea and farmland.totalFieldArea > 0 then
                    area = round2(farmland.totalFieldArea / 10000)
                elseif farmland.areaInHa then
                    area = round2(farmland.areaInHa)
                end
                table.insert(out, {
                    id                 = farmland.id,
                    farmlandId         = farmland.id,
                    area               = area,
                    farmlandAreaHa     = area,    -- no field → both are the same
                    owned              = true,
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
                })
                seen[farmland.id] = true
            end
        end
    end

    -- Fallback: fields that exist in fieldManager but their farmland binding
    -- wasn't picked up by the mapping (rare; defensive only).
    if g_fieldManager and g_fieldManager.fields then
        for _, field in pairs(g_fieldManager.fields) do
            local flId = (field.farmland and field.farmland.id) or nil
            if flId == nil and field.posX and field.posZ and g_farmlandManager.getFarmlandIdAtWorldPosition then
                flId = safeCall(function() return g_farmlandManager:getFarmlandIdAtWorldPosition(field.posX, field.posZ) end)
            end
            if flId and not seen[flId] then
                local fl = g_farmlandManager:getFarmlandById(flId)
                local ownerId = (fl and (fl.farmId or fl.ownerFarmId)) or 0
                local rec = self:buildFieldRecord(flId, field, ownerId, currentFarmId, fl)
                if rec then
                    table.insert(out, rec)
                    seen[flId] = true
                end
            end
        end
    end

    table.sort(out, function(a, b) return (a.id or 0) < (b.id or 0) end)
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

local function vehicleStoreTitle(v)
    if not (v.configFileName and g_storeManager and g_storeManager.getItemByXMLFilename) then return nil end
    local item = safeCall(function() return g_storeManager:getItemByXMLFilename(v.configFileName) end)
    if not item then return nil end
    local brand = ""
    if item.brandIndex and g_brandManager and g_brandManager.getBrandByIndex then
        local b = safeCall(function() return g_brandManager:getBrandByIndex(item.brandIndex) end)
        if b then brand = b.title or b.name or "" end
    end
    -- "None" / "NONE" is FS25's sentinel for no-brand items; treat as no brand
    if brand == "None" or brand == "NONE" then brand = "" end
    local model = item.name or item.shopTitle or ""
    if brand ~= "" and model ~= "" then return brand .. " " .. model end
    return model ~= "" and model or nil
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
local function resolveFillTypeLabel(unit)
    local function lookup(idx)
        if idx == 0 or not g_fillTypeManager then return nil, nil end
        local ft = safeCall(function() return g_fillTypeManager:getFillTypeByIndex(idx) end)
        if ft and ft.name and ft.name ~= "" and ft.name ~= "UNKNOWN" then
            return ft.name, (ft.title and ft.title ~= "Unknown") and ft.title or ft.name
        end
        return nil, nil
    end

    local n, t = lookup(unit.fillType or 0)
    if n then return n, t end
    n, t = lookup(unit.lastValidFillType or 0)
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
    if not (idx and idx ~= 0 and g_fillTypeManager) then return nil end
    local ft = safeCall(function() return g_fillTypeManager:getFillTypeByIndex(idx) end)
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
    for _, impl in pairs(safeCall(function() return vehicle:getAttachedImplements() end) or {}) do
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
            for _, s in ipairs(sub) do table.insert(result, s) end
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

function DashboardExport:collectVehicles()
    local out = {}
    if not (g_currentMission and g_currentMission.vehicleSystem) then return out end
    local farmId = getFarmId()

    for _, v in pairs(g_currentMission.vehicleSystem.vehicles or {}) do
        local ownerId = (v.getOwnerFarmId and safeCall(function() return v:getOwnerFarmId() end))
                        or v.ownerFarmId or 0
        -- Require a real driveable vehicle (excludes rest-station placeables that have
        -- vestigial spec_motorized but no driving cockpit). Wheelbarrows etc. ARE drivable
        -- and stay in the list (with fuelCapacity=0) — that's fine, user can hide them in UI.
        local hasRealMotor = v.spec_motorized and v.spec_motorized.motor ~= nil
        local isDrivable   = v.spec_drivable ~= nil
        if v and hasRealMotor and isDrivable and ownerId == farmId then
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
                    local function nameOf(idx)
                        if not (idx and g_fillTypeManager) then return nil end
                        local ft = safeCall(function() return g_fillTypeManager:getFillTypeByIndex(idx) end)
                        return ft and ft.name or nil
                    end

                    local matchedName = nameOf(unit.lastValidFillType)
                    if matchedName == nil and type(unit.fillTypes) == "table" then
                        for idx, _ in pairs(unit.fillTypes) do
                            local n = nameOf(idx)
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
                speedKmh = math.floor((safeCall(function() return v:getLastSpeed() end) or 0) + 0.5)
            end
            rec.speedKmh = speedKmh

            -- Condition % = (1 - damage) * 100. getDamageAmount() is 0..1 damage;
            -- the menu shows condition, which is the inverse. Guard for vehicles
            -- without the wearable spec.
            if v.spec_wearable and v.getDamageAmount then
                local dmg = safeCall(function() return v:getDamageAmount() end)
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

            table.insert(out, rec)
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

function DashboardExport:collectAnimals()
    local out = {}
    if not (g_currentMission and g_currentMission.placeableSystem) then return out end
    local farmId = getFarmId()

    for _, placeable in pairs(g_currentMission.placeableSystem.placeables or {}) do
        local ownerId = (placeable.getOwnerFarmId and safeCall(function() return placeable:getOwnerFarmId() end))
                        or placeable.ownerFarmId or 0
        if placeable and placeable.spec_husbandryAnimals and ownerId == farmId then
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
                        local ftDesc = g_fillTypeManager and g_fillTypeManager:getFillTypeByIndex(ft)
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

            table.insert(out, rec)
        end
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

local function fillTypeName(fillType)
    local ftDesc = g_fillTypeManager and g_fillTypeManager:getFillTypeByIndex(fillType)
    return (ftDesc and (ftDesc.title or ftDesc.name)) or tostring(fillType)
end

local function isOwnedBy(placeable, farmId)
    if not placeable then return false end
    local ownerId = (placeable.getOwnerFarmId and safeCall(function() return placeable:getOwnerFarmId() end))
                    or placeable.ownerFarmId or 0
    return ownerId == farmId and ownerId > 0
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
                name     = fillTypeName(fillType),
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
            name     = fillTypeName(ft),
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
                        name = fillTypeName(first.fillType)
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

function DashboardExport:collectStorages()
    local out = {}
    if not (g_currentMission and g_currentMission.placeableSystem) then return out end
    local farmId = getFarmId()

    local collectors = { collectSiloRec, collectBunkerRec, collectObjectStorageRec }

    -- A placeable carries exactly one of these specs in practice — break after
    -- first match so we don't emit duplicate rows if a future placeable combines
    -- e.g. spec_silo and spec_productionPoint on the same building.
    for _, placeable in pairs(g_currentMission.placeableSystem.placeables or {}) do
        if isOwnedBy(placeable, farmId) then
            for _, fn in ipairs(collectors) do
                local rec = safeCall(function() return fn(placeable, farmId) end)
                if rec then
                    table.sort(rec.items, function(a, b) return a.name < b.name end)
                    if #rec.items == 0 then rec.items = emptyArray() end
                    table.insert(out, rec)
                    break
                end
            end
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
                name     = fillTypeName(fillType),
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
                name   = fillTypeName(inp.type or inp.fillTypeIndex or 0),
                amount = inp.amount or 0,
            })
        end
        for _, outp in ipairs(production.outputs or {}) do
            table.insert(r.outputs, {
                name   = fillTypeName(outp.type or outp.fillTypeIndex or 0),
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
function DashboardExport:collectProductions()
    local out = {}
    local farmId = getFarmId()
    local pcm = g_currentMission and g_currentMission.productionChainManager

    if pcm and pcm.getProductionPointsForFarmId then
        local pps = safeCall(function() return pcm:getProductionPointsForFarmId(farmId) end) or {}
        for _, pp in ipairs(pps) do
            local placeable = pp.owningPlaceable
            local nameHint  = placeable and placeable.getName and placeable:getName() or nil
            local rec = buildProductionRecord(pp, nameHint)
            if rec then table.insert(out, rec) end
        end
        if self.DEBUG then
            Logging.info(string.format("[FS25_Dashboard][DIAG] productions via chainManager: %d", #out))
        end
        return out
    end

    -- Fallback: scan owned placeables (older engine / chain manager missing)
    if g_currentMission and g_currentMission.placeableSystem then
        for _, placeable in pairs(g_currentMission.placeableSystem.placeables or {}) do
            if isOwnedBy(placeable, farmId) then
                local spec = placeable.spec_productionPoint
                local pp   = spec and spec.productionPoint
                if pp then
                    local nameHint = placeable.getName and placeable:getName() or nil
                    local rec = buildProductionRecord(pp, nameHint)
                    if rec then table.insert(out, rec) end
                end
            end
        end
    end
    return out
end

-- ─────────────────────────────────────────────────────────────────────────────
-- Prices — sellPoint, items[].pricePerTon
-- We walk selling stations on the map and report their current price per fillType
-- ─────────────────────────────────────────────────────────────────────────────

function DashboardExport:collectPrices()
    local out = {}
    if not (g_currentMission and g_currentMission.placeableSystem) then return out end

    for _, placeable in pairs(g_currentMission.placeableSystem.placeables or {}) do
        local spec = placeable and placeable.spec_sellingStation
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
                            local ft = g_fillTypeManager and g_fillTypeManager:getFillTypeByIndex(ftIdx)
                            local massPerLiter = (ft and ft.massPerLiter) or 0.001
                            local pricePerTon = price / massPerLiter
                            table.insert(rec.items, {
                                name        = (ft and (ft.title or ft.name)) or tostring(ftIdx),
                                pricePerTon = math.floor(pricePerTon + 0.5),
                            })
                        end
                    end
                end
            end
            table.sort(rec.items, function(a, b) return a.name < b.name end)
            if #rec.items > 0 then
                table.insert(out, rec)
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
-- Output assembly + write
-- ─────────────────────────────────────────────────────────────────────────────

function DashboardExport:buildPayload()
    local time = self:collectGameTime()
    local fields = self:collectFields()
    self:detectFieldEvents(fields)

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
        availableFruits = self:collectAvailableFruits(),
        saveMeta        = self:collectSaveMeta(),
        gameSettings    = self:collectGameSettings(),
        priceForecast   = self:collectPriceForecast(),
        weather         = self:collectWeather(),
        fields          = #fields > 0 and fields or emptyArray(),
        vehicles        = self:collectVehicles(),
        animals         = self:collectAnimals(),
        storage         = self:collectStorages(),
        productions     = self:collectProductions(),
        prices          = self:collectPrices(),
        events          = #self.pendingEvents > 0 and self.pendingEvents or emptyArray(),
    }

    -- Ensure arrays stay arrays in JSON (even when empty)
    for _, key in ipairs({"vehicles", "animals", "storage", "productions", "prices", "availableFruits"}) do
        if type(payload[key]) == "table" and #payload[key] == 0 then
            payload[key] = emptyArray()
        end
    end

    return payload
end

function DashboardExport:writeOutput(payload)
    local json = encodeJson(payload)
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
    Logging.info(string.format("[%s] loaded — will export every %d ms",
        self.MOD_NAME, self.EXPORT_PERIOD))
end

function DashboardExport:update(dt)
    if not (g_currentMission and g_currentMission.isRunning) then return end

    self:dumpDiagnostics()

    -- Throttle density-map scans to one chunk every SCAN_PERIOD ms.
    self.scanAccumMs = self.scanAccumMs + dt
    if self.scanAccumMs >= self.SCAN_PERIOD then
        self.scanAccumMs = 0
        self:tickFieldScan()
    end

    self.lastExportAt = self.lastExportAt + dt
    if self.lastExportAt < self.EXPORT_PERIOD then return end
    self.lastExportAt = 0

    self:detectFieldChanges()  -- cheap; invalidates cache on sow/harvest

    local payload = self:buildPayload()
    self:writeOutput(payload)
end

function DashboardExport:deleteMap()
    -- nothing to clean up; file stays on disk for the server to read post-exit
end

addModEventListener(DashboardExport)
