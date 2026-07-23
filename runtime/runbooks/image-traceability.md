# Image Traceability — Immutable Staging Tags + OCI Provenance Labels

**Status:** introduced by GWX-R1 staging navigation recovery (branch
`gwx/r1-staging-nav-recovery`).
**Problem it closes:** the staging app image running today carries no OCI
provenance labels and a mutable-style tag, so it cannot be tied to a Git
commit. Diagnosing "staging behaves differently from source" required
guessing. This runbook makes every future image self-identifying.

All commands below are **operator-executed** (Ledger §6 — models never build,
tag, pin, or deploy images).

## 1. Immutable tag pattern

```
groundworx-app:<short-sha>-<card>
```

- `<short-sha>` — `git rev-parse --short HEAD` of the exact commit being
  built. The working tree must be clean (`git status --porcelain` empty);
  never build from a dirty worktree.
- `<card>` — the queue-card / objective slug, e.g. `r1-nav`.
- Example for this recovery: `groundworx-app:<short-sha>-r1-nav`.
- Never re-push a tag to point at a different image. Rollback = repin the
  previous immutable tag, never rebuild under the same name.

## 2. OCI provenance labels

The `runner` stage of `Dockerfile` accepts three build args and stamps them
as standard OCI labels. The same `IMAGE_REVISION` value is also available to
processes inside the container as `APP_IMAGE_REVISION`; there is no separate
runtime revision build argument.

| Build arg        | Label                               | Runtime variable       | Value                            |
| ---------------- | ----------------------------------- | ---------------------- | -------------------------------- |
| `IMAGE_REVISION` | `org.opencontainers.image.revision` | `APP_IMAGE_REVISION`   | full Git SHA of the built commit |
| `IMAGE_CREATED`  | `org.opencontainers.image.created`  | —                      | ISO 8601 UTC build timestamp     |
| `IMAGE_SOURCE`   | `org.opencontainers.image.source`   | —                      | repository URL                   |

Unset args produce empty labels rather than failing the build — **the build
command is the enforcement point**; always use the canonical form below. An
empty or `unknown` revision is untraceable and must not pass an operator gate.

## 3. Canonical build command (operator)

Run from a clean host checkout at the commit to be built:

```bash
git status --porcelain            # must print nothing
SHA=$(git rev-parse HEAD)
SHORT=$(git rev-parse --short HEAD)
docker build \
  --build-arg IMAGE_REVISION="$SHA" \
  --build-arg IMAGE_CREATED="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg IMAGE_SOURCE="https://github.com/ghostdwg/construction-dashboard" \
  -t "groundworx-app:${SHORT}-<card>" \
  .
```

## 4. Verifying any image's provenance (operator, read-only)

```bash
docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' <image>
docker inspect --format '{{json .Config.Labels}}' <image>
docker images --digests groundworx-app
docker exec <container> printenv APP_IMAGE_REVISION
```

Confirm that the runtime value is present, is not `unknown`, and exactly
matches the OCI label:

```bash
IMAGE_REVISION=$(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' <container>)
docker exec <container> sh -c 'test -n "$APP_IMAGE_REVISION" && test "$APP_IMAGE_REVISION" != unknown'
test "$(docker exec <container> printenv APP_IMAGE_REVISION)" = "$IMAGE_REVISION"
```

An image with an empty or `unknown` revision value must be treated as
**untraceable**: do not reason about its behavior from current source; replace
it with a traceable build at the next approved deploy gate.
