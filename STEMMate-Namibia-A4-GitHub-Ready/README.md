# STEMMate Namibia — A4 Demonstration

This repository contains the source code for the STEMMate Namibia offline-first facilitator activity library and session-planning demonstration.

## Important scope and safety notes

- This is an academic proof of concept, not a production service.
- Use fictional/synthetic data only. Do not enter real pupil or sensitive personal information.
- The Node.js receiving server is intentionally bound to `127.0.0.1` for local demonstrations.
- The receiver has no user authentication or TLS and must not be exposed to the public internet as-is.
- GitHub stores the source code; it does not run this Node.js server.
- GitHub Pages alone cannot run the `/api/plans` and `/api/received` endpoints required for synchronisation.

## Requirements

- Node.js 18 or later
- A modern browser (Chrome or Edge recommended)

No third-party npm packages are required.

## Run locally

From the repository root:

```powershell
node server.js
```

Then open:

```text
http://127.0.0.1:8080
```

Keep the terminal open while using the application. Press `Ctrl+C` to stop the local receiver.

## Run automated integration tests

From the repository root:

```powershell
node --test tests/server.test.cjs
```

The tests start an isolated temporary receiver and use synthetic test data.

## Local data

- Browser-side activity copies, drafts and completed plans are stored in IndexedDB for the browser origin.
- Server receipts are written to `server-data/received-plans.json` when a plan is received.
- `server-data/` is intentionally excluded from Git because it can contain session-plan content.
- Do not commit exported JSON backups or real user data.

## GitHub

Create a **private** GitHub repository for the coursework source. Do not upload private assessment evidence, participant records, student identifiers, exported application data, or secrets to a public repository.

For a remotely accessible production deployment, the backend would first need appropriate authentication, HTTPS, secure persistent storage, access controls, and a reviewed data-retention approach. This repository is configured for local academic demonstration only.
