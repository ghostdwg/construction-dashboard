# Sources — Des Moines MSA Build Reference

This directory is the working reference for every public-data source the Groundworx
scraper can ingest in the Des Moines metro, organized for three different
audiences: people picking what to build, people writing the adapters, and
people prioritizing which jurisdictions to target.

## What's here

| File | Read it when… |
|---|---|
| [des_moines_msa_source_map.md](./des_moines_msa_source_map.md) | You want the full narrative + URLs for every source. The canonical text. |
| [INDEX_BY_PLATFORM.md](./INDEX_BY_PLATFORM.md) | You're writing an adapter. Tells you which sources share a backend (Tyler EnerGov, OpenGov, Citizenserve, etc.) so one adapter unlocks many cities. |
| [INDEX_BY_STAGE.md](./INDEX_BY_STAGE.md) | You're deciding what intelligence value a source delivers. Maps to the 8-stage pipeline from rumor → C of O. |
| [INDEX_BY_JURISDICTION.md](./INDEX_BY_JURISDICTION.md) | You're targeting a specific city/county. All sources for one jurisdiction in one place, with a priority tier. |
| [BUILD_PHASES.md](./BUILD_PHASES.md) | You're sequencing work. Maps source clusters to the roadmap (Phase 5J / 5K / 5L / etc.). |
| [ENTITIES_WATCHLIST.md](./ENTITIES_WATCHLIST.md) | Seed list of repeat-relationship entities (Hubbell, Knapp, R&R, Vermeer, etc.) used to validate the entity-normalization layer. |

## How to use this in practice

1. **Picking the next scraper to write** → read `BUILD_PHASES.md`, pick the
   highest-ROI phase, follow links into `INDEX_BY_PLATFORM.md` to see the
   adapter shape and `INDEX_BY_JURISDICTION.md` to see which cities will
   benefit on day one.

2. **Writing an adapter for a platform** → read `INDEX_BY_PLATFORM.md` for that
   platform's section. Every city using that platform is listed, with
   fingerprint URLs, anti-bot notes, and confirmed-vs-likely status.

3. **Triaging a new jurisdiction request** → read `INDEX_BY_JURISDICTION.md`
   for the city. Tells you platform, sources available, intelligence stages
   covered, and tier (where it sits relative to other cities).

4. **Validating the value of a feature** → read `INDEX_BY_STAGE.md`. The
   earlier the stage a feature taps, the higher the intelligence value but
   the lower the certainty. Use this when deciding "is this signal worth
   surfacing prominently?"

## Verification status

URLs and platform identifications were captured May 2026. Re-fingerprint at
crawl time — municipal vendor stacks change frequently. Every endpoint should
be re-confirmed via HTTP headers + DOM signatures before automated ingestion
begins (this confirms Accela / Tyler EnerGov / OpenGov / Citizenserve /
CivicPlus / GovPilot / Granicus identities).

## Maintenance

- New sources: append to `des_moines_msa_source_map.md` AND update relevant indexes.
- Phase completion: tick off the line in `BUILD_PHASES.md`.
- Platform change discovered at crawl time: update `INDEX_BY_PLATFORM.md`
  with the new fingerprint + status.
