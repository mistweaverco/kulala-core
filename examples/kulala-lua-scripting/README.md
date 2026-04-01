# kulala-lua-scripting (example)

This example demonstrates **Lua scripting** with `kulala-core` (Lua 5.1 VM embedded via WASM).

It shows:

- pre-request Lua setting `request.variables`
- post-request Lua reading `response.status`, `response.headers`, `response.body` (string or parsed JSON, JetBrains-style)
- persistent `client.global` variables

## Run

```sh
cd examples/kulala-lua-scripting
bun install
bun run build
./dist/kulala-lua-scripting
```
