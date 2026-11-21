## Summary

Describe the change clearly and briefly.

## What changed

-

## How to test

- [ ] Web site: `npm --prefix webui run build:web` and `npm --prefix webui run test:e2e:web`
- [ ] Lint, types and tests: `python scripts/build_release.py check --skip-npm-install` (`--skip-python` only for a change confined to `webui/` or `functions/` whose file names no Python test in `tests/` mentions)
- [ ] Additional manual verification performed if needed

## Checklist

- [ ] The change is focused and scoped
- [ ] I updated tests if behavior changed
- [ ] I did not weaken or remove existing tests
- [ ] I updated docs if needed
