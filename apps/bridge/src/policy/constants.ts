export const POLICY_CANDIDATES = [
  ".github/joudo-policy.yml",
  ".github/joudo-policy.yaml",
  ".github/policy.yml",
  ".github/policy.yaml",
];

export const SAFE_READ_ONLY_COMMANDS = new Set([
  "cat",
  "find",
  "git",
  "head",
  "ls",
  "pwd",
  "rg",
  "sed",
  "tail",
  "which",
]);

export const HIGH_RISK_INTERPRETERS = new Set(["bash", "node", "python", "python3", "ruby", "sh", "zsh"]);

export const DANGEROUS_COMMAND_PATTERNS = [
  "git push",
  "git reset --hard",
  "gh pr merge",
  "rm",
  "sudo",
  "ssh",
  "scp",
  "rsync",
  "osascript",
];

export const GIT_OPTIONS_WITH_VALUE = new Set([
  "-c",
  "-C",
  "--config-env",
  "--exec-path",
  "--git-dir",
  "--namespace",
  "--super-prefix",
  "--work-tree",
]);

export const PACKAGE_MANAGER_OPTIONS_WITH_VALUE = new Map<string, Set<string>>([
  ["pnpm", new Set(["--dir", "--filter", "-C", "-F"])],
  ["npm", new Set(["--prefix", "--workspace", "-w", "-C"])],
  ["yarn", new Set(["--cwd"])],
  ["bun", new Set(["--cwd"])],
]);

export const VERSION_QUERY_EXECUTABLES = new Set(["node", "npm", "pnpm", "pip", "pip3", "python", "python3", "yarn"]);

export const PACKAGE_MANAGER_SCRIPT_COMMANDS = new Set(["lint", "test", "typecheck"]);
