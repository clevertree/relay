Relay Tracker Postman

This folder contains a minimal Postman collection and environment for the Relay Tracker API (apps/tracker).

Files:
- tracker.postman_collection.json — Collection with GET /api/peers and POST /api/peers/upsert
- tracker.postman_environment.json — Environment with `tracker_base_url` and `DATABASE_URL` variables

How to use:
1. Import the collection (`tracker.postman_collection.json`) into Postman.
2. Import the environment (`tracker.postman_environment.json`) and set `tracker_base_url` to your running tracker (e.g. http://localhost:3000).
3. If you want the POST to hit a running tracker that requires DB access, set `DATABASE_URL` in the environment or start the tracker with a `.env.local` that contains it.
4. Run the requests.

Notes:
- The collection is intentionally small — extend it with additional tracker endpoints (e.g., peers by id) as needed.
- The repository already contains a broader collection at `postman/Relay.postman_collection.json` if you need server/file endpoints as well.
