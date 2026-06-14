# Free Plan Upgrade Example

## What This Teaches

Use this when one tenant resource outgrows JSON and must move to another store without rewriting app data access. `@async/db` provides forks, branches, snapshots, migration locks, resource migration, and routing; the app decides that moving `projects` off JSON means "upgrade to paid."

## Run It

Run it from the repository root:

```bash
pnpm run db -- sync --cwd ./examples/free-plan-upgrade
node ./examples/free-plan-upgrade/src/upgrade-tenant-to-paid.js
```

The script:

- creates a tenant fork from the root JSON data
- snapshots `projects`
- locks `projects` as read-only
- migrates `projects` to a fake paid store
- verifies count/checksum
- switches routing
- keeps the original JSON snapshot as backup data

The fake paid store stands in for Postgres so the example stays dependency-light.
