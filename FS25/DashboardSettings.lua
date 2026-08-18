-- =============================================================================
-- DashboardSettings.lua — per-savegame nastavení Dashboard módu (co se exportuje)
-- =============================================================================
--
-- v1: přepínač "Živá mapa" — vypne pozice vozidel/hráče (4Hz kanál přes
-- writePositions), trasování obrysů polí/parcel (tickMapGeometry) a mapové
-- hotspoty (collectMapHotspots). Zbytek exportu (pole, vozidla, zvířata,
-- sklady, ceny, počasí...) běží beze změny — jde jen o data pro stránku Mapa.
--
-- Uloženo per-savegame (stejný vzor jako FS25_MultiCharacters/Settings.lua):
-- <savegamePath>/modSettings/dashboardSettings.xml.
-- =============================================================================

DashboardSettings = {}
local DashboardSettings_mt = Class(DashboardSettings)

DashboardSettings.CONFIG_NAME       = "dashboardSettings.xml"
DashboardSettings.DEFAULT_LIVE_MAP  = true   -- zachovává dosavadní chování pro existující uživatele

function DashboardSettings.new()
    local self = setmetatable({}, DashboardSettings_mt)
    self.liveMapEnabled = DashboardSettings.DEFAULT_LIVE_MAP
    return self
end

function DashboardSettings:getConfigPath()
    local mi = g_currentMission and g_currentMission.missionInfo
    local saveDir = mi and mi.savegameDirectory
    if saveDir == nil then
        return DashboardExport.MOD_DIR .. DashboardSettings.CONFIG_NAME
    end
    return saveDir .. "/" .. DashboardSettings.CONFIG_NAME
end

function DashboardSettings:load()
    local path = self:getConfigPath()
    if not fileExists(path) then
        Logging.info(string.format("[%s] Settings: konfig neexistuje, použije se výchozí (liveMap=%s)",
            DashboardExport.MOD_NAME, tostring(self.liveMapEnabled)))
        return
    end

    local xml = loadXMLFile("dashboardSettings", path)
    if xml == nil or xml == 0 then
        Logging.error(string.format("[%s] Settings: nepodařilo se načíst %s", DashboardExport.MOD_NAME, path))
        return
    end

    local v = getXMLBool(xml, "dashboardSettings#liveMapEnabled")
    if v ~= nil then self.liveMapEnabled = v end

    delete(xml)
    Logging.info(string.format("[%s] Settings načteny: liveMap=%s", DashboardExport.MOD_NAME, tostring(self.liveMapEnabled)))
end

function DashboardSettings:save()
    local path = self:getConfigPath()
    local xml = createXMLFile("dashboardSettings", path, "dashboardSettings")
    if xml == nil or xml == 0 then
        Logging.error(string.format("[%s] Settings: createXMLFile selhalo pro %s", DashboardExport.MOD_NAME, path))
        return
    end

    setXMLBool(xml, "dashboardSettings#liveMapEnabled", self.liveMapEnabled)

    saveXMLFile(xml)
    delete(xml)
end

function DashboardSettings:getLiveMapEnabled()
    return self.liveMapEnabled
end

function DashboardSettings:setLiveMapEnabled(b)
    self.liveMapEnabled = b and true or false
end
