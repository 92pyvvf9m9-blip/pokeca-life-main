Pokeca Life v1.24.9 fix

Changes:
1. Adds POKECA_NOW override to collector so historical integration tests are deterministic.
2. Pins the Furuichi revisit integration test to 2026-08-03.
3. Removes the private/nonexistent product-review-queue.json from sync-products git add.
4. Bumps package version to 1.24.9.

Apply from repository root:
  git apply pokeca-life-v1.24.9.patch
  npm test
  git add .
  git commit -m "fix: restore collector and product sync"
  git push

The production collector still uses the real current time unless POKECA_NOW is explicitly set.
