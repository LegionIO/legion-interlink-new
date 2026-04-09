# Legion Interlink Builder

This repository is a thin branding-and-release overlay for Legion Interlink.
It builds the upstream desktop app from [`kai-systems/kai-desktop`](https://github.com/kai-systems/kai-desktop), applies Legion branding, bundles the required Legion plugin, and publishes the signed macOS release plus the Homebrew cask update.

## Repository Layout

```text
legion-interlink/
├── .github/workflows/release.yml
├── VERSION
├── branding/
│   ├── branding.config.ts
│   └── build/
├── plugins/
│   └── legion/
└── scripts/
    └── dev.sh
```

## Local Development

The helper script overlays this repo onto a local `kai-desktop` checkout and starts the upstream app in dev mode:

```bash
./scripts/dev.sh
```

By default it uses `../kai-desktop`. Override it if needed:

```bash
UPSTREAM=~/neo/kai-desktop ./scripts/dev.sh
```

## Releasing

Releases are driven by `.github/workflows/release.yml`.

- `VERSION` is the source of truth for the branded release version.
- The workflow clones upstream `kai-desktop`, overlays Legion branding and the vendored `legion` plugin, builds on `macos-26`, creates a GitHub release, and updates `LegionIO/homebrew-tap` the same way this repo previously did.
- The workflow also accepts an optional `upstream_ref` input so a release can target a specific upstream branch, tag, or SHA.
