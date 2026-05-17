# Changelog

All notable changes to this project will be documented here.
This project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Drag-and-drop hide for vehicles (drop into "Skryté vozidla" zone).
- Month name shown next to game day.
- Shared `money.js` module — history & profit pages now honor the active
  currency (AdditionalCurrencies converter).
- Notifier respects hidden items — no alerts for vehicles/animals/fields
  the user has explicitly hidden.

### Changed
- Storage sort: empty silos now go to the bottom based on actual total
  amount, not item-list emptiness.
- Productions section width fixed (no horizontal scrollbar on dense data).
- Vehicle fuel bar is fixed-width.

## [1.0.0] — initial public release

First public version. Real-time view of fields, vehicles, animals,
silos, productions, prices, weather. History & profit-per-field pages.
Browser notifications. AdditionalCurrencies support.
