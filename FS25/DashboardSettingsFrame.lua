-- =============================================================================
-- DashboardSettingsFrame.lua — sekce "Dashboard" v Esc → Nastavení → Obecné
-- =============================================================================
--
-- Stejný postup jako FS25_MultiCharacters/MultiCharSettingsFrame.lua: NEpřidáváme
-- vlastní GUI XML. Naklonujeme existující nativní MultiTextOption řádek
-- (multiCameraSensitivity) a připojíme ho do `generalSettingsLayout` — nativní
-- vzhled zadarmo, žádné vlastní profily/layouty.
-- =============================================================================

DashboardSettingsFrame = {}

DashboardSettingsFrame._settings       = nil
DashboardSettingsFrame._liveMapOption  = nil
DashboardSettingsFrame._layout         = nil
DashboardSettingsFrame._hookInstalled  = false

local SECTION_TITLE = "Dashboard"
local ROW_LABEL     = "Živá mapa"
local ROW_TOOLTIP   = "Vypne pozice vozidel/hráče na živé mapě a obrysy polí. Šetří výkon, pokud stránku Mapa nesleduješ."
local NO_TEXT, YES_TEXT = "NE", "ANO"

function DashboardSettingsFrame.installHook()
    if DashboardSettingsFrame._hookInstalled then return end
    if InGameMenuSettingsFrame == nil then
        Logging.info(string.format("[%s] InGameMenuSettingsFrame neexistuje — sekce Dashboard neinstaluji", DashboardExport.MOD_NAME))
        return
    end

    InGameMenuSettingsFrame.onFrameOpen = Utils.appendedFunction(
        InGameMenuSettingsFrame.onFrameOpen,
        function(settingsFrame)
            local ok, err = pcall(DashboardSettingsFrame.onFrameOpen, settingsFrame)
            if not ok then
                Logging.error(string.format("[%s] DashboardSettingsFrame.onFrameOpen selhalo: %s", DashboardExport.MOD_NAME, tostring(err)))
            end
        end
    )
    DashboardSettingsFrame._hookInstalled = true
end

function DashboardSettingsFrame.onFrameOpen(settingsFrame)
    if g_inGameMenu == nil or settingsFrame ~= g_inGameMenu.pageSettings then return end

    local layout = settingsFrame.generalSettingsLayout
    if layout == nil then return end

    local settings = DashboardExport.settings
    if settings == nil then return end
    DashboardSettingsFrame._settings = settings

    -- Idempotentně: přidej sekci jen když v layoutu ještě není (stránka se může
    -- po zavření/otevření přestavět a prvky zahodit).
    local present = false
    for _, el in ipairs(layout.elements or {}) do
        if el.id == "dashboardSectionHeader" then present = true; break end
    end
    if not present then
        local ok, err = pcall(DashboardSettingsFrame.inject, settingsFrame, layout)
        if not ok then
            Logging.error(string.format("[%s] DashboardSettingsFrame.inject selhalo: %s", DashboardExport.MOD_NAME, tostring(err)))
        end
    end

    DashboardSettingsFrame.updateValues()
end

-- Najde v naklonovaném řádku ovládací prvek (MultiTextOption) a popisek.
local function findControlAndTitle(row)
    local control, label
    for _, el in ipairs(row.elements or {}) do
        if control == nil and el.setState ~= nil and el.name ~= "ignore" then
            control = el
        end
    end
    for i = #(row.elements or {}), 1, -1 do
        local el = row.elements[i]
        if el ~= control and el.setText ~= nil and el.name ~= "ignore" then
            label = el
            break
        end
    end
    return control, label
end

function DashboardSettingsFrame.inject(settingsFrame, layout)
    DashboardSettingsFrame._layout = layout

    local headerRef
    for _, el in ipairs(layout.elements) do
        if el.name == "sectionHeader" then headerRef = el; break end
    end
    if headerRef ~= nil then
        local h = headerRef:clone()
        h.id = "dashboardSectionHeader"
        h:setText(SECTION_TITLE)
        layout:addElement(h)
    else
        Logging.info(string.format("[%s] sectionHeader ref nenalezen v generalSettingsLayout", DashboardExport.MOD_NAME))
    end

    local multiRef = settingsFrame.multiCameraSensitivity
    if multiRef == nil or multiRef.parent == nil then
        Logging.info(string.format("[%s] multiCameraSensitivity ref nenalezen — sekce Dashboard bez ovládacích prvků", DashboardExport.MOD_NAME))
        return
    end

    local row = multiRef.parent:clone()
    row.id = "dashboardLiveMapBox"
    local option, label = findControlAndTitle(row)
    if label ~= nil then
        pcall(function() label:setText(ROW_LABEL) end)
    end
    if option ~= nil then
        local tt = option.elements and option.elements[1]
        if tt ~= nil and tt.setText ~= nil then
            pcall(function() tt:setText(ROW_TOOLTIP) end)
        end
        option.id = "dashboardLiveMapOption"
        option.target = DashboardSettingsFrame
        if option.setCallback ~= nil then
            option:setCallback("onClickCallback", "onLiveMapChanged")
        end
        if option.setDisabled ~= nil then option:setDisabled(false) end
        if option.setTexts ~= nil then option:setTexts({ NO_TEXT, YES_TEXT }) end
    end
    if row.reloadFocusHandling ~= nil then
        pcall(function() row:reloadFocusHandling(true) end)
    end
    layout:addElement(row)
    DashboardSettingsFrame._liveMapOption = option

    DashboardSettingsFrame.reflow()
end

function DashboardSettingsFrame.reflow()
    local layout = DashboardSettingsFrame._layout
    if layout == nil then return end
    if layout.invalidateLayout ~= nil then
        pcall(function() layout:invalidateLayout() end)
    end
end

function DashboardSettingsFrame.updateValues()
    local settings = DashboardSettingsFrame._settings
    local option = DashboardSettingsFrame._liveMapOption
    if settings == nil or option == nil or option.setState == nil then return end
    local on = settings:getLiveMapEnabled()
    pcall(function() option:setState(on and 2 or 1, false) end)
end

-- state: 2 = ANO (živá mapa zapnutá), 1 = NE
function DashboardSettingsFrame:onLiveMapChanged(state, element)
    local settings = DashboardSettingsFrame._settings
    if settings == nil then return end
    local on = (state == 2)
    settings:setLiveMapEnabled(on)

    local ok, err = pcall(function() settings:save() end)
    if not ok then
        Logging.error(string.format("[%s] Settings:save selhalo: %s", DashboardExport.MOD_NAME, tostring(err)))
    end

    if not on then
        pcall(function() DashboardExport:clearLiveMapOutputs() end)
    end

    Logging.info(string.format("[%s] Settings: Živá mapa -> %s", DashboardExport.MOD_NAME, tostring(on)))
end
