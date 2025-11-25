# Relay Project Vision (Updated)

## Overview

Relay is a decentralized, Git‑driven web platform enabling interactive browsing, safe contribution, AI‑assisted
management, and decentralized hosting through a network of master peer nodes.

---

## Interactive Branch-Based Browsing

- Main branch shows the authoritative deployed site.
- Users can switch to other branches (e.g., development, staging) for broader access.
- Public branches allow anonymous contributions.
- Pull/merge requests synchronize differences between branches.

---

## Decentralization

- Every master peer contains a full copy of every branch.
- Edits synchronize across the network.
- Repositories remain resilient and globally available.

---

## Use Cases

### 1. User Websites Without Hosting

- Users create Markdown-based sites in a public repo.
- Security prevents raw HTML/JS; users instead rely on Markdown components.
- Users can only modify areas tied to their identity key.

### 2. Movie Repository TMDB Integration

- Users add missing movies via TMDB plugin into a beta branch.
- Edits persist while browsing that branch.

### 3. Voting & Review Branches

- Servers auto‑create a voting branch when needed.
- Special files enable reviews, complaints, and structured feedback.
- Voting can also be used to approve community changes to the website.

---

## Blockchain-Style Security

- Commits can be signed with certificates.
- Typically only the private keyholder can authorize main-branch changes.
- `relay.yaml` is processed by the server and defines what actions are allowed and by whom.
- Most actions allow anonymous users; identity is only required for restricted operations.

---

## Pull Requests

- Branch drift reveals potential pull requests.
- Users and admins can see all active PRs.
- Admin approval is default, but rules may allow merge based on community votes.

---

## Performance

- Relay is built in Rust for maximal performance.
- Zero‑delay, zero‑downtime deployment—HTTP.
- Server reads directly from Git repositories.
- No CI/CD pipeline, required.

---

## Hosting & Sponsorship

- Master nodes can host any repository but may not store all repos.
- Repositories require sponsorship from at least one master node.
- As long as repos follow size rules, they receive free hosting indefinitely.
- Public‑private keys enforce permissions for sensitive files.
- Creators can rotate keys via upstream (e.g., GitHub) if necessary.
- Lost keys allow forking and reasserting ownership without losing history.

### Relay Server Binary

- Relay server is a high‑performance Rust HTTP server reading directly from Git.
- Requires environments that allow running binaries; Docker is primary solution.
- Anyone can run a Dockerized Relay node which comes with http, git, ipfs, and other services built in.
- Nodes connect through a tracker (future versions will provide decentralized trackers).

---

## The Relay Promise

A standard set of web protocols guaranteed by all Relay master nodes:

- Supports GET, POST, PUT, DELETE, and QUERY.
- Any client can interact with Relay as long as it follows these protocols.
- Any website built on Relay protocols is accessible by any client implementing them.
- Relay does not enforce UI or specific clients—fully open ecosystem.

---

## Decentralization Without Expensive Hardware

- Master nodes can run advanced services: Git, HTTP, IPFS, torrent, Docker workloads, game servers.
- Websites gain capabilities far beyond static/dynamic hosting.
- Idle hardware across the network can be used to support demanding tasks.

---

## AI-Capable Future

- Relay data will be accessible through a standardized AI model.
- Idle hardware will power a shared Relay LLM.
- AI will help with repo setup, rule management, QA, abuse detection, and automation.
- Keeps costs zero by distributing compute across idle nodes.

---

## Branching Strategy

- Main branch: deployed content.
- Development branch: anonymous, messy, experimental contributions.
- Staging branch: controlled QA and volunteer reviews.
- PR process governs merges into main.
- Relay does not mandate branch names or patterns but guarantees a place for anonymous contribution.

## Ready for Web3.0

- Relay leverages the principles of the Internet's next evolutionary phase.
- Web3.0 involves shifting power and data ownership from centralized corporations back to the users.

---

## Final Summary

Relay is a secure, decentralized, high‑performance collaborative web platform. It empowers users to contribute safely,
host websites without an infrastructure, participate in governance, and eventually leverage AI assistance—all while
keeping
the network open, resilient, and community‑driven.

