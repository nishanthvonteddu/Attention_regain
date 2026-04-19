# Attention Regain Memory

## Product Snapshot

- Stage: `functional POC moving toward single-user MVP`
- Current app: `Next.js` web app with upload, PDF extraction, study feed UI, and local session behavior
- Current scope: `single-user local MVP first`, cloud auth/storage/hosting later
- Source of truth for delivery: GitHub day milestones `#2` to `#16`, parent issues `#1` to `#15`, child issues `#17` to `#76`

## Core Product Rules

- Audience: `exam prep`
- Inputs: `PDF` and `pasted text`
- Output: `grounded study cards`
- Every card must stay tied to source material
- Creative wording is allowed, invented facts are not
- UX quality is a hard requirement

## AI Stack

- Embedding: `nvidia/llama-3.2-nemoretriever-300m-embed-v1`
- Rerank: `nv-rerank-qa-mistral-4b:1`
- Generation: `meta/llama-3.1-70b-instruct`
- Vision fallback: `meta/llama-3.2-90b-vision-instruct`

## Local MVP Architecture

- Runtime: local `Next.js`
- Secrets: local `.env.local`
- Persistence: browser and local-first until backend storage is added
- Validation target: buildable, testable, and polished for one user

## Automation Rules

- Always start from the lowest open day issue
- Prefer the lowest open child issue under that day
- Do not skip forward unless the lower issue is blocked and the blocker is written here
- Work on a review branch, never directly on `main`
- Update this file every run

## Current Focus

- Next target day: `Day 01 - Project foundation, environment, and CI setup`
- Current blockers: `none recorded`

## Run Log

### 2026-04-18 - Automation setup

- Added repo memory file
- Added daily automation runbook
- Added reusable preflight script and package alias
- Ran `pnpm preflight:mvp`
- Result: `pnpm build` passed
- Result: `lint` and `test` scripts are not defined yet and remain Day 1 work
- Daily automation is intended to execute against the next unfinished day issue
- Next expected work item: `#17 Day 01.1 - Define repo standards, branch flow, and delivery scripts`
