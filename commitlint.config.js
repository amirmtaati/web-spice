/**
 * Conventional Commits (SPEC §12.6): feat, fix, perf, refactor, test, docs,
 * build, ci, chore; `!` and BREAKING CHANGE: footer for breaks.
 * @type {import('@commitlint/types').UserConfig}
 */
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "subject-max-length": [2, "always", 100],
  },
};
