import { basename, dirname, join, resolve } from "node:path";

const JOURNAL_VERSION = 1;
const JOURNAL_SUFFIX = ".mcp-pair-transaction.json";
const TRANSACTION_TOKEN_PATTERN = /^\d+\.\d+\.[a-f0-9]{1,64}$/u;

export class GeneratedPairTransactionError extends AggregateError {
  constructor(errors, message) {
    super(errors, message);
    this.name = "GeneratedPairTransactionError";
  }
}

export function journalPathFor(catalogPath) {
  return `${catalogPath}${JOURNAL_SUFFIX}`;
}

function stagedJournalPaths(journalPath, io) {
  const directory = dirname(journalPath);
  if (!io.existsSync(directory)) return [];
  const prefix = `${basename(journalPath)}.`;
  return io.readdirSync(directory)
    .filter((name) => name.startsWith(prefix) && name.endsWith(".stage"))
    .map((name) => join(directory, name));
}

function stagedJournalToken(stagePath, journalPath) {
  const prefix = `${journalPath}.`;
  const token = stagePath.slice(prefix.length, -".stage".length);
  return TRANSACTION_TOKEN_PATTERN.test(token) ? token : null;
}

function transactionPathsFor(targetPath, token) {
  if (!TRANSACTION_TOKEN_PATTERN.test(token)) {
    throw new Error("transaction token has an unsafe format");
  }
  return {
    temporaryPath: `${targetPath}.${token}.tmp`,
    backupPath: `${targetPath}.${token}.bak`
  };
}

function transactionArtifactCandidates(targetPath, suffix, io) {
  const directory = dirname(targetPath);
  if (!io.existsSync(directory)) return [];
  const prefix = `${basename(targetPath)}.`;
  return io.readdirSync(directory).flatMap((name) => {
    if (!name.startsWith(prefix) || !name.endsWith(suffix)) return [];
    const token = name.slice(prefix.length, -suffix.length);
    if (!TRANSACTION_TOKEN_PATTERN.test(token)) return [];
    return [{ token, path: join(directory, name) }];
  });
}

function uniqueDirectories(paths) {
  return [...new Set(paths.map(dirname))];
}

function fsyncPath(path, io) {
  const descriptor = io.openSync(path, "r+");
  try {
    io.fsyncSync(descriptor);
  } finally {
    io.closeSync(descriptor);
  }
}

function fsyncDirectories(paths, io) {
  for (const directory of uniqueDirectories(paths)) {
    const descriptor = io.openSync(directory, "r");
    try {
      io.fsyncSync(descriptor);
    } finally {
      io.closeSync(descriptor);
    }
  }
}

function quietly(callback) {
  try {
    callback();
  } catch {}
}

