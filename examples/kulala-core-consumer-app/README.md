# kulala-core-consumer-app (example)

This example demonstrates consuming `kulala-core` **as a library** with a direct async API:

- no stdin payloads
- no stdout/stderr protocol
- just `await kulalaCore.run(...)`

## Build

```sh
cd examples/kulala-core-consumer-app
bun install
bun run build
```

## Run

```sh
cd examples/kulala-core-consumer-app
./dist/kulala-core-consumer-app
```
