@relay/protocol — OpenAPI Spec

Provides the shared OpenAPI 3.0 spec for the Relay API and a few common constants.

Contents
- openapi.yaml — API spec
- index.ts — exports path and constants

API Highlights
- Header X-Relay-Branch selects branch, default main
- CRUD on any path (except .html/.htm/.js)
- POST /status returns status, branches, sample paths, capabilities [git, torrent, ipfs, http]
- POST /query — not implemented; recommended to use a local index DB maintained via hooks

Usage
import { RELAY_OPENAPI_PATH, DEFAULT_BRANCH } from '@relay/protocol'
