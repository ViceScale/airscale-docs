import { basename, dirname, join } from "node:path";

const JOURNAL_VERSION = 1;
const JOURNAL_SUFFIX = ".mcp-pair-transaction.json";

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
  return /^\d+\.\d+\.[a-f0-9]+$/u.test(token) ? token : null;
}

function transactionPathsFor(targetPath, token) {
  return {
    temporaryPath: `${targetPath}.${token}.tmp`,
    backupPath: `${targetPath}.${token}.bak`
  };
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
  if (!temporaryToken || temporaryToken !== backupToken) {
    throw new Error(`transaction journal token mismatch for ${targetPath}`);
  }
  return entry;
}

function readJournal(journalPath, targetPaths, io) {
  if (io.lstatSync(journalPath).isSymbolicLink()) throw new Error("transaction journal must not be a symbolic link");
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
  return {
    committed: journal.committed,
    entries: targetPaths.map((targetPath, index) => validateJournalEntry(journal.entries[index], targetPath))
  };
}

function finishJournal(entries, journalPath, io) {
  const updatePath = `${journalPath}.next`;
  if (io.existsSync(updatePath)) io.unlinkSync(updatePath);
  io.unlinkSync(journalPath);
  fsyncDirectories([journalPath, ...entries.map(({ targetPath }) => targetPath)], io);
}

export function assertNoIncompleteTransactionForCheck(catalogPath, io) {
  const journalPath = journalPathFor(catalogPath);
  if (io.existsSync(journalPath) || stagedJournalPaths(journalPath, io).length > 0) {
    throw new GeneratedPairTransactionError([], `Incomplete MCP output transaction requires --write recovery: ${journalPath}`);
  }
}

function cleanUnpublishedJournalStage(targetPaths, journalPath, io) {
  const stages = stagedJournalPaths(journalPath, io);
  if (stages.length === 0) return;
  if (io.existsSync(journalPath) || stages.length !== 1) {
    throw new GeneratedPairTransactionError(
      [],
      "MCP output transaction recovery was incomplete; ambiguous journal artifacts were preserved"
    );
  }
  const stagePath = stages[0];
  const token = stagedJournalToken(stagePath, journalPath);
  if (!token) {
    throw new GeneratedPairTransactionError(
      [],
      "MCP output transaction recovery was incomplete; unknown journal artifact was preserved"
    );
  }
  const entries = targetPaths.map((targetPath) => ({ targetPath, ...transactionPathsFor(targetPath, token) }));
  if (entries.some(({ backupPath }) => io.existsSync(backupPath))) {
    throw new GeneratedPairTransactionError(
      [],
      "MCP output transaction recovery was incomplete; unpublished journal had an unexpected backup"
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

export function recoverGeneratedPair(targetPaths, io) {
  const journalPath = journalPathFor(targetPaths[0]);
  cleanUnpublishedJournalStage(targetPaths, journalPath, io);
  if (!io.existsSync(journalPath)) return;

  let journal;
  try {
    journal = readJournal(journalPath, targetPaths, io);
  } catch (error) {
    throw new GeneratedPairTransactionError([error], `MCP output transaction recovery was incomplete: ${error.message}`);
  }
  const { committed, entries } = journal;

  // Two output paths cannot switch in one filesystem atomic operation. The
  // durable journal makes the observable intermediate states deterministic:
  // a later writer rolls back unless both temporary files were installed,
  // while --check always fails closed and never attempts recovery.
  const recoveryErrors = [];

  if (committed) {
    if (entries.some(({ targetPath }) => !io.existsSync(targetPath))) {
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

  try {
    for (const entry of entries) {
      io.writeFileSync(entry.temporaryPath, entry.contents, { encoding: "utf8", flag: "wx" });
      fsyncPath(entry.temporaryPath, io);
    }
    fsyncDirectories(entries.map(({ temporaryPath }) => temporaryPath), io);

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
    fsyncPath(initialJournalStagePath, io);
    io.renameSync(initialJournalStagePath, journalPath);
    journalPersisted = true;
    fsyncDirectories([journalPath], io);

    for (const entry of entries) {
      if (entry.hadTarget) io.renameSync(entry.targetPath, entry.backupPath);
    }
    fsyncDirectories(targetPaths, io);
    transactionPhaseHook?.("backup");

    io.renameSync(entries[0].temporaryPath, entries[0].targetPath);
    fsyncDirectories([entries[0].targetPath], io);
    transactionPhaseHook?.("first-install");

    io.renameSync(entries[1].temporaryPath, entries[1].targetPath);
    fsyncDirectories([entries[1].targetPath], io);
    const journalUpdatePath = `${journalPath}.next`;
    io.writeFileSync(
      journalUpdatePath,
      `${JSON.stringify({ ...journal, committed: true }, null, 2)}\n`,
      { encoding: "utf8", flag: "wx" }
    );
    fsyncPath(journalUpdatePath, io);
    io.renameSync(journalUpdatePath, journalPath);
    fsyncDirectories([journalPath], io);
    transactionPhaseHook?.("second-install");
  } catch (error) {
    if (!journalPersisted) {
      for (const entry of entries) quietly(() => io.unlinkSync(entry.temporaryPath));
      quietly(() => io.unlinkSync(initialJournalStagePath));
      throw error;
    }
    try {
      recoverGeneratedPair(targetPaths, io);
    } catch (recoveryError) {
      for (const entry of entries) quietly(() => io.unlinkSync(entry.temporaryPath));
      throw new GeneratedPairTransactionError(
        [error, recoveryError],
        `${error.message}; rollback was incomplete and recovery backups were preserved`
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
