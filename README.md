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

### curl binary

Resolution order: `KULALA_CURL_PATH` (if set),
then a pinned copy under the user cache (for example on Linux: `~/.local/share/kulala-core/cache/curl/<platform>-<arch>/curl`),
then **curl** on your `PATH`,
then a one-time download of a pinned static build (SHA-256 verified) into that cache.
You can override the data or cache root with `KULALA_CORE_DATA_DIR` / `KULALA_CORE_CACHE_DIR`.


- **Published library** (`dist/`): the npm build sets `__KULALA_EMBED_CURL__=false`, so the package does **not** embed curl from the machine that ran `npm publish`.
- **`bun build --compile`**: run `packages/core/scripts/generate-vendored-curl.ts` (optionally with `--target=bun-…` for cross-compiles) so the matching curl is present in the cache and embedded for that build, then compile with `--define __KULALA_EMBED_CURL__=true`.

[examples]: https://github.com/mistweaverco/kulala-core/tree/main/examples
