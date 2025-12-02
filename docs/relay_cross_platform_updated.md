# Relay Cross-Platform Desktop and Mobile Solution

## Overview
Relay provides a fully cross-platform solution that supports both desktop and mobile experiences. Relay’s vision is unique in that it offers a **unified interface** where the specifics of how the interface operates and how data is stored are defined by the repository itself.

Developers retain full control over the experience, and Relay imposes no limitations on how the internal functionality works on the server or client side.

---

## How It Works

### Unified Interface by Repository
- Each repository defines its own behavior through three key scripts:
  - **Pre-commit hook**: runs on commits to prepare or validate changes.
  - **GET hook**: handles HTTP GET requests and serves or transforms content.
  - **QUERY hook**: processes structured queries against repository data.
- These scripts are managed by a Node.js module file that **can only be modified by the admin key** (commits to this file require admin signature).
- A **validation script** (executed in a sandbox with tightly limited OS/web access) sits alongside these hooks and validates input files and metadata fields. The validation script can be edited by sub-admins or authorized users to customize input validation safely.

### Database Updates
- On every Git commit, the repository’s database is **updated** (incrementally), not fully rebuilt. This ensures fast, predictable updates while keeping data consistent and queryable.

### Full Customization
- The **QUERY** script determines how data is queried; commonly a lightweight database or index is updated per commit and used to answer queries.
- End developers have **100% control** over the database experience and how the app behaves across platforms (Android, iOS, desktop, web).
- Developers can export a repository’s app to any platform or allow it to be accessed through generic Relay clients.

### Cross-Platform Flexibility
- Relay supports any type of experience, from rich graphical interfaces to simple CRUD database apps.
- The platform minimizes concerns about the underlying technology stack, letting developers focus on UX and functionality.

---

## Security & Permissions
- **Admin-only hooks:** Critical Node.js hook files require admin-signed commits to change, protecting core behavior.
- **Sandboxed validation:** Validation scripts run in a restricted environment to prevent abuse and protect node resources.
- **Granular permissions:** Repositories can define what parts are editable by which keys or anonymous users.

---

## Developer Workflow Example
1. Developer commits content and hook changes to the development branch.
2. The pre-commit hook runs validation and prepares data for indexing.
3. The commit is accepted; the repo’s database is incrementally updated.
4. Staging/volunteer reviewers test via the staging branch.
5. After approvals, staging merges to main; the updated data becomes live immediately.

No full rebuilds. No lengthy deployment pipelines. Just controlled commits and incremental updates.

---

## Benefits
- **Unified codebase:** One repository defines behavior for desktop, mobile, and web.
- **Admin-enforced stability:** Core hooks are admin-protected to prevent unauthorized changes.
- **Safe extensibility:** Sandboxed validation enables trusted customization.
- **Platform-agnostic export:** Repo contents can be packaged as native apps or consumed by generic clients.
- **Fast incremental updates:** Database updates on commit enable near-instant data availability.

---

## Final Summary
Relay’s cross-platform feature gives developers the freedom to author rich, platform-spanning applications while keeping control, security, and performance centralized at the repository level. Incremental DB updates on each commit make the system responsive and efficient without imposing heavy deployment or build processes.
