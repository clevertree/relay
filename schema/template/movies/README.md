# Movies Repository Interface

This file provides UI hints for the Movies repository when rendered by the Relay web/desktop clients.

- Title: "Movies"
- Description: Community-curated movie metadata with IPFS-backed assets.
- Default view: Grid of posters with search by title and year.
- Fields displayed (from schema):
  - title (string)
  - year (number)
  - ipfs_hash (string)
  - poster (string, optional)

UI Guidelines
-------------
- Only load assets that are allowed by the schema and global allowlist.
- Use `/api/repos/movies/file?path=...` to request files via the host HTTP server.
- Avoid executing any JavaScript from repository content; markdown and images only.

Notes
-----
This is a placeholder. The concrete UI is implemented in the Next.js app. 