# Free Plan Upgrade Example

This example shows app code for a free-plan tenant upgrade. `@async/db` only provides forks, branches, snapshots, migration locks, resource migration, and routing. The app decides that moving `projects` from JSON to another store means "upgrade to paid."

Run it from the repository root:

```bash
npm run db -- sync --cwd ./examples/free-plan-upgrade
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