function lstatIfPresent(path, io) {
  try {
    return io.lstatSync(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function assertRegularArtifact(path, label, io, { required = false } = {}) {
  const stat = lstatIfPresent(path, io);
  if (!stat) {
    if (required) throw new Error(`${label} is missing: ${path}`);
    return null;
  }
  if (stat.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link: ${path}`);
  if (!stat.isFile()) throw new Error(`${label} must be a regular file: ${path}`);
  return stat;
}

function unlinkCreatedArtifact(path, identity, label, io) {
  const current = lstatIfPresent(path, io);
  if (!current) return;
  if (
    current.isSymbolicLink()
    || !current.isFile()
    || current.dev !== identity.dev
    || current.ino !== identity.ino
  ) {
    throw new Error(`${label} ownership changed before cleanup: ${path}`);
  }
  io.unlinkSync(path);
}

function assertExistingEntryArtifactsAreRegular(entries, io) {
  for (const entry of entries) {
    assertRegularArtifact(entry.targetPath, "transaction output", io);
    assertRegularArtifact(entry.temporaryPath, "transaction temporary file", io);
    assertRegularArtifact(entry.backupPath, "transaction backup", io);
  }
}

function validateJournalEntry(entry, targetPath) {
  if (!entry || typeof entry !== "object" || entry.targetPath !== targetPath || typeof entry.hadTarget !== "boolean") {
    throw new Error(`transaction journal entry does not match ${targetPath}`);
  }
  const temporaryPrefix = `${targetPath}.`;
  if (
    typeof entry.temporaryPath !== "string"
    || !entry.temporaryPath.startsWith(temporaryPrefix)
    || !entry.temporaryPath.endsWith(".tmp")
    || typeof entry.backupPath !== "string"
    || !entry.backupPath.startsWith(temporaryPrefix)
    || !entry.backupPath.endsWith(".bak")
  ) {
    throw new Error(`transaction journal paths are unsafe for ${targetPath}`);
  }
  const temporaryToken = entry.temporaryPath.slice(temporaryPrefix.length, -".tmp".length);
  const backupToken = entry.backupPath.slice(temporaryPrefix.length, -".bak".length);
  if (!TRANSACTION_TOKEN_PATTERN.test(temporaryToken) || temporaryToken !== backupToken) {
    throw new Error(`transaction journal token is unsafe or mismatched for ${targetPath}`);
  }
  const expectedPaths = transactionPathsFor(targetPath, temporaryToken);
  const outputDirectory = resolve(dirname(targetPath));
  for (const [key, expectedPath] of Object.entries(expectedPaths)) {
    const artifactPath = entry[key];
    if (
      artifactPath !== expectedPath
      || resolve(artifactPath) !== resolve(expectedPath)
      || resolve(dirname(artifactPath)) !== outputDirectory
    ) {
      throw new Error(`transaction journal path is unsafe for ${targetPath}`);
    }
  }
  return { ...entry, transactionToken: temporaryToken };
}

function readJournal(journalPath, targetPaths, io) {
  assertRegularArtifact(journalPath, "transaction journal", io, { required: true });
  let journal;
  try {
    journal = JSON.parse(io.readFileSync(journalPath, "utf8"));
  } catch (error) {
    throw new Error(`transaction journal is not valid JSON: ${error.message}`, { cause: error });
  }
  if (
    journal?.version !== JOURNAL_VERSION
    || typeof journal.committed !== "boolean"
    || !Array.isArray(journal.entries)
    || journal.entries.length !== 2
  ) {
    throw new Error("transaction journal has an unsupported shape");
  }
  const entries = targetPaths.map((targetPath, index) => validateJournalEntry(journal.entries[index], targetPath));
  if (new Set(entries.map(({ transactionToken }) => transactionToken)).size !== 1) {
    throw new Error("transaction journal entries have mismatched transaction tokens");
  }
  return {
    committed: journal.committed,
    entries
  };
}

function finishJournal(entries, journalPath, io) {
  const updatePath = `${journalPath}.next`;
  if (assertRegularArtifact(updatePath, "transaction journal update", io)) io.unlinkSync(updatePath);
  io.unlinkSync(journalPath);
  fsyncDirectories([journalPath, ...entries.map(({ targetPath }) => targetPath)], io);
}

export function assertNoIncompleteTransactionForCheck(targetPaths, io) {
  const [catalogPath] = targetPaths;
  const journalPath = journalPathFor(catalogPath);
  const journalUpdatePath = `${journalPath}.next`;
  const hasUnpublishedArtifacts = [".tmp", ".bak"].some((suffix) => (
    targetPaths.some((targetPath) => transactionArtifactCandidates(targetPath, suffix, io).length > 0)
  ));
  if (lstatIfPresent(journalUpdatePath, io)) {
    assertRegularArtifact(journalUpdatePath, "transaction journal update", io, { required: true });
    throw new GeneratedPairTransactionError(
      [],
      `Incomplete MCP output transaction requires --write recovery: ${journalUpdatePath}`
    );
  }
  if (lstatIfPresent(journalPath, io) || stagedJournalPaths(journalPath, io).length > 0 || hasUnpublishedArtifacts) {
    throw new GeneratedPairTransactionError([], `Incomplete MCP output transaction requires --write recovery: ${journalPath}`);
  }
}

function cleanUnpublishedJournalStage(targetPaths, journalPath, io) {
  const stages = stagedJournalPaths(journalPath, io);
  if (stages.length === 0) return;
  if (lstatIfPresent(journalPath, io) || stages.length !== 1) {
    throw new GeneratedPairTransactionError(
      [],
      "MCP output transaction recovery was incomplete; ambiguous journal artifacts were preserved"
    );
  }
  const stagePath = stages[0];
  try {
    assertRegularArtifact(stagePath, "staged transaction journal", io, { required: true });
  } catch (error) {
    throw new GeneratedPairTransactionError(
      [error],
      `MCP output transaction recovery was incomplete; staged journal was preserved: ${error.message}`
    );
  }
  const token = stagedJournalToken(stagePath, journalPath);
  if (!token) {
    throw new GeneratedPairTransactionError(
      [],
      "MCP output transaction recovery was incomplete; unknown journal artifact was preserved"
    );
  }
  const temporaryCandidates = targetPaths.map((targetPath) => transactionArtifactCandidates(targetPath, ".tmp", io));
  const hasExactCompletePair = temporaryCandidates.every((candidates) => (
    candidates.length === 1 && candidates[0].token === token
  ));
  if (!hasExactCompletePair) {
    throw new GeneratedPairTransactionError(
      [],
      "MCP output transaction recovery was incomplete; staged journal had incomplete or mismatched temporary evidence"
    );
  }
  const entries = targetPaths.map((targetPath) => ({ targetPath, ...transactionPathsFor(targetPath, token) }));
  const backupCandidates = targetPaths.flatMap((targetPath) => transactionArtifactCandidates(targetPath, ".bak", io));
  if (backupCandidates.length > 0) {
    throw new GeneratedPairTransactionError(
      [],
      "MCP output transaction recovery was incomplete; unpublished journal had an unexpected backup"
    );
  }
  try {
    for (const { temporaryPath } of entries) {
      assertRegularArtifact(temporaryPath, "staged transaction temporary file", io);
    }
  } catch (error) {
    throw new GeneratedPairTransactionError(
      [error],
      `MCP output transaction recovery was incomplete; staged journal was preserved: ${error.message}`
    );
  }
  const cleanupErrors = [];
  for (const { temporaryPath } of entries) {
    if (!io.existsSync(temporaryPath)) continue;
    try {
      io.unlinkSync(temporaryPath);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (cleanupErrors.length === 0) {
    try {
      io.unlinkSync(stagePath);
      fsyncDirectories([stagePath, ...targetPaths], io);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (cleanupErrors.length > 0) {
    throw new GeneratedPairTransactionError(
      cleanupErrors,
      `MCP output transaction recovery was incomplete; staged journal was preserved: ${cleanupErrors[0].message}`
    );
  }
}

function cleanUnpublishedTemporaryPair(targetPaths, io) {
  const temporaryCandidates = targetPaths.map((targetPath) => transactionArtifactCandidates(targetPath, ".tmp", io));
  const backupCandidates = targetPaths.flatMap((targetPath) => transactionArtifactCandidates(targetPath, ".bak", io));
  if (temporaryCandidates.every((candidates) => candidates.length === 0) && backupCandidates.length === 0) return;
  if (backupCandidates.length > 0) {
    throw new GeneratedPairTransactionError(
      [],
      "MCP output transaction recovery was incomplete; pre-journal backups were preserved"
    );
  }
  // Without a journal, ownership is established only by a complete pair whose
  // exact target-derived names carry the same strict token. A sole or
  // mismatched temporary file may belong to another process, so preserve it.
  const completePair = temporaryCandidates.every((candidates) => candidates.length === 1)
    && new Set(temporaryCandidates.map(([candidate]) => candidate.token)).size === 1;
  if (!completePair) {
    throw new GeneratedPairTransactionError(
      [],
      "MCP output transaction recovery was incomplete; ambiguous pre-journal temporary artifacts were preserved"
    );
  }
  const candidates = temporaryCandidates.map(([candidate]) => candidate);
  try {
    for (const candidate of candidates) {
      assertRegularArtifact(candidate.path, "pre-journal transaction temporary file", io, { required: true });
    }
    for (const candidate of candidates) io.unlinkSync(candidate.path);
    fsyncDirectories(candidates.map(({ path }) => path), io);
  } catch (error) {
    throw new GeneratedPairTransactionError(
      [error],
      `MCP output transaction recovery was incomplete; pre-journal temporary cleanup failed: ${error.message}`
    );
  }
}

export function recoverGeneratedPair(targetPaths, io) {
  const journalPath = journalPathFor(targetPaths[0]);
  const journalUpdatePath = `${journalPath}.next`;
  if (lstatIfPresent(journalUpdatePath, io) && !lstatIfPresent(journalPath, io)) {
    try {
      assertRegularArtifact(journalUpdatePath, "transaction journal update", io, { required: true });
    } catch (error) {
      throw new GeneratedPairTransactionError(
        [error],
        `MCP output transaction recovery was incomplete; orphan journal update was preserved: ${error.message}`
      );
    }
    throw new GeneratedPairTransactionError(
      [],
      "MCP output transaction recovery was incomplete; orphan journal update was preserved"
    );
  }
  cleanUnpublishedJournalStage(targetPaths, journalPath, io);
  if (!lstatIfPresent(journalPath, io)) {
    cleanUnpublishedTemporaryPair(targetPaths, io);
    return;
  }

  let journal;
  try {
    journal = readJournal(journalPath, targetPaths, io);
  } catch (error) {
    throw new GeneratedPairTransactionError([error], `MCP output transaction recovery was incomplete: ${error.message}`);
  }
  const { committed, entries } = journal;
  try {
    assertExistingEntryArtifactsAreRegular(entries, io);
    assertRegularArtifact(`${journalPath}.next`, "transaction journal update", io);
  } catch (error) {
    throw new GeneratedPairTransactionError([error], `MCP output transaction recovery was incomplete: ${error.message}`);
  }

  // Two output paths cannot switch in one filesystem atomic operation. The
  // durable journal makes the observable intermediate states deterministic:
  // a later writer rolls back unless both temporary files were installed,
  // while --check always fails closed and never attempts recovery.
  const recoveryErrors = [];

  if (committed) {
    if (entries.some(({ targetPath }) => !lstatIfPresent(targetPath, io))) {
      throw new GeneratedPairTransactionError(
        [],
        "MCP output transaction recovery was incomplete; a committed output is missing and backups were preserved"
      );
    }
    for (const entry of entries) {
      if (!io.existsSync(entry.backupPath)) continue;
      try {
        io.unlinkSync(entry.backupPath);
      } catch (error) {
        recoveryErrors.push(error);
      }
    }
  } else {
    for (const entry of entries) {
      try {
        if (io.existsSync(entry.backupPath)) {
          io.renameSync(entry.backupPath, entry.targetPath);
        } else if (!entry.hadTarget && io.existsSync(entry.targetPath) && !io.existsSync(entry.temporaryPath)) {
          io.unlinkSync(entry.targetPath);
        }
      } catch (error) {
        recoveryErrors.push(error);
      }
    }
  }

  if (recoveryErrors.length > 0) {
    throw new GeneratedPairTransactionError(
      recoveryErrors,
      `MCP output transaction recovery was incomplete; recovery backups and journal were preserved: ${recoveryErrors[0].message}`
    );
  }

  try {
    for (const entry of entries) {
      assertRegularArtifact(entry.targetPath, "recovered transaction output", io, { required: entry.hadTarget || committed });
    }
  } catch (error) {
    throw new GeneratedPairTransactionError(
      [error],
      `MCP output transaction recovery was incomplete; recovery artifacts and journal were preserved: ${error.message}`
    );
  }

  for (const entry of entries) {
    if (io.existsSync(entry.temporaryPath)) io.unlinkSync(entry.temporaryPath);
    if (io.existsSync(entry.backupPath)) io.unlinkSync(entry.backupPath);
  }
  fsyncDirectories(entries.map(({ targetPath }) => targetPath), io);
  finishJournal(entries, journalPath, io);
}

export function writeGeneratedPair(outputs, { io, transactionToken, transactionPhaseHook }) {
  const entries = outputs.map(({ targetPath, contents }) => ({
    targetPath,
    contents,
    ...transactionPathsFor(targetPath, transactionToken),
    hadTarget: io.existsSync(targetPath)
  }));
  const targetPaths = entries.map(({ targetPath }) => targetPath);
  const journalPath = journalPathFor(targetPaths[0]);
  const initialJournalStagePath = `${journalPath}.${transactionToken}.stage`;
  let journalPersisted = false;
  const createdTemporaryArtifacts = new Map();
  let createdInitialJournalStage = null;

  try {
    assertExistingEntryArtifactsAreRegular(entries, io);
    for (const entry of entries) {
      io.writeFileSync(entry.temporaryPath, entry.contents, { encoding: "utf8", flag: "wx" });
      const identity = assertRegularArtifact(entry.temporaryPath, "transaction temporary file", io, { required: true });
      createdTemporaryArtifacts.set(entry.temporaryPath, identity);
      fsyncPath(entry.temporaryPath, io);
    }
    fsyncDirectories(entries.map(({ temporaryPath }) => temporaryPath), io);
    transactionPhaseHook?.("temporary-files");

    const journal = {
      version: JOURNAL_VERSION,
      committed: false,
      entries: entries.map(({ targetPath, temporaryPath, backupPath, hadTarget }) => ({
        targetPath,
        temporaryPath,
        backupPath,
        hadTarget
      }))
    };
    io.writeFileSync(initialJournalStagePath, `${JSON.stringify(journal, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx"
    });
    createdInitialJournalStage = assertRegularArtifact(
      initialJournalStagePath,
      "staged transaction journal",
      io,
      { required: true }
    );
    fsyncPath(initialJournalStagePath, io);
    io.renameSync(initialJournalStagePath, journalPath);
    createdInitialJournalStage = null;
    journalPersisted = true;
    assertRegularArtifact(journalPath, "transaction journal", io, { required: true });
    fsyncDirectories([journalPath], io);

    for (const entry of entries) {
      if (entry.hadTarget) {
        io.renameSync(entry.targetPath, entry.backupPath);
        assertRegularArtifact(entry.backupPath, "transaction backup", io, { required: true });
      }
    }
    fsyncDirectories(targetPaths, io);
    transactionPhaseHook?.("backup");

    io.renameSync(entries[0].temporaryPath, entries[0].targetPath);
    assertRegularArtifact(entries[0].targetPath, "installed transaction output", io, { required: true });
    fsyncDirectories([entries[0].targetPath], io);
    transactionPhaseHook?.("first-install");

    io.renameSync(entries[1].temporaryPath, entries[1].targetPath);
    assertRegularArtifact(entries[1].targetPath, "installed transaction output", io, { required: true });
    fsyncDirectories([entries[1].targetPath], io);
    const journalUpdatePath = `${journalPath}.next`;
    io.writeFileSync(
      journalUpdatePath,
      `${JSON.stringify({ ...journal, committed: true }, null, 2)}\n`,
      { encoding: "utf8", flag: "wx" }
    );
    assertRegularArtifact(journalUpdatePath, "transaction journal update", io, { required: true });
    fsyncPath(journalUpdatePath, io);
    io.renameSync(journalUpdatePath, journalPath);
    assertRegularArtifact(journalPath, "transaction journal", io, { required: true });
    fsyncDirectories([journalPath], io);
    transactionPhaseHook?.("second-install");
  } catch (error) {
    if (!journalPersisted) {
      const cleanupErrors = [];
      for (const [temporaryPath, identity] of createdTemporaryArtifacts) {
        try {
          unlinkCreatedArtifact(temporaryPath, identity, "transaction temporary file", io);
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError);
        }
      }
      if (createdInitialJournalStage) {
        try {
          unlinkCreatedArtifact(
            initialJournalStagePath,
            createdInitialJournalStage,
            "staged transaction journal",
            io
          );
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError);
        }
      }
      if (cleanupErrors.length > 0) {
        throw new GeneratedPairTransactionError(
          [error, ...cleanupErrors],
          `${error.message}; ownership-safe pre-journal cleanup was incomplete: ${cleanupErrors[0].message}`
        );
      }
      throw error;
    }
    try {
      recoverGeneratedPair(targetPaths, io);
    } catch (recoveryError) {
      const cleanupErrors = [];
      for (const [temporaryPath, identity] of createdTemporaryArtifacts) {
        try {
          unlinkCreatedArtifact(temporaryPath, identity, "transaction temporary file", io);
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError);
        }
      }
      throw new GeneratedPairTransactionError(
        [error, recoveryError, ...cleanupErrors],
        cleanupErrors.length > 0
          ? `${error.message}; rollback was incomplete, recovery backups were preserved, and ownership-safe temporary cleanup was incomplete: ${cleanupErrors[0].message}`
          : `${error.message}; rollback was incomplete and recovery backups were preserved`
      );
    }
    throw error;
  }

  // Both outputs are installed at this commit point. Never roll back after
  // removing an original; the journal lets the next writer finish cleanup.
  const cleanupErrors = [];
  for (const entry of entries) {
    if (!entry.hadTarget || !io.existsSync(entry.backupPath)) continue;
    try {
      io.unlinkSync(entry.backupPath);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  try {
    fsyncDirectories(targetPaths, io);
    transactionPhaseHook?.("cleanup");
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (cleanupErrors.length > 0) {
    throw new GeneratedPairTransactionError(
      cleanupErrors,
      `backup cleanup failed after MCP outputs were committed; journal was preserved: ${cleanupErrors[0].message}`
    );
  }
  finishJournal(entries, journalPath, io);
}
