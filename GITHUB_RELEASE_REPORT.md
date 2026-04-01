# GitHub Release Report

Date: 2026-03-30

## Completed

- Removed the old local `System.Speech` voice helper and related documentation
- Moved live credentials out of the repository root and into `secure/local.env`
- Added `.gitignore` rules for `secure/*`, local logs, and `node_modules/`
- Removed hardcoded Arduino Cloud credentials from `server.js`
- Replaced public example values with placeholders in docs and `.env.example`
- Added a public `README.md` for GitHub visitors

## Current Publishable Files

- `server.js`
- `package.json`
- `README.md`
- `MANUAL.md`
- `.env.example`
- `docs/`

## Local-Only Files

- `secure/local.env`
- `secure/university-space.pdf`
- local server logs

These are ignored by Git and should not be published.

## Risks To Address Before Publishing

- If the Arduino credentials were ever committed, pasted, or shared before this cleanup, rotate them.
- Confirm the repository description and name are what you want externally.

## Suggested Final Pre-Push Checks

1. Run the server locally and confirm the main routes still work.
2. Run `git status` and verify no secret files are staged.
3. Rotate credentials if they were previously exposed.
4. Push only the tracked project files, not `secure/local.env`.
