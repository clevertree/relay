# Enabling pre-commit hooks

This repository includes a workspace pre-commit hook at `.githooks/pre-commit` which runs the workspace test runner (`pnpm -w test`) before commits.

To enable the hooks for your local clone, run:

```sh
# from the repository root
git config core.hooksPath .githooks
```

Now commits will run the `pre-commit` script. If you want to disable the hook temporarily, you can run `git commit --no-verify`.

Tip: CI environments should run `pnpm -w test` in their pipeline as well.
