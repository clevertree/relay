# Publishing images to GitHub Container Registry (GHCR)

This document explains how to create a personal access token (PAT) for GHCR, add it as a repository secret, and troubleshoot common problems when pushing images from GitHub Actions.

## Create a PAT for GHCR

1. Open GitHub Personal Access Tokens: https://github.com/settings/tokens
2. Click **Generate new token** and choose **Fine-grained token** or **Classic token**.
3. Recommended scopes for classic PAT:
   - `write:packages` (required)
   - `read:packages` (recommended)
   - `repo` (required if the repository is private)
4. For fine-grained tokens, grant access to `clevertree/relay` and give the token **Packages → Read and write** permission.
5. Generate the token and copy it immediately — you'll only see it once.

## Add PAT as repository secret

1. Open repository settings: https://github.com/clevertree/relay/settings/secrets/actions
2. Click **New repository secret**.
3. Set the **Name** to `GHCR_PAT` and **Value** to your PAT.
4. Save the secret.

CLI alternative:

```bash
# Export token into $TOKEN locally then run:
gh secret set GHCR_PAT --body "$TOKEN" --repo clevertree/relay
```

## Workflow usage

Use the secret in GitHub Actions to login to GHCR. Example snippet:

```yaml
- name: Choose registry credentials
  run: |
    if [ -n "${{ secrets.GHCR_PAT }}" ]; then
      echo "REGISTRY_PASSWORD=${{ secrets.GHCR_PAT }}" >> $GITHUB_ENV
    else
      echo "REGISTRY_PASSWORD=${{ secrets.GITHUB_TOKEN }}" >> $GITHUB_ENV
    fi

- name: Login to GHCR
  uses: docker/login-action@v2
  with:
    registry: ghcr.io
    username: ${{ github.actor }}
    password: ${{ env.REGISTRY_PASSWORD }}

- name: Build and push
  run: |
    docker buildx build --platform linux/amd64,linux/arm64 \
      --push -t ghcr.io/${{ github.repository_owner }}/relay:latest -f crates/relay-cli/Dockerfile .
```

Notes:
- `GITHUB_TOKEN` may be sufficient in some orgs, but many orgs restrict package writes — use `GHCR_PAT` when you need `write:packages`.
- For private repositories, ensure the PAT has `repo` scope (classic) or repo access for fine-grained PAT.

## Troubleshooting

- Error: `denied: permission_denied: write_package`
  - Cause: token used for `docker login` does not have `write:packages` permission or GHCR org policy blocks `GITHUB_TOKEN` pushes.
  - Fix: add `GHCR_PAT` with `write:packages` and re-run the workflow.

- Error: `No files were found` on artifact upload
  - Cause: workflow upload path doesn't match actual binary name or build output path.
  - Fix: confirm the binary name in `crates/relay-cli/Cargo.toml` and the path `target/${{ matrix.target }}/release/<binary-name>`.

- If builds take long when running `docker buildx build` inside Actions, consider splitting binary builds into matrix jobs and uploading artifacts, then use those artifacts during the docker build (or rely on buildx to compile inside the builder image).

## Quick commands

Trigger the workflow after adding the secret:

```bash
gh workflow run build-arch.yml --repo clevertree/relay --ref ci/fix-build-arch
gh run watch --repo clevertree/relay $(gh run list --workflow=build-arch.yml --repo clevertree/relay --limit 1 --json databaseId -q '.[0].databaseId')
```

---
If you want, I can (after you confirm the secret was added) re-run the workflow and stream logs live to verify the push succeeded. If you want me to modify the workflow to avoid pushing until we confirm everything, tell me and I will patch and run a `--load` test instead.
