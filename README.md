<div align="center">

![Kulala Logo](assets/logo.svg)

# Kulala Core

[![Made with love](assets/badge-made-with-love.svg)](https://github.com/mistweaverco/kulala-core/graphs/contributors)
[![GitHub release (latest by date)](https://img.shields.io/github/v/release/mistweaverco/kulala-core?style=for-the-badge)](https://github.com/mistweaverco/kulala-core/releases/latest)
[![Development status)](assets/badge-development-status.svg)](https://github.com/orgs/mistweaverco/projects/3/views/1?filterQuery=repo%3Amistweaverco%2Fkulala-core)
[![Discord](assets/badge-discord.svg)](https://discord.gg/QyVQmfY4Rt)

<p></p>

Kulala is swahili for "rest" or "relax."

A straightforwarded, powerful, and extendable HTTP client library.
It powers the [Kulala toolchain](https://getkulala.net),
and can be used as a standalone library.

<p></p>

</div>

## Overview

A RESTful API is a web service architecture that adheres to
specific constraints:

- statelessness,
- uniform interface,
- client-server separation

Typically using HTTP methods like `GET`, `POST`, `PUT`, and `DELETE`.
It uses standard web protocols to enable interoperability
between distributed systems.

## Features

### Request types

- HTTP RESTful (1.0, 1.1, 2, 3)
- GraphQL (queries, mutations)

### Variables

- Host Environment
- Document variables
- Request scoped variables
- `http-client.env` files
- Built-in support for [kuba](https://kuba.mwco.app)

### Scripting

Supports JavaScript, Lua, and TypeScript for:

- Pre-request
- Post-request
- Conditional
- Inline
- External

### Authentication

- Basic
- Bearer
- OAuth 2.0

### Automation and testing

Assertions, automated testing and reporting
is compatible with the IntelliJ HTTP Client:

## Usage

See the [examples][examples]
directory for usage examples.

### Vendored curl

- **`npm install` / `bun install`**: the `@mistweaverco/kulala-core` package runs `postinstall`, which downloads a pinned static curl for the **installing machine’s** OS and architecture into the user cache (or you can set `KULALA_CURL_PATH` to your own binary).
- **Published library** (`dist/`): the npm build sets `__KULALA_EMBED_CURL__=false`, so the tarball does **not** embed curl from the machine that ran `npm publish`.
- **`bun build --compile`** (your app or the examples): run `packages/core/scripts/generate-vendored-curl.ts` (optionally with `--target=bun-…` for cross-compiles), then compile with `--define __KULALA_EMBED_CURL__=true` so the correct curl is embedded for that build. For cross-compilation you must have the matching curl available under the cache path or under `vendor/curl/<platform>-<arch>/` in this repo.

[examples]: https://github.com/mistweaverco/kulala-core/tree/main/examples
