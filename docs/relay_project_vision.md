# Relay Project Vision

## Overview
Relay is a decentralized, branch‑oriented web platform that allows users to browse, edit, and collaboratively evolve websites through Git‑powered functionality. It creates a safe, interactive, and high‑performance environment where public participation and administrative workflows coexist securely.

---

## Interactive Branch‑Based Browsing
Relay allows users to browse websites in a highly interactive way:
- When browsing the **main branch**, users see the published, authoritative version of a website.
- Because Relay uses Git repositories under the hood, users can **switch to other branches**.
- On branches where they have permission, users can **edit any visible file**.
- Some branches are publicly editable, enabling community contributions.
- Users can submit **pull/merge requests** to propose updates to the main branch.

---

## Decentralization
Relay operates as a decentralized network of master peer nodes:
- Each master peer node contains a **full copy of every branch** of each repository.
- When a user makes an edit to a branch, it **synchronizes across the Relay network**.
- This ensures consistency and resilience while still enabling distributed hosting and contributions.

---

## Use Cases

### 1. **User‑Hosted Websites Without Traditional Hosting**
Users can create personal websites without owning any server or hosting service:
- Users place their files (Markdown index, CSS assets, media, etc.) in the **public user repo**.
- Their website becomes browsable across the decentralized Relay network.
- **Security restrictions apply:**
  - Users cannot host raw JavaScript or HTML, preventing common exploit avenues.
  - Instead, they use **Markdown components**—HTML‑like elements expressed in Markdown that enable safe, interactive client functionality.
- Users may only modify files tied to their public identity key, ensuring isolation and integrity.

### 2. **Movie Repository Editing via TMDB Plugin**
A user browsing the movie repository notices a missing movie:
- They use the **TMDB plugin** to search for the movie.
- They press a button to insert that movie into the **beta branch** (where they have permission).
- As they browse the beta branch, they will see their newly inserted movie entry.

### 3. **Voting and Review Branches**
Relay supports a voting system through a dedicated plugin:
- When voting is initiated on a repository, the server automatically **creates a voting branch** from main.
- A special voting/review file—normally disallowed on main—is placed into this branch.
- Users can:
  - Leave reviews
  - Submit complaints
  - Create voting items related to any part of the site
- These interactions do **not modify main**, preserving website integrity.
- Voting and review mechanics will be defined further, but the branch enables structured community feedback.

---

## Blockchain Security
Relay incorporates blockchain‑style cryptographic controls:
- Git commits may be signed using **certificate‑based cryptographic keys**.
- Eventually, **only the private key used to create the repository** can authorize main‑branch modifications.
- This allows the repository’s creator to retain ultimate control, even in a fully distributed network.
- Master peer nodes enforce security rules defined in **rules.yaml**, such as:
  - Which branches can be edited
  - Which actions require signatures
  - Which parts of the repository correspond to which public keys
- **Most actions do not require private keys.** Anonymous edits are allowed except in cases requiring permission.

---

## Pull Requests
Relay implements semi‑automatic pull request mechanics:
- When a branch becomes out of sync with main, a potential **pull request** becomes visible.
- Users and admins can see all open or suggested pull requests.
- An admin typically approves merges, but servers may be configured to:
  - Allow merges if a sufficient number of registered non‑admin users approve.
- This creates a hybrid model of community governance and administrative oversight.

---

## Performance Focus
Relay is designed with performance as a top priority:
- Rust powers the core system, ensuring high‑efficiency transaction and synchronization handling.
- Rendering performance is optimized to deliver responsive user experiences.

### Zero‑Downtime, Instant Deployment
Relay redefines deployment:
- Traditional CI/CD pipelines are unnecessary.
- As soon as a commit is accepted by the server, **the website is effectively deployed**.
- The HTTP server reads **directly from the Git repository**, enabling:
  - Zero delay deployments
  - Zero downtime
  - Continuous, seamless updates

---

## Security Summary
Relay enables users to engage in website administration safely:
- By default, Relay **blocks risky content** such as raw HTML and JavaScript.
- Users are forced into safe, rule‑governed formats like Markdown components.
- Built‑in branch and identity rules reduce opportunities for malicious behavior.

---

## Final Summary
Relay is a decentralized, Git‑driven platform that transforms website interaction, contribution, and administration. It merges security, community participation, and cryptographic control with a high‑performance system engineered for instant deployment and seamless collaboration. Users gain unprecedented abilities to participate in the evolution of websites—without compromising safety or stability.

