# Git Pull Timer Enhancement - Documentation

## Changes Made

### File: `/Users/ari.asulin/p/relay/docker/entrypoint.sh`

#### Problem Solved
- Original git-pull timer only called the relay server's `/git-pull` API without checking if all configured repos were cloned
- If GitHub was unavailable during startup, repos would never be cloned
- No mechanism to re-clone missing or incomplete repos
- No visibility into which repos were being updated

#### Solution Implemented

**Enhanced `start_git_pull_timer()` function** (lines 145-182):

1. **Initial Wait**: Waits 10 seconds for relay server to fully start before first update cycle
2. **Hourly Repo Re-Clone Check**: Every hour, the script:
   - Parses `RELAY_MASTER_REPO_LIST` environment variable
   - Extracts each repository URL from semicolon-separated list
   - Derives repo name from URL (strips trailing `.git`)
   - Checks if repo directory exists AND has a valid `/objects` directory
   - If repo is missing or incomplete, attempts to `git clone --bare` it
   - Logs success/failure with timestamp

3. **All Repos Git Pull**: After re-clone attempts, calls the relay server's `/git-pull` API:
   - The relay server handles pulling all repositories atomically
   - No need to loop through repos for pulls (server does this)

4. **Better Logging**:
   - Timestamps on all messages (`$(date)`)
   - Clear status messages for each action
   - Distinguishes between missing/incomplete repos and update cycles

#### Key Benefits

✅ **Resilience**: If GitHub is down on startup, repos will be automatically re-cloned on next hourly cycle  
✅ **Complete Cloning**: Detects incomplete clones (missing `/objects` dir) and fixes them  
✅ **Multi-Repo Support**: Properly handles multiple repos in `RELAY_MASTER_REPO_LIST`  
✅ **Atomic Updates**: Relay server's `/git-pull` API handles all repos in single operation  
✅ **Observability**: Clear logging of repo status, clone attempts, and results  

#### Configuration

Uses existing environment variables:
- `RELAY_MASTER_REPO_LIST` - Semicolon-separated list of repo URLs to clone
- `RELAY_REPO_ROOT` - Root directory for cloned repos (default: `/srv/relay/data`)
- `PORT_FOR_ADVERTISE` - Relay server port for API calls

Example `.env`:
```properties
RELAY_MASTER_REPO_LIST=https://github.com/clevertree/relay-template;https://github.com/another-org/repo2
```

#### Timing

- Initial update: 10 seconds after container start
- Subsequent updates: Every 3600 seconds (1 hour)
- Can be adjusted by changing `sleep 3600` value

#### Error Handling

- Missing repos are retried every cycle (eventually succeeds when GitHub is available)
- git-pull API errors are logged but don't stop the timer
- All errors are non-fatal (container continues running)

## Testing

To test the enhancement:

1. **Normal flow**:
   ```bash
   docker run --env-file .env relay:latest
   # Check logs: docker logs <container> | grep "Running periodic"
   ```

2. **Simulate missing repo** (after container starts):
   ```bash
   docker exec <container> rm -rf /srv/relay/data/repo-name.git
   # On next hourly cycle, will re-clone automatically
   ```

3. **Monitor repo status**:
   ```bash
   docker logs <container> | grep -E "Cloning|re-cloned|git-pull"
   ```

## Backward Compatibility

✅ Fully backward compatible - all changes are additions/improvements  
✅ No breaking changes to existing behavior  
✅ Works with single or multiple repos  
✅ Gracefully handles empty `RELAY_MASTER_REPO_LIST`
