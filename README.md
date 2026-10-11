# Grimnir & Lyonesse for Foundry

24 subclasses from the supplied 2024 rulebooks, with features, separate action/attack/spell Items, companions and bundled Game-icons.net artwork.

[Installation and character guide (Russian)](README-RU.md)

Manifest: https://raw.githubusercontent.com/polinavd/subclassesvd/main/module.json

Targets Foundry 13.351 / D&D5e 5.2.3. Foundry 14 is allowed but unverified; D&D5e 6.x is not supported.

Build with Node.js 22.16+: `npm ci && npm run package`.

Source data is in `source/`; runtime code in `scripts/`; installation archive in `dist/`. Checks cover pack roundtrips, grant links, bundled artwork, upgrades, level gating, resource spending and action execution. A live Foundry session was not available for integration testing.

See [credits](CREDITS.md) for artwork and SRD licensing. Book text retains its authors’ rights.
