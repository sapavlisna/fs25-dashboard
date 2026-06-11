# Počasí (`weather`)

- **Soubory:** index.html (weather render — typeId->ikona/titulek, temperature/temperatureMin/Max, forecast[])
- **Počet stavů:** 22
- **biggestRisk:** Forecast typeId boundary case: if weather.forecast[N].typeId is null or outside [0, 8], the fallback emoji is '·' (dot), which is visually indistinguishable from the unknown-weather fallback. This may confuse users or mask data generation bugs from mock-data.js. Additionally, forecast rows are generated server-side from Lua mock weather.forecast array but CSS assumes display:flex on parent — if forecast is populated but items fail to render due to template errors, the forecast strip would be invisible despite non-empty data. No smoke test currently validates forecast rendering (only mock-data generation tested in validate-json.js, not client-side rendering). Humidity/pressure/wind (if ever added to weather schema) have no render path and would silently drop.

> Povrch: Počasí (Weather)

| stav | trigger | podmínka (file:line) | DOM (selektor+třída) | křížové efekty | pokrytí |
|---|---|---|---|---|---|
| Weather icon rendered (sun) | weather.typeId | typeId === 0 or typeId === 1 (index.html:376-382, 479-480) | #kpi-weather-icon — ☀️ (emoji content) | — | weather.spec.js: typeId 0 (Jasno), typeId 1 (Slunečno) |
| Weather icon rendered (partly cloudy) | weather.typeId | typeId === 2 (index.html:380-382, 479-480) | #kpi-weather-icon — 🌤 (emoji content) | — | weather.spec.js: typeId 2 (Polojasno) |
| Weather icon rendered (cloudy) | weather.typeId | typeId === 3 (index.html:380-382, 479-480) | #kpi-weather-icon — ☁️ (emoji content) | — | weather.spec.js: typeId 3 (Oblačno) |
| Weather icon rendered (rain) | weather.typeId | typeId === 4 (index.html:380-382, 479-480) | #kpi-weather-icon — 🌧 (emoji content) | — | weather.spec.js: typeId 4 (Déšť) |
| Weather icon rendered (snow) | weather.typeId | typeId === 5 (index.html:380-382, 479-480) | #kpi-weather-icon — ❄️ (emoji content) | — | weather.spec.js: typeId 5 (Sněžení) |
| Weather icon rendered (thunderstorm) | weather.typeId | typeId === 6 (index.html:380-382, 479-480) | #kpi-weather-icon — ⛈ (emoji content) | — | weather.spec.js: typeId 6 (Bouřka) |
| Weather icon rendered (hail) | weather.typeId | typeId === 7 (index.html:380-382, 479-480) | #kpi-weather-icon — 🌨 (emoji content) | — | weather.spec.js: typeId 7 (Kroupy) |
| Weather icon rendered (fog) | weather.typeId | typeId === 8 (index.html:380-382, 479-480) | #kpi-weather-icon — 🌫 (emoji content) | — | weather.spec.js: typeId 8 (Mlha/fog) |
| Weather icon rendered (unknown/fallback) | weather.typeId | typeId < 0 or typeId > 8 or typeId == null (index.html:479-480) | #kpi-weather-icon — · (dot fallback) | — | weather.spec.js: boundary-low, boundary-high, typeId null |
| Weather label rendered (Jasno) | weather.typeId | typeId === 0 (index.html:376-379, 478) | #kpi-weather-sub — text: 'Jasno' (Czech label) | — | weather.spec.js: typeId 0 (Jasno) |
| Weather label rendered (Slunečno) | weather.typeId | typeId === 1 (index.html:376-379, 478) | #kpi-weather-sub — text: 'Slunečno' | — | weather.spec.js: typeId 1 (Slunečno) |
| Weather label rendered (Polojasno) | weather.typeId | typeId === 2 (index.html:376-379, 478) | #kpi-weather-sub — text: 'Polojasno' | — | weather.spec.js: typeId 2 (Polojasno) |
| Weather label rendered (Oblačno) | weather.typeId | typeId === 3 (index.html:376-379, 478) | #kpi-weather-sub — text: 'Oblačno' | — | weather.spec.js: typeId 3 (Oblačno) |
| Weather label rendered (Déšť) | weather.typeId | typeId === 4 (index.html:376-379, 478) | #kpi-weather-sub — text: 'Déšť' | — | weather.spec.js: typeId 4 (Déšť) |
| Weather label rendered (Sněžení) | weather.typeId | typeId === 5 (index.html:376-379, 478) | #kpi-weather-sub — text: 'Sněžení' | — | weather.spec.js: typeId 5 (Sněžení) |
| Weather label rendered (Bouřka) | weather.typeId | typeId === 6 (index.html:376-379, 478) | #kpi-weather-sub — text: 'Bouřka' | — | weather.spec.js: typeId 6 (Bouřka) |
| Weather label rendered (Kroupy) | weather.typeId | typeId === 7 (index.html:376-379, 478) | #kpi-weather-sub — text: 'Kroupy' | — | weather.spec.js: typeId 7 (Kroupy) |
| Weather label rendered (Mlha) | weather.typeId | typeId === 8 (index.html:376-379, 478) | #kpi-weather-sub — text: 'Mlha' | — | weather.spec.js: typeId 8 (Mlha/fog) |
| Weather temperature displayed (current) | weather.temperature | temperature != null (index.html:481) | #kpi-weather-temp — text: '${temperature} °C' | — | weather.spec.js: temperature != null displays current temp |
| Weather temperature missing (fallback) | weather.temperature | temperature == null (index.html:481) | #kpi-weather-temp — text: '—' | — | weather.spec.js: temperature === null displays fallback "—" |
| Weather sub-label with min/max temps | weather.typeId · weather.temperatureMin · weather.temperatureMax | typeId resolved to WEATHER_CS[typeId] AND (temperatureMin != null AND temperatureMax != null) (index.html:483-485) | #kpi-weather-sub — text: '${wLabel} · ${temperatureMin}–${temperatureMax} °C' (appended to label) | — | weather.spec.js: temperatureMin + Max present appends range |
| Weather sub-label without range (min/max missing) | weather.temperatureMin · weather.temperatureMax | temperatureMin == null OR temperatureMax == null (index.html:483-485) | #kpi-weather-sub — no '${min}–${max} °C' pattern | — | weather.spec.js: temperatureMin or Max missing shows only label |
| Forecast strip rendered (each day row visible) | weather.forecast | forecast.length > 0 (index.html:493-509) | #kpi-weather-forecast — display: flex (strip visible), .forecast-day children | — | weather.spec.js: forecast.length > 0 renders strip with 3 day rows; forecast.length === 1 renders single day row |
| Forecast strip hidden (empty) | weather.forecast | forecast === [] or forecast == null (index.html:507-508, style.css:472) | #kpi-weather-forecast — display: none (style.css .kpi-weather-card .kpi-weather-forecast:empty) | — | weather.spec.js: forecast === [] hides strip; forecast === null renders empty strip |
| Forecast day icon rendered (per typeId) | weather.forecast[N].typeId | typeId in range [0, 8] per WEATHER_ICON enum (index.html:496, 502-503) | .forecast-day .forecast-icon — emoji content (☀️/🌤/☁️/🌧/❄️/⛈/🌨/🌫) | — | weather.spec.js: forecast.length > 0 renders strip (icon not empty check per day) |
| Forecast day icon fallback (out-of-range typeId) | weather.forecast[N].typeId | typeId > 8 or typeId < 0 (index.html:502-503) | .forecast-day .forecast-icon — · (dot fallback) | — | weather.spec.js: forecast item with typeId 99 shows fallback dot |
| Forecast day temperature range rendered | weather.forecast[N].temperatureMin · weather.forecast[N].temperatureMax | (temperatureMin != null AND temperatureMax != null) (index.html:500, 504) | .forecast-day .forecast-temp — text: '${tmin}–${tmax}°' (displayed when temps exist) | — | weather.spec.js: forecast item with null temperatureMin/Max omits temp span |
