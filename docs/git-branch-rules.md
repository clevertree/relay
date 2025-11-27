### Git branch/merge/commit rule system (relay.yaml → git:)

This document describes the `git` rule system defined in `relay.yaml` and validated by `relay.schema.yaml`. The rules
are consumed by the relay hooks/server to decide whether a commit or merge is allowed and what actions to perform
afterward (e.g., auto-push, webhook-triggered pulls).

#### Key concepts

- sources: Named upstream origins this repository can pull from.
- allowedOrigins: Repository-wide list of acceptable remote URLs for inbound histories (merge/pull validation).
- allowPullFrom: Repository-wide list of remote URLs the relay is allowed to pull from (applies to all branches unless a
  branch override exists).
- branchRules:
    - default: Baseline policy for all branches not explicitly listed.
    - branches[]: Per-branch overrides.
    - Policy knobs:
        - requireSigned: If true, only signed commits are accepted.
        - allowUnsigned: If true, unsigned commits are allowed (overrides requireSigned for that branch).
        - allowedKeys: Glob list of allowed public keys relative to the repository (e.g., `.ssh/*`).
        - allowedOrigins: Optional branch-specific override of repo `git.allowedOrigins`.
        - allowPullFrom: Optional branch-specific override of repo `git.allowPullFrom`.
- autoPush: Configure branches that should be automatically pushed to a list of peers asynchronously after new commits
  are accepted.
- hooks.github: A webhook endpoint configuration to trigger pulls when upstream changes occur.

#### Example (`template/relay.yaml`)

The template includes a complete example:

```
git:
  # Repo-wide origins and pull permissions
  allowedOrigins: ["https://github.com/clevertree/relay-template/"]
  allowPullFrom: ["https://github.com/clevertree/relay-template/"]
  sources:
    - name: template
      url: https://github.com/clevertree/relay-template/
  branchRules:
    default:
      requireSigned: true
      allowedKeys: [".ssh/*"]
    branches:
      - name: main
        rule:
          requireSigned: true
          allowedKeys: [".ssh/id_rsa.pub"]
      - name: public
        rule:
          allowUnsigned: true
  autoPush:
    branches: ["main", "staging", "develop"]
    peersEnv: "RELAY_MASTER_PEER_LIST"
    async: true
    debounceSeconds: 2
  hooks:
    github:
      enabled: true
      path: "/hooks/github"
      secretEnv: "RELAY_GITHUB_WEBHOOK_SECRET"
      events: ["push"]
      pullOn:
        origins: ["https://github.com/clevertree/relay-template/"]
        branches: ["*"]
```

#### Behavioral summary

1) Pull permissions

- Any branch may be pulled from the `template` origin via repo-wide `git.allowPullFrom`.

2) main branch acceptance

- Only commits signed by the specific key `.ssh/id_rsa.pub` OR inbound history pulled from the allowed origin are
  accepted.

3) public branch

- Anyone may commit; signatures are not required.

4) Other branches

- Fall back to `default`: signed commits required; any key in `.ssh/*` is accepted.

5) Auto-push

- When commits land on `main`, `staging`, or `develop`, an asynchronous task will push to peers listed in the
  `RELAY_MASTER_PEER_LIST` environment variable. The value must be a semicolon-separated list, e.g.:
    - `RELAY_MASTER_PEER_LIST=node-dfw1.relaynet.online.online;node2.relaynet.online;node3.relaynet.online`
- Async behavior ensures the commit path is not blocked; optional `debounceSeconds` coalesces rapid updates.

6) GitHub webhook-triggered pulls

- Configure a GitHub webhook (Repository Settings → Webhooks):
    - Payload URL: `https://<your-relay-host>/hooks/github`
    - Content type: `application/json`
    - Secret: choose a random secret string and set it on the relay host as environment variable
      `RELAY_GITHUB_WEBHOOK_SECRET`.
    - Events: `Just the push event` (or include others as desired).
- On receiving a valid webhook for a listed origin, the relay will asynchronously pull the updated branches according to
  `pullOn`.

#### Recommendations

- Use per-branch keys for high-trust branches (e.g., main) and a broader key glob for feature branches.
- Keep `.ssh/` inside the repo template, versioned, and protected by repository ACLs. Prefer public keys dedicated to
  automation (CI/CD) rather than developer personal keys when possible.
- Leave `autoPush.async` as true to avoid impacting commit latency. Tune `debounceSeconds` if your workflows generate
  rapid commit sequences.
- For multi-tenant deployments, set different `RELAY_MASTER_PEER_LIST` per environment via `.env` or container env to
  prevent accidental cross-environment replication.
- If mirroring a public upstream, pair repo-wide `allowedOrigins` and `allowPullFrom` with branch protection in the
  upstream to ensure integrity.

#### Schema notes

- The `git` section is optional and validated by `crates/relay-lib/assets/relay.schema.yaml`.
- Unknown fields under `git` are rejected by schema validation (`additionalProperties: false`) to ensure deterministic
  behavior.
