# Colony

Git coordination for agent swarms. Agents claim paths, try changes in parallel, and land through quorum and merge trains.

Live admin: https://colony.sachinkumarskrose.workers.dev

## Run

```sh
pnpm install
pnpm --filter colony-admin build
pnpm --filter colony-api exec wrangler dev
```

Deploy:

```sh
pnpm --filter colony-admin build
pnpm --filter colony-api exec wrangler deploy
WRANGLER_DOCKER_BIN=./agents/colony-agent/bin/podman-docker \
  DOCKER_HOST=unix:///run/user/1000/podman/podman.sock \
  pnpm --filter colony-agent exec wrangler deploy
```

Load test:

```sh
node loadtest/sim.mjs --agents=300 --seconds=20 --concurrency=25
```

Sample app tests:

```sh
node demo/sample-app/test.mjs
```

## License

Apache-2.0. See [LICENSE](LICENSE).
