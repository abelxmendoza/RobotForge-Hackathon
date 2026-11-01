# Submission Hardening Design

## Intent

Make the November 4 RobotForge submission reproducible and honest: one deterministic release gate, a production build that is actually exercised, current launch documentation, and explicit separation between locally verified behavior and credentialed production checks.

## Goals

- Remove external network access from the physics integration test.
- Replace misleading static-text parity checks with route and product-marker checks that match the client-rendered Next.js architecture.
- Run the Python suite and Next.js production build in CI.
- Keep submission links and hosting/deployment documentation internally consistent.
- Provide a safe production smoke procedure for the live Worker without handling secrets.

## Non-goals

- Deploying Vercel or Cloudflare, changing production secrets, or spending model credits.
- Adding new product features before the submission.
- Claiming GPU/mobile behavior without tests on real WebGL-capable browsers.
- Connecting assembly planning data to engineering checks; that remains the first post-submission product project.

## Constraints

- Preserve provider credentials outside the repository and logs.
- Tests must pass without Internet access or live model providers.
- Keep the existing Python, Node, Next.js, and GitHub Actions stack.
- A browser smoke check must validate meaningful RobotForge content, not just HTTP 200 responses.

## Approaches

1. Keep network tests and retry them. Rejected because retries preserve nondeterminism and hide policy failures.
2. Add a full Playwright end-to-end suite immediately. Deferred because browser installation and WebGL coverage are too large for the pre-submission window.
3. Vendor the two small official URDF inputs, test exported route markers deterministically, and add a lightweight live-service probe. Selected because it directly closes the observed failures with minimal new machinery.

## Deliverables

- Repository-owned TurtleBot3 Burger and Unitree Go2 URDF fixtures used by the physics integration test.
- A route smoke script that checks exported pages and key product content using Next build artifacts rather than naive script stripping.
- CI that runs Python tests, the Next production build, and the route smoke script.
- Updated README/live runbook language and a credential-free Worker health checker.
- A final audit report distinguishing passed checks, external deployment checks, and real-device GPU QA.

