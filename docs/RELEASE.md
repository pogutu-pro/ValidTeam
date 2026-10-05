# Release & Publishing Runbook

How to cut a ValidTeam release and publish the Docker image. SemVer; the
source of truth for the version is the root `package.json` `version`.

> Prerequisites: working tree clean, on `main` (or a release branch), `docker
login` as the **`stratnovo`** Docker Hub account, and `pnpm install` run.
>
> **Publication gate:** preparing or validating a release does not authorize an
> outward-facing action. Push commits/tags, create a GitHub release, and publish
> Docker Hub tags only when the user has explicitly approved each relevant
> destination in the current task. Deployment approval alone is not publication
> approval.

## 1. Pick the version

Decide the next SemVer number (`MAJOR.MINOR.PATCH`). The examples below use
`<v>`; derive the previous/current value from the root `package.json` rather
than a documentation snapshot.

## 2. Bump version references

Update the version in every pinned location:

- `package.json` → `"version"`
- `apps/web/package.json` → `"version"`
- `docker-compose.desktop.yml` → `stratnovo/validteam:<v>`
- any concrete version pin found with `rg '<current-version>'` (do not replace
  historical `CHANGELOG.md` entries)
- Regenerate the web API spec:
  ```bash
  pnpm --filter @validteam/web openapi:gen   # writes apps/web/public/openapi.json
  ```
  (Plain `pnpm openapi:gen` at the repo root fails with `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL` —
  the script only exists in the `@validteam/web` workspace.)

> `docker-compose.yml` (production) keeps the web service at `:latest` and is
> pinned at deploy time via `VALIDTEAM_IMAGE=stratnovo/validteam:<v>`, so it
> does not need editing.

## 3. Update the changelog

In `CHANGELOG.md`, move items from `[Unreleased]` into a new
`## [<v>] - YYYY-MM-DD` section (Keep a Changelog: `Added` / `Changed` /
`Fixed` / `Security`, etc.). Leave a fresh empty `[Unreleased]` heading.

## 4. Verify locally

Run the complete verification workflow (`/verify` in Claude Code, or the
canonical command list in `README.md`). It covers the MCP build, i18n,
repository hygiene, UI and documentation contracts, type-check, lint, tests,
OpenAPI drift, and `git diff --check`.

## 5. Commit, tag, push (GitHub authorization required)

Only perform this section when GitHub publication was explicitly authorized in
the current task. Releases go straight to `main` for the maintainer:

```bash
git pull --rebase
git add -A
git commit -m "chore(release): v<v>"   # author: Stratnovo <hello@stratnovo.com>
git push origin main
git tag -a v<v> -m "ValidTeam v<v>"
git push origin v<v>
```

## 6. Build & push the Docker image (registry authorization required)

Only perform this section when Docker Hub publication was explicitly
authorized, independently of GitHub. Image: `stratnovo/validteam`, platform
`linux/amd64`.

```bash
# Build the web image (uses the multi-stage Dockerfile, standalone output)
docker build \
  -t stratnovo/validteam:<v> \
  -t stratnovo/validteam:latest \
  --build-arg NEXT_PUBLIC_APP_URL=http://localhost:3000 \
  .
# (equivalently: docker compose build web)

# Push both tags
docker push stratnovo/validteam:<v>
docker push stratnovo/validteam:latest
```

Confirm the published digest:

```bash
docker buildx imagetools inspect stratnovo/validteam:<v>
```

## 7. Publish release notes (GitHub authorization required)

Create the GitHub release from the tag (notes can come from the changelog):

```bash
gh release create v<v> --title "v<v>" --notes-file <(sed -n '/## \[<v>\]/,/## \[/p' CHANGELOG.md)
```

## Rollback

Operators pin a known-good tag without a rebuild:

```bash
./scripts/validteam-backup.sh
VALIDTEAM_IMAGE=stratnovo/validteam:<previous> docker compose up -d
```

## Notes

- The runtime image runs DB migrations on start (`docker-entrypoint.sh`) and
  serves on port `3000` with health at `GET /api/health`.
- `scripts/validteam-backup.sh` writes a Postgres custom-format archive,
  uploads archive, manifest, and checksums before manual update or rollback
  work. Restore the database with `pg_restore` and restore `uploads.tar.gz` to
  the uploads volume before starting the target web image.
- There is no CI publish pipeline yet — releases are cut manually with this
  runbook. If/when a GitHub Actions workflow is added, it should mirror these
  steps.
