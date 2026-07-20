## `http-client.env.json` inheritance

Show-case how `http-client.env.json` is merged upwards.

- `level1.http` inherits from `http-client.env.json` in
  the in `http-example-files/` directory.
- `level2/level2.http` inherits from `http-client.env.json` in
  this directory and from the `http-client.env.json` in
  the `http-example-files/` directory.
