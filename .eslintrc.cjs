/*
  ESLint config, plus a guard for one specific way `npm run lint` used to die.

  WHAT WENT WRONG. `import/no-unresolved` is an error here, and the `typescript`
  entry in `import/resolver` (added by the expo config, on top of its own `node`
  entry) is served by `eslint-import-resolver-typescript`, which since v3.7 is a
  thin wrapper around `unrs-resolver` -- a NATIVE binding, shipped as one
  optional dependency per platform.

  npm installs only the optional dependency matching the machine doing the
  install (npm/cli#4828). So the moment `node_modules` is installed on one
  platform and eslint is run on another -- which is exactly what happens when
  this Windows checkout is linted from a Linux container or WSL -- the require
  throws "Cannot find native binding", eslint-plugin-import turns that into a
  `Resolve error` WITH A FULL STACK TRACE ON EVERY FILE, and a 138-file lint
  becomes several thousand lines of identical stack. That is the "crash": not a
  bug in any rule, and nothing to do with the code being linted.

  WHAT THIS DOES. Load the resolver once, up front. If it loads, nothing here
  changes anything -- this is the config the repo has always had. If it does
  not, drop the resolver that cannot work and switch `import/no-unresolved` off
  for the run, so the other ~40 rules still report instead of being buried. One
  line on stderr says why, because a silently downgraded lint is worse than a
  loud broken one.

  THE REAL FIX, when you hit the warning: install the binding for the platform
  you are linting ON, e.g.
    npm i --no-save @unrs/resolver-binding-linux-x64-gnu@$(node -p "require('unrs-resolver/package.json').version")
  or reinstall node_modules on that platform. The version must match
  `unrs-resolver` exactly.
*/
const RESOLVER = 'eslint-import-resolver-typescript';

/** @returns {string | null} the failure message, or null when the resolver is usable. */
function resolverFailure() {
  try {
    require(RESOLVER);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message.split('\n')[0] : String(error);
  }
}

const failure = resolverFailure();

if (failure) {
  // eslint-disable-next-line no-console
  console.warn(
    `\n[eslint] ${RESOLVER} could not be loaded on ${process.platform}-${process.arch}:\n` +
      `         ${failure}\n` +
      `         import/no-unresolved is DISABLED for this run; every other rule still applies.\n` +
      `         Fix: install the unrs-resolver native binding for this platform. See .eslintrc.cjs.\n`,
  );
}

module.exports = {
  root: true,
  extends: ['expo', 'prettier'],
  ignorePatterns: [
    'supabase/functions/**',
    // Generated or vendored, and none of it is ours to lint.
    'android/**',
    '.expo/**',
    '_bmad/**',
    '_bmad-output/**',
    '_to_delete/**',
  ],
  ...(failure
    ? {
        settings: { 'import/resolver': { node: true } },
        rules: { 'import/no-unresolved': 'off' },
      }
    : {}),
};
