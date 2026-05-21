# Changelog

All notable changes to this project will be documented here.
This project follows [Semantic Versioning](https://semver.org/).

## [1.1.0] — 2026-05-21

### Added
- **Payload schema versioning.** Mod stamps `schemaVersion` (= 1) and
  `modVersion` on every export. Server warns about legacy mods and exposes
  the negotiated state via `/api/version`.
- **Reproduction indicator** for animals — 🐣 X % badge in the row, tinted
  green at ≥ 90 % (next animal almost due). Aggregated as the max across
  clusters; the modal also surfaces per-cluster reproduction.
- **Per-fruit `needsRolling`** flag in payload — calendar shows the `Válet`
  chip only for crops that actually benefit from rolling (corn, beet, rice
  and sugarcane skip it).
- **Field calendar — fixed-column needs chips:** Orat / Kultivovat /
  Vápno / Plevel / Kameny / Válet. Each column is gated by the matching
  in-game difficulty setting (`weedsEnabled`, `stonesEnabled`,
  `plowingRequiredEnabled`, `limeRequired`) so disabled mechanics don't
  generate UI noise. Header row labels the columns.
- **Field hide in the calendar** — drop-equivalent of the main dashboard's
  hide; hidden fields are excluded from KPI counts and the Gantt (with a
  "Skryté pole (N)" collapsible at the bottom).
- **Field state classification** — `isCut` and `isWithered` booleans on
  each field. Calendar bars + modal show "Sklizeno" / "Zvadlé" instead of
  the old bogus "7/5" growth phase after harvest.
- **Seasonal price forecast chart** on the History page — bar chart of the
  12-month price multiplier per fillType with current/best/worst month
  highlighting and a headline summary ("nejlepší v Říjen, nyní …").
- **History — smart commodity filter.** Commodities you own (stock > 0)
  are listed first in their own optgroup. Sell-point dropdown is filtered
  to places currently buying the selected commodity (from live prices).
- **Row-level change flash.** When a value changes between WS ticks the
  row tints green (rose) or red (fell) for 10 s. Active in: vehicles
  (fuel), animals (count), fields (growthState), storage (amount),
  productions (amount), prices (pricePerTon). Each section has its own
  iOS-style switch in the section header (state persisted in localStorage).
- **Bell guard** for low-fuel alerts — skips user-hidden vehicles and
  vehicles without a fuel tank (wheelbarrows, rest-station placeables)
  that were tripping the threshold via `fuelPercent = 0`.
- Drag-and-drop hide for vehicles (drop into the "Skryté vozidla" zone)
  with the hidden subgroup persisted across reloads.
- Month name shown next to the game day in the navbar.
- Shared `money.js` module — history & profit pages honor the active
  currency (AdditionalCurrencies converter).

### Changed
- **Czech is now the primary README.** English moved to `README.en.md`;
  language switcher at the top of each file.
- "Productivity" label on animals corrected to **"Zdraví"** (it was always
  showing average herd health, not a production multiplier).
- Calendar Gantt label widened from 160 px to 240 px + dedicated needs
  column area (420 px) so chips align vertically across rows.
- Notifier respects hidden items — no alerts for vehicles, animals or
  fields the user has explicitly hidden.
- Storage sort: empty silos now sink to the bottom based on actual total
  amount (not on item-list emptiness).
- Productions section width fixed (no horizontal scrollbar on dense data).
- Vehicle fuel bar is fixed-width.
- Server v1.1.0 — boot banner shows the negotiated mod schema range and
  the new `/api/version` endpoint exposes mod + server versions.

### Fixed
- Growth phase no longer reads as "7/5" after harvest (`maxGrowth` now
  uses `maxHarvestingGrowthState` instead of `numGrowthStates - 1`).

## [1.0.0] — initial public release

First public version. Real-time view of fields, vehicles, animals,
silos, productions, prices, weather. History & profit-per-field pages.
Browser notifications. AdditionalCurrencies support.
