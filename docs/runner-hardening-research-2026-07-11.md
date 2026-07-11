# Self-Hosted Runner Hardening — Research Report (2026-07-11)

Deep-research output (fan-out web search → source fetch → 3-vote adversarial verification).
Every claim below was independently confirmed 3-0 against GitHub's documented security model or
reputable security research. Synthesized into a concrete checklist for CalSight's exact topology:
a **self-hosted runner on a public repo**, on a Proxmox LXC alongside the production services it
deploys, that **persists `backend/.env` (DB, LLM, R2, Cloudflare secrets) between runs** and runs
`docker compose` to deploy.

> The workflow's own synthesis step was interrupted by a session usage limit; this report is
> hand-synthesized from its 12 verified claims. Sources are cited inline.

## The core tension

CalSight runs a self-hosted runner on a **public** repository. GitHub is explicit that this is
dangerous:

- *"Self-hosted runners … do not have guarantees around running in ephemeral clean virtual
  machines, and can be persistently compromised by untrusted code in a workflow."* — [GitHub
  docs](https://docs.github.com/en/actions/reference/runners/self-hosted-runners) (3-0)
- *"It is recommended that you only use self-hosted runners with private repositories, because
  forks of your public repository can potentially run dangerous code on your self-hosted runner
  machine by creating a pull request that executes the code in a workflow."* — [GitHub docs](https://docs.github.com/en/actions/reference/runners/self-hosted-runners) (3-0)

**What already protects CalSight (verified in the code audits):** CI runs on GitHub-hosted
`ubuntu-latest`, not the self-hosted runner. The self-hosted jobs live only in `deploy.yml` /
`run-etl.yml`, gated on `workflow_run` with `event == 'push' && head_branch == 'main' &&
head_repository.full_name == github.repository`. A fork PR produces a CI run with
`event == 'pull_request'`, which the guard rejects — so **untrusted PR code never executes on the
self-hosted runner**. This is the single most important control and it is correctly in place. The
recommendations below reduce the *residual* blast radius if that control (or a dependency) is ever
subverted.

## Verified threat model

1. **Persistent compromise & rogue-runner backdoors.** A self-hosted runner that executes hostile
   code can be permanently backdoored. A documented technique sets `RUNNER_TRACKING_ID=0` to
   *bypass the runner's post-job cleanup*, letting attacker processes survive after the workflow
   ends. — [Sysdig](https://www.sysdig.com/blog/how-threat-actors-are-using-self-hosted-github-actions-runners-as-backdoors) (3-0)
2. **Fork-PR / "pwn request" on public repos.** Anyone with read access can fork and open a PR;
   if a workflow checks out and runs that code, the attacker steals the `GITHUB_TOKEN` and secrets.
   — [GitHub docs](https://docs.github.com/en/actions/reference/runners/self-hosted-runners),
   [The Hacker News](https://thehackernews.com/2026/06/github-updates-actionscheckout-to-block.html) (3-0)
3. **`pull_request_target` privilege.** It runs in the *base* repo context with access to secrets
   and a privileged token; checking out + running PR code under it hands over high-privilege
   access immediately. Recent supply-chain attacks weaponized exactly this. — [Sysdig](https://www.sysdig.com/blog/how-threat-actors-are-using-self-hosted-github-actions-runners-as-backdoors),
   [The Hacker News](https://thehackernews.com/2026/06/github-updates-actionscheckout-to-block.html) (3-0)
   *(CalSight's one `pull_request_target` use — `depends-on.yml` — never checks out or runs PR
   code and is same-repo-gated, verified in the audits.)*

## Prioritized hardening checklist for CalSight

### Tier 1 — eliminate persistent secrets (highest leverage, given the `.env` model)

1. **Move R2 (and any cloud) credentials to GitHub Actions OIDC.** OIDC lets a workflow
   authenticate to a provider *"without having to store any credentials as long-lived GitHub
   secrets,"* and the issued token is *"available only to that job run."* —
   [GitHub OIDC docs](https://docs.github.com/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-cloud-providers)
   (both 3-0). Cloudflare R2 supports OIDC via its S3-compatible STS-style flow; replacing the
   persisted `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` in `backend/.env` with an OIDC-derived
   short-lived token removes the most portable secret from disk. Requires `permissions: id-token:
   write` on the specific job and a trust policy scoped to `repo:JeffreySardella/CalSight:ref:refs/heads/main`.
2. **Stop persisting the full `.env` between runs where possible.** The deploy workflow already
   writes managed keys via a temp-file-swap merge; the remaining long-lived secrets that *can't*
   move to OIDC (DB password, LLM keys) should live in a host secret store (systemd
   `LoadCredential`, a root-only file with `0600`, or Docker/compose secrets) that the container
   reads at start, rather than a checkout-resident `.env` readable by any process the runner
   spawns.

### Tier 2 — make the runner ephemeral / harder to backdoor

3. **Switch to just-in-time (JIT) ephemeral runners.** GitHub supports registering runners that
   *"perform a single job before the registration is cleaned up."* —
   [GitHub docs](https://docs.github.com/en/actions/reference/runners/self-hosted-runners) (3-0).
   Pair a JIT runner with a **fresh LXC/VM per job** (Proxmox can clone from a template) so a
   compromised build gets a clean environment and can't persist. This directly defeats the
   `RUNNER_TRACKING_ID=0` cleanup-bypass and rogue-runner persistence class.
4. **If ephemeral-per-job isn't feasible now,** at minimum run the runner as a **dedicated
   low-privilege user** (not root; the audit flagged the runner has some passwordless `sudo`),
   with the runner's registration token treated as sensitive, and monitor for orphaned processes
   after jobs.

### Tier 3 — shrink blast radius toward production

5. **Isolate the runner from the production services it deploys.** Today the runner shares the
   LXC with FastAPI + Postgres + the tunnel, so a compromised build sits next to the live DB and
   `backend/.env`. Move the runner to a **separate LXC/VM** that reaches prod only through a
   narrow, audited channel (e.g. it triggers a deploy on the prod host over SSH with a
   command-restricted key, or pushes an image to a registry the prod host pulls) rather than
   building and running `docker compose` *on* the prod box. This is the difference between "build
   compromise = prod compromise" and "build compromise = one throwaway VM."
6. **Build images off the prod host and ship digests.** Combined with #5: build on the ephemeral
   runner, push a `@sha256:`-pinned image, have prod pull it — so a poisoned base tag or malicious
   transitive dep never executes adjacent to prod secrets. (Ties to deep-audit SC-1/SC-3.)

### Tier 4 — supply-chain & trust-boundary hygiene (mostly already done)

7. **Upgrade `actions/checkout` to v7.** As of **v7 (effective 2026-06-18)** it *"refuses to
   fetch fork pull request code in `pull_request_target` and `workflow_run` workflows"* by
   default — closing the pwn-request/poisoned-pipeline vector at the action level. —
   [The Hacker News](https://thehackernews.com/2026/06/github-updates-actionscheckout-to-block.html)
   (3-0). CalSight currently pins `actions/checkout@11bd719` (v4.2.2); bumping to a v7 SHA adds a
   defense-in-depth layer beneath the existing `workflow_run` guard. *(Re-verify the workflow_run
   deploy still checks out the intended `DEPLOY_SHA` after upgrading — the refusal targets
   fork-PR code specifically.)*
8. **Keep the existing controls** the audits verified: the `workflow_run` fork-spoof guard, the
   `DEPLOY_SHA` freshness/re-run guard, SHA-pinned actions, `persist-credentials: false`, the
   `contents: read` default token (deep-audit SC-1, now fixed), and secrets flowing only through
   `env:`. These are the reason untrusted code doesn't reach the runner today.
9. **Consider disabling forks / requiring approval for first-time contributors' workflow runs**
   (repo setting) as belt-and-suspenders for the public-repo fork risk (3-0 across sources).

## Priority order for CalSight specifically

Given the existing `workflow_run` gate already blocks the primary fork-PR execution path, the
highest *marginal* wins are **Tier 1 (OIDC for R2 + stop persisting `.env`)** and **Tier 3
(separate the runner from the prod host)** — those change the outcome of a *dependency* or
*build-time* compromise from "production secrets and DB exposed" to "one disposable VM exposed."
`actions/checkout` v7 (Tier 4 #7) is a cheap, high-value pin bump. JIT/ephemeral runners (Tier 2)
are the structural end state.

---
*Verification: 12 claims confirmed 3-0; sources are GitHub's official Actions/OIDC documentation,
Sysdig threat research, and reporting on the 2026-06 `actions/checkout` v7 change. The automated
synthesis pass did not run (session limit); this checklist is hand-derived from the verified
claims and cross-referenced against CalSight's committed workflows.*
