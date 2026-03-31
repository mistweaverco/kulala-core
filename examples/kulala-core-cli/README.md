# kulala-core-cli (example)

This example shows how to **consume `kulala-core` as a library** and compile a **single-file executable** that behaves like the standalone binary.

## Build

```sh
cd examples/kulala-core-cli
bun install
bun run build
```

The resulting binary is `examples/kulala-core-cli/dist/kulala-core-cli`.

## Run

This expects the same JSON payload you’d normally pipe into `kulala-core`.

```sh
cd examples/kulala-core-cli
./dist/kulala-core-cli < input.json
```

You can also pass `--input-file` / `-i`:

```sh
./dist/kulala-core-cli --input-file input.json
```
