import {
  GIT_OPTIONS_WITH_VALUE,
  PACKAGE_MANAGER_OPTIONS_WITH_VALUE,
  PACKAGE_MANAGER_SCRIPT_COMMANDS,
  VERSION_QUERY_EXECUTABLES,
} from "./constants.js";
import {
  addCandidate,
  findPositionalToken,
  normalizeWhitespace,
  skipLeadingAssignments,
  tokenizeShellCommand,
} from "./utils.js";

function findGitSubcommand(tokens: string[]): string | null {
  const token = findPositionalToken(tokens, 1, GIT_OPTIONS_WITH_VALUE);
  return token?.token ?? null;
}

function addVersionCandidates(candidates: Set<string>, executable: string, tokens: string[]) {
  const flag = tokens[1];
  if (flag === "--version" || flag === "-V" || flag === "-v") {
    addCandidate(candidates, `${executable} --version`);
  }
}

function addPythonModuleCandidates(candidates: Set<string>, executable: string, tokens: string[]) {
  const flag = tokens[1];
  const moduleName = tokens[2];
  if (flag !== "-m" || !moduleName) {
    return;
  }

  addCandidate(candidates, `${executable} -m ${moduleName}`);

  if (moduleName === "pytest") {
    addCandidate(candidates, "pytest");
    if (tokens.includes("-q")) {
      addCandidate(candidates, "pytest -q");
    }
    return;
  }

  if (moduleName === "pip") {
    const subcommand = tokens[3];
    if (subcommand) {
      addCandidate(candidates, `pip ${subcommand}`);
    }
  }
}

function addPackageManagerCandidates(candidates: Set<string>, executable: string, tokens: string[]) {
  const optionsWithValue = PACKAGE_MANAGER_OPTIONS_WITH_VALUE.get(executable) ?? new Set<string>();
  const subcommandInfo = findPositionalToken(tokens, 1, optionsWithValue);
  if (!subcommandInfo) {
    return;
  }

  const { token: subcommand, index } = subcommandInfo;

  if (subcommand === "run") {
    const scriptInfo = findPositionalToken(tokens, index + 1, new Set<string>());
    const scriptName = scriptInfo?.token;
    if (!scriptName) {
      return;
    }

    addCandidate(candidates, `${executable} run ${scriptName}`);
    if (executable !== "npm" && PACKAGE_MANAGER_SCRIPT_COMMANDS.has(scriptName)) {
      addCandidate(candidates, `${executable} ${scriptName}`);
    }
    return;
  }

  if (PACKAGE_MANAGER_SCRIPT_COMMANDS.has(subcommand) || subcommand === "check") {
    addCandidate(candidates, `${executable} ${subcommand}`);
  }
}

function addValidationToolCandidates(candidates: Set<string>, executable: string, tokens: string[]) {
  if (executable === "pytest") {
    addCandidate(candidates, "pytest");
    if (tokens.includes("-q")) {
      addCandidate(candidates, "pytest -q");
    }
    return;
  }

  if (executable === "ruff") {
    const subcommand = tokens[1];
    if (subcommand === "check") {
      addCandidate(candidates, "ruff check");
    }
    return;
  }

  if (executable === "mypy") {
    addCandidate(candidates, "mypy");
    return;
  }

  if (executable === "tsc" && tokens.includes("--noEmit")) {
    addCandidate(candidates, "tsc --noEmit");
  }
}

export function buildCanonicalShellCandidates(fullCommandText: string): string[] {
  const normalizedCommand = normalizeWhitespace(fullCommandText);
  const candidates = new Set<string>();
  addCandidate(candidates, normalizedCommand);

  const rawTokens = tokenizeShellCommand(normalizedCommand);
  const tokens = skipLeadingAssignments(rawTokens);
  if (!tokens.length) {
    return [...candidates];
  }

  const executable = tokens[0];
  if (!executable) {
    return [...candidates];
  }

  addCandidate(candidates, executable);

  if (executable === "git") {
    const subcommand = findGitSubcommand(tokens);
    addCandidate(candidates, subcommand ? `git ${subcommand}` : null);
    return [...candidates];
  }

  if (VERSION_QUERY_EXECUTABLES.has(executable)) {
    addVersionCandidates(candidates, executable, tokens);
  }

  if (executable === "python" || executable === "python3") {
    addPythonModuleCandidates(candidates, executable, tokens);
    return [...candidates];
  }

  const subcommand = tokens[1];
  if ((executable === "pip" || executable === "pip3") && subcommand) {
    addCandidate(candidates, `${executable} ${subcommand}`);
    return [...candidates];
  }

  if (executable === "pnpm" || executable === "npm" || executable === "yarn" || executable === "bun") {
    addPackageManagerCandidates(candidates, executable, tokens);
    return [...candidates];
  }

  addValidationToolCandidates(candidates, executable, tokens);

  return [...candidates];
}

export function selectPersistedShellPattern(fullCommandText: string): string | null {
  const candidates = buildCanonicalShellCandidates(fullCommandText);
  const normalizedCommand = normalizeWhitespace(fullCommandText);

  for (const candidate of candidates.slice(1)) {
    if (candidate.includes(" ")) {
      return candidate;
    }
  }

  return normalizedCommand || candidates[0] || null;
}
