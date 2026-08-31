import { execFileSync } from "node:child_process";
import { basename, dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

const JOURNAL_VERSION = 1;
const JOURNAL_SUFFIX = ".mcp-pair-transaction.json";
const WRITER_LOCK_VERSION = 2;
const WRITER_LOCK_SUFFIX = ".mcp-pair-write.lock";
const TRANSACTION_TOKEN_PATTERN = /^\d+\.\d+\.[a-f0-9]{1,64}$/u;

export class GeneratedPairTransactionError extends AggregateError {
  constructor(errors, message, { recoveryMutationsAttempted = false } = {}) {
    super(errors, message);
    this.name = "GeneratedPairTransactionError";
    this.recoveryMutationsAttempted = recoveryMutationsAttempted;
  }
}

export class GeneratedPairWriterLockError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "GeneratedPairWriterLockError";
  }
}

export function journalPathFor(catalogPath) {
  return `${catalogPath}${JOURNAL_SUFFIX}`;
}

export function writerLockPathFor(catalogPath) {
  return `${catalogPath}${WRITER_LOCK_SUFFIX}`;
}

export function isGeneratedPairReservedPath(candidatePath, targetPath) {
  const journalPath = journalPathFor(targetPath);
  const lockPath = writerLockPathFor(targetPath);
  if (
    candidatePath === journalPath
    || candidatePath === `${journalPath}.next`
    || candidatePath === lockPath
  ) return true;
  for (const [prefix, suffixes] of [
    [`${journalPath}.`, [".stage"]],
    [`${lockPath}.`, [".candidate", ".stale"]],
    [`${targetPath}.`, [".tmp", ".bak"]]
  ]) {
    if (!candidatePath.startsWith(prefix)) continue;
    for (const suffix of suffixes) {
      if (!candidatePath.endsWith(suffix)) continue;
      const token = candidatePath.slice(prefix.length, -suffix.length);
      if (TRANSACTION_TOKEN_PATTERN.test(token)) return true;
    }
  }
  return false;
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

function serializedArtifactIdentity(stat) {
  return { device: String(stat.dev), inode: String(stat.ino) };
}

function validateSerializedArtifactIdentity(identity, label) {
  if (
    !identity
    || typeof identity !== "object"
    || Array.isArray(identity)
    || Object.keys(identity).sort().join(",") !== "device,inode"
    || !/^\d+$/u.test(identity.device)
    || !/^\d+$/u.test(identity.inode)
  ) {
    throw new Error(`${label} has an invalid file identity`);
  }
  return { device: identity.device, inode: identity.inode };
}

function artifactMatchesIdentity(stat, identity) {
  return String(stat.dev) === identity.device && String(stat.ino) === identity.inode;
}

function assertArtifactMatchesIdentity(path, identity, label, io) {
  const stat = assertRegularArtifact(path, label, io, { required: true });
  if (!artifactMatchesIdentity(stat, identity)) {
    throw new Error(`${label} identity does not match the output installed by this transaction: ${path}`);
  }
  return stat;
}

function writerLockArtifactPath(lockPath, token, suffix) {
  if (!TRANSACTION_TOKEN_PATTERN.test(token)) throw new Error("writer lock token has an unsafe format");
  const artifactPath = `${lockPath}.${token}.${suffix}`;
  if (resolve(dirname(artifactPath)) !== resolve(dirname(lockPath))) {
    throw new Error("writer lock artifact escaped the output directory");
  }
  return artifactPath;
}

function writerLockArtifacts(lockPath, io) {
  const directory = dirname(lockPath);
  if (!io.existsSync(directory)) return [];
  const prefix = `${basename(lockPath)}.`;
  return io.readdirSync(directory).flatMap((name) => {
    if (!name.startsWith(prefix)) return [];
    for (const suffix of ["candidate", "stale"]) {
      const suffixText = `.${suffix}`;
      if (!name.endsWith(suffixText)) continue;
      const token = name.slice(prefix.length, -suffixText.length);
      return [{ path: join(directory, name), suffix, token }];
    }
    return [{ path: join(directory, name), suffix: null, token: null }];
  });
}

function lockRecordFor(targetPaths, transactionToken, processIncarnation) {
  return {
    version: WRITER_LOCK_VERSION,
    token: transactionToken,
    pid: process.pid,
    processIncarnation,
    targetPaths
  };
}

function targetPathsMatch(left, right) {
  return left.length === right.length && left.every((targetPath, index) => targetPath === right[index]);
}

function validateWriterLockRecord(
  record,
  targetPaths,
  { lockTargetPath = targetPaths[0], requireExactTargets = true } = {}
) {
  if (
    !record
    || typeof record !== "object"
    || Array.isArray(record)
    || Object.keys(record).sort().join(",") !== "pid,processIncarnation,targetPaths,token,version"
    || record.version !== WRITER_LOCK_VERSION
    || !TRANSACTION_TOKEN_PATTERN.test(record.token)
    || !Number.isSafeInteger(record.pid)
    || record.pid <= 0
    || typeof record.processIncarnation !== "string"
    || !/^[\x20-\x7e]{1,128}$/u.test(record.processIncarnation)
    || !Array.isArray(record.targetPaths)
    || record.targetPaths.length !== targetPaths.length
    || record.targetPaths.some((targetPath) => typeof targetPath !== "string")
    || !record.targetPaths.includes(lockTargetPath)
    || (requireExactTargets && !targetPathsMatch(record.targetPaths, targetPaths))
  ) {
    throw new GeneratedPairWriterLockError("MCP writer lock metadata is invalid or does not match the output targets");
  }
  return record;
}

function readWriterLock(path, targetPaths, label, io, options) {
  const initialIdentity = assertRegularArtifact(path, label, io, { required: true });
  let record;
  try {
    record = JSON.parse(io.readFileSync(path, "utf8"));
  } catch (error) {
    throw new GeneratedPairWriterLockError(`${label} metadata is not valid JSON: ${error.message}`, { cause: error });
  }
  const finalIdentity = assertRegularArtifact(path, label, io, { required: true });
  if (!artifactMatchesIdentity(finalIdentity, serializedArtifactIdentity(initialIdentity))) {
    throw new GeneratedPairWriterLockError(`${label} identity changed while it was being read`);
  }
  return { identity: finalIdentity, record: validateWriterLockRecord(record, targetPaths, options) };
}

function processLiveness(pid) {
  try {
    process.kill(pid, 0);
    return "alive-or-reused";
  } catch (error) {
    if (error?.code === "ESRCH") return "dead";
    return "unknown";
  }
}

function defaultProcessIncarnationForPid(pid) {
  if (process.platform === "win32") return null;
  try {
    const value = execFileSync(
      "/bin/ps",
      ["-o", "lstart=", "-p", String(pid)],
      { encoding: "utf8", timeout: 1_000, stdio: ["ignore", "pipe", "ignore"] }
    ).trim().replace(/\s+/gu, " ");
    return /^[\x20-\x7e]{1,128}$/u.test(value) ? value : null;
  } catch {
    return null;
  }
}

function resolveProcessIncarnation(pid, processIncarnationForPid) {
  try {
    const value = processIncarnationForPid(pid);
    return typeof value === "string" && /^[\x20-\x7e]{1,128}$/u.test(value) ? value : null;
  } catch {
    return null;
  }
}

function assertLockOwnerIsReclaimable(record, processIncarnationForPid) {
  const liveness = processLiveness(record.pid);
  if (liveness === "dead") return;
  if (liveness === "unknown") {
    throw new GeneratedPairWriterLockError("MCP output writer ownership is unknown; PID liveness could not be established");
  }
  const currentIncarnation = resolveProcessIncarnation(record.pid, processIncarnationForPid);
  if (!currentIncarnation) {
    throw new GeneratedPairWriterLockError("MCP output writer ownership is unknown; process incarnation could not be established");
  }
  if (currentIncarnation === record.processIncarnation) {
    throw new GeneratedPairWriterLockError("MCP output writer is active; the live owner incarnation matches the lock");
  }
}

function cleanupOwnedLockArtifact(path, identity, label, io) {
  try {
    unlinkCreatedArtifact(path, identity, label, io);
    fsyncDirectories([path], io);
  } catch (error) {
    throw new GeneratedPairWriterLockError(`${label} cleanup was incomplete: ${error.message}`, { cause: error });
  }
}

function inspectPreexistingLockArtifacts(
  lockPath,
  lockTargetPath,
  targetPaths,
  io,
  { suffixes = new Set(["candidate", "stale"]), processIncarnationForPid = defaultProcessIncarnationForPid } = {}
) {
  const artifacts = writerLockArtifacts(lockPath, io);
  const recoveryArtifacts = [];
  for (const artifact of artifacts) {
    if (!artifact.suffix || !TRANSACTION_TOKEN_PATTERN.test(artifact.token)) {
      throw new GeneratedPairWriterLockError(
        `MCP writer lock recovery found an unsafe target-derived artifact: ${artifact.path}`
      );
    }
    if (!suffixes.has(artifact.suffix)) continue;
    const { identity, record } = readWriterLock(
      artifact.path,
      targetPaths,
      `writer lock ${artifact.suffix}`,
      io,
      { lockTargetPath, requireExactTargets: false }
    );
    if (record.token !== artifact.token) {
      throw new GeneratedPairWriterLockError(`MCP writer lock artifact token does not match its metadata: ${artifact.path}`);
    }
    assertLockOwnerIsReclaimable(record, processIncarnationForPid);
    recoveryArtifacts.push({ ...artifact, identity, record });
  }
  return recoveryArtifacts;
}

export function assertNoWriterLockForCheck(targetPaths, io) {
  for (const targetPath of targetPaths) {
    const lockPath = writerLockPathFor(targetPath);
    const lockStat = lstatIfPresent(lockPath, io);
    if (lockStat) {
      assertRegularArtifact(lockPath, "MCP writer lock", io, { required: true });
      throw new GeneratedPairWriterLockError(`MCP output writer lock requires --write recovery: ${lockPath}`);
    }
    const artifacts = writerLockArtifacts(lockPath, io);
    if (artifacts.length > 0) {
      for (const artifact of artifacts) {
        assertRegularArtifact(artifact.path, "MCP writer lock artifact", io, { required: true });
      }
      throw new GeneratedPairWriterLockError(`MCP output writer lock requires --write recovery: ${lockPath}`);
    }
  }
}

function acquireSingleGeneratedPairWriterLock(
  targetPaths,
  lockTargetPath,
  transactionToken,
  io,
  { writerLockPhaseHook, processIncarnation, processIncarnationForPid = defaultProcessIncarnationForPid } = {}
) {
  const lockPath = writerLockPathFor(lockTargetPath);
  const candidatePath = writerLockArtifactPath(lockPath, transactionToken, "candidate");
  if (!processIncarnation) {
    throw new GeneratedPairWriterLockError("MCP output writer cannot establish the current process incarnation");
  }
  const record = lockRecordFor(targetPaths, transactionToken, processIncarnation);
  let candidateIdentity = null;
  let acquiredIdentity = null;
  const recoveryArtifacts = [];
  try {
    const preexistingArtifacts = inspectPreexistingLockArtifacts(
      lockPath,
      lockTargetPath,
      targetPaths,
      io,
      { processIncarnationForPid }
    );
    recoveryArtifacts.push(...preexistingArtifacts);
    io.writeFileSync(candidatePath, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    candidateIdentity = assertRegularArtifact(candidatePath, "writer lock candidate", io, { required: true });
    fsyncPath(candidatePath, io);
    fsyncDirectories([candidatePath], io);
    writerLockPhaseHook?.("lock-candidate");

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        io.linkSync(candidatePath, lockPath);
        acquiredIdentity = assertRegularArtifact(lockPath, "MCP writer lock", io, { required: true });
        if (!artifactMatchesIdentity(acquiredIdentity, serializedArtifactIdentity(candidateIdentity))) {
          throw new GeneratedPairWriterLockError("MCP writer lock identity changed during acquisition");
        }
        fsyncDirectories([lockPath], io);
        break;
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        const { identity, record: existingRecord } = readWriterLock(
          lockPath,
          targetPaths,
          "MCP writer lock",
          io,
          { lockTargetPath, requireExactTargets: false }
        );
        assertLockOwnerIsReclaimable(existingRecord, processIncarnationForPid);
        const stalePath = writerLockArtifactPath(lockPath, existingRecord.token, "stale");
        let staleIdentity;
        try {
          io.linkSync(lockPath, stalePath);
          staleIdentity = assertRegularArtifact(stalePath, "stale MCP writer lock", io, { required: true });
        } catch (linkError) {
          if (linkError?.code === "ENOENT") continue;
          if (linkError?.code !== "EEXIST") throw linkError;
          const staleLock = readWriterLock(
            stalePath,
            targetPaths,
            "stale MCP writer lock",
            io,
            { lockTargetPath, requireExactTargets: false }
          );
          if (staleLock.record.token !== existingRecord.token) {
            throw new GeneratedPairWriterLockError(
              `MCP writer lock artifact token does not match its metadata: ${stalePath}`
            );
          }
          staleIdentity = staleLock.identity;
        }
        if (!artifactMatchesIdentity(staleIdentity, serializedArtifactIdentity(identity))) {
          throw new GeneratedPairWriterLockError("MCP writer lock ownership changed during stale-lock quarantine");
        }
        fsyncDirectories([stalePath], io);
        writerLockPhaseHook?.("lock-stale-linked");
        unlinkCreatedArtifact(lockPath, identity, "stale MCP writer lock canonical", io);
        fsyncDirectories([lockPath], io);
        writerLockPhaseHook?.("lock-stale-quarantine");
        recoveryArtifacts.push({
          path: stalePath,
          suffix: "stale",
          token: existingRecord.token,
          identity: staleIdentity,
          record: existingRecord
        });
        const companionCandidatePath = writerLockArtifactPath(lockPath, existingRecord.token, "candidate");
        if (lstatIfPresent(companionCandidatePath, io)) {
          const companion = readWriterLock(
            companionCandidatePath,
            targetPaths,
            "stale writer lock candidate",
            io,
            { lockTargetPath, requireExactTargets: false }
          );
          if (
            companion.record.token !== existingRecord.token
            || !artifactMatchesIdentity(companion.identity, serializedArtifactIdentity(staleIdentity))
          ) {
            throw new GeneratedPairWriterLockError(
              `MCP stale writer lock candidate does not match quarantined ownership: ${companionCandidatePath}`
            );
          }
          if (!recoveryArtifacts.some(({ path }) => path === companionCandidatePath)) {
            recoveryArtifacts.push({
              path: companionCandidatePath,
              suffix: "candidate",
              token: existingRecord.token,
              identity: companion.identity,
              record: companion.record
            });
          }
        }
      }
    }
    if (!acquiredIdentity) {
      throw new GeneratedPairWriterLockError("MCP output writer lock acquisition lost a bounded concurrent race");
    }
    const knownRecoveryPaths = new Set(recoveryArtifacts.map(({ path }) => path));
    for (const artifact of inspectPreexistingLockArtifacts(
      lockPath,
      lockTargetPath,
      targetPaths,
      io,
      { suffixes: new Set(["stale"]), processIncarnationForPid }
    )) {
      if (!knownRecoveryPaths.has(artifact.path)) recoveryArtifacts.push(artifact);
    }
    unlinkCreatedArtifact(candidatePath, candidateIdentity, "writer lock candidate", io);
    candidateIdentity = null;
    fsyncDirectories([candidatePath], io);
    return {
      lockPath,
      lockTargetPath,
      identity: acquiredIdentity,
      transactionToken,
      processIncarnation,
      targetPaths: [...targetPaths],
      recoveryArtifacts,
      recoverableTransactionTokens: new Set(
        recoveryArtifacts
          .filter(({ record: staleRecord }) => targetPathsMatch(staleRecord.targetPaths, targetPaths))
          .map(({ record: staleRecord }) => staleRecord.token)
      )
    };
  } catch (error) {
    const cleanupErrors = [];
    if (acquiredIdentity) {
      try {
        unlinkCreatedArtifact(lockPath, acquiredIdentity, "MCP writer lock", io);
        fsyncDirectories([lockPath], io);
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    if (candidateIdentity) {
      try {
        unlinkCreatedArtifact(candidatePath, candidateIdentity, "writer lock candidate", io);
        fsyncDirectories([candidatePath], io);
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    if (cleanupErrors.length > 0) {
      throw new GeneratedPairTransactionError(
        [error, ...cleanupErrors],
        `${error.message}; writer lock acquisition cleanup was incomplete: ${cleanupErrors[0].message}`
      );
    }
    throw error;
  }
}

function orderedLockTargets(targetPaths) {
  return [...new Set(targetPaths)].sort((left, right) => {
    const leftPath = resolve(writerLockPathFor(left));
    const rightPath = resolve(writerLockPathFor(right));
    if (leftPath < rightPath) return -1;
    if (leftPath > rightPath) return 1;
    return 0;
  });
}

function releaseSingleGeneratedPairWriterLock(lock, io) {
  assertSingleGeneratedPairWriterLock(lock, lock.targetPaths, io);
  cleanupOwnedLockArtifact(lock.lockPath, lock.identity, "MCP writer lock", io);
}

export function acquireGeneratedPairWriterLock(
  targetPaths,
  transactionToken,
  io,
  { writerLockPhaseHook, processIncarnationForPid = defaultProcessIncarnationForPid } = {}
) {
  const locks = [];
  const emittedPerLockPhases = new Set();
  const emitPerLockPhaseOnce = writerLockPhaseHook
    ? (phase) => {
        if (emittedPerLockPhases.has(phase)) return;
        emittedPerLockPhases.add(phase);
        writerLockPhaseHook(phase);
      }
    : null;
  const processIncarnation = resolveProcessIncarnation(process.pid, processIncarnationForPid);
  if (!processIncarnation) {
    throw new GeneratedPairWriterLockError("MCP output writer cannot establish the current process incarnation");
  }
  try {
    for (const lockTargetPath of orderedLockTargets(targetPaths)) {
      locks.push(acquireSingleGeneratedPairWriterLock(
        targetPaths,
        lockTargetPath,
        transactionToken,
        io,
        { writerLockPhaseHook: emitPerLockPhaseOnce, processIncarnation, processIncarnationForPid }
      ));
    }
    writerLockPhaseHook?.("lock-published");
  } catch (error) {
    const cleanupErrors = [];
    for (const lock of locks.reverse()) {
      try {
        releaseSingleGeneratedPairWriterLock(lock, io);
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    if (cleanupErrors.length > 0) {
      throw new GeneratedPairTransactionError(
        [error, ...cleanupErrors],
        `${error.message}; multi-target writer lock cleanup was incomplete: ${cleanupErrors[0].message}`
      );
    }
    throw error;
  }

  const primaryLock = locks.find(({ lockTargetPath }) => lockTargetPath === targetPaths[0]);
  const recoveryArtifacts = locks.flatMap((lock) => lock.recoveryArtifacts);
  return {
    locks,
    lockPath: primaryLock.lockPath,
    identity: primaryLock.identity,
    transactionToken,
    processIncarnation: primaryLock.processIncarnation,
    targetPaths: [...targetPaths],
    recoveryArtifacts,
    recoverableTransactionTokens: new Set(locks.flatMap((lock) => [...lock.recoverableTransactionTokens]))
  };
}

export function finishGeneratedPairWriterLockRecovery(lock, io) {
  const cleanupErrors = [];
  for (const artifact of lock.recoveryArtifacts) {
    try {
      unlinkCreatedArtifact(artifact.path, artifact.identity, "stale writer lock evidence", io);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (cleanupErrors.length > 0) {
    throw new GeneratedPairTransactionError(
      cleanupErrors,
      `MCP writer lock recovery cleanup was incomplete: ${cleanupErrors[0].message}`
    );
  }
  if (lock.recoveryArtifacts.length > 0) fsyncDirectories(lock.recoveryArtifacts.map(({ path }) => path), io);
  lock.recoveryArtifacts.length = 0;
  lock.recoverableTransactionTokens.clear();
}

function assertSingleGeneratedPairWriterLock(lock, targetPaths, io) {
  if (
    !lock
    || !Array.isArray(lock.targetPaths)
    || lock.targetPaths.length !== targetPaths.length
    || lock.targetPaths.some((targetPath, index) => targetPath !== targetPaths[index])
    || !targetPaths.includes(lock.lockTargetPath)
    || lock.lockPath !== writerLockPathFor(lock.lockTargetPath)
  ) {
    throw new GeneratedPairWriterLockError("MCP writer lock does not match the exact output targets");
  }
  let current;
  try {
    current = assertRegularArtifact(lock.lockPath, "MCP writer lock", io, { required: true });
  } catch (error) {
    throw new GeneratedPairWriterLockError(`MCP writer lock is missing or unsafe: ${error.message}`, { cause: error });
  }
  if (!artifactMatchesIdentity(current, serializedArtifactIdentity(lock.identity))) {
    throw new GeneratedPairWriterLockError("MCP writer lock canonical identity changed while the writer was active");
  }
  const { identity, record } = readWriterLock(
    lock.lockPath,
    targetPaths,
    "MCP writer lock",
    io,
    { lockTargetPath: lock.lockTargetPath }
  );
  if (
    !artifactMatchesIdentity(identity, serializedArtifactIdentity(lock.identity))
    || record.token !== lock.transactionToken
    || record.pid !== process.pid
    || record.processIncarnation !== lock.processIncarnation
  ) {
    throw new GeneratedPairWriterLockError(
      "MCP writer lock ownership, token, PID, or process incarnation changed while the writer was active"
    );
  }
}

export function assertGeneratedPairWriterLock(lock, targetPaths, io) {
  const expectedLockTargets = orderedLockTargets(targetPaths);
  if (
    !lock
    || !Array.isArray(lock.locks)
    || lock.locks.length !== expectedLockTargets.length
    || !Array.isArray(lock.targetPaths)
    || !targetPathsMatch(lock.targetPaths, targetPaths)
    || lock.transactionToken !== lock.locks[0]?.transactionToken
    || !targetPathsMatch(lock.locks.map(({ lockTargetPath }) => lockTargetPath), expectedLockTargets)
    || lock.locks.some(({ transactionToken }) => transactionToken !== lock.transactionToken)
  ) {
    throw new GeneratedPairWriterLockError("MCP writer lock does not match the exact output targets");
  }
  for (const singleLock of lock.locks) assertSingleGeneratedPairWriterLock(singleLock, targetPaths, io);
}

export function releaseGeneratedPairWriterLock(lock, io) {
  const cleanupErrors = [];
  for (const singleLock of [...(lock?.locks ?? [])].reverse()) {
    try {
      releaseSingleGeneratedPairWriterLock(singleLock, io);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (cleanupErrors.length > 0) {
    throw new GeneratedPairWriterLockError(
      `MCP writer lock release was incomplete: ${cleanupErrors[0].message}`,
      { cause: new AggregateError(cleanupErrors) }
    );
  }
}

function assertExistingEntryArtifactsAreRegular(entries, io) {
  for (const entry of entries) {
    assertRegularArtifact(entry.targetPath, "transaction output", io);
    assertRegularArtifact(entry.temporaryPath, "transaction temporary file", io);
    assertRegularArtifact(entry.backupPath, "transaction backup", io);
  }
}

function assertInstalledEntryIdentities(entries, io) {
  for (const entry of entries) {
    if (!entry.temporaryIdentity) throw new Error("installed transaction output identity was not recorded");
    assertArtifactMatchesIdentity(
      entry.targetPath,
      entry.temporaryIdentity,
      "installed transaction output",
      io
    );
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
  const temporaryIdentity = entry.temporaryIdentity === undefined
    ? null
    : validateSerializedArtifactIdentity(entry.temporaryIdentity, "transaction temporary file");
  const originalIdentity = entry.originalIdentity === undefined || entry.originalIdentity === null
    ? null
    : validateSerializedArtifactIdentity(entry.originalIdentity, "transaction original output");
  if (!entry.hadTarget && originalIdentity) {
    throw new Error(`transaction original output identity does not match hadTarget for ${targetPath}`);
  }
  return { ...entry, originalIdentity, temporaryIdentity, transactionToken: temporaryToken };
}

function readJournal(journalPath, targetPaths, io, label = "transaction journal") {
  const initialIdentity = assertRegularArtifact(journalPath, label, io, { required: true });
  let journal;
  try {
    journal = JSON.parse(io.readFileSync(journalPath, "utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`, { cause: error });
  }
  const finalIdentity = assertRegularArtifact(journalPath, label, io, { required: true });
  if (!artifactMatchesIdentity(finalIdentity, serializedArtifactIdentity(initialIdentity))) {
    throw new Error(`${label} identity changed while it was being read`);
  }
  if (
    journal?.version !== JOURNAL_VERSION
    || typeof journal.committed !== "boolean"
    || !Array.isArray(journal.entries)
    || journal.entries.length !== 2
  ) {
    throw new Error(`${label} has an unsupported shape`);
  }
  const entries = targetPaths.map((targetPath, index) => validateJournalEntry(journal.entries[index], targetPath));
  if (new Set(entries.map(({ transactionToken }) => transactionToken)).size !== 1) {
    throw new Error("transaction journal entries have mismatched transaction tokens");
  }
  return {
    committed: journal.committed,
    entries,
    journalIdentity: serializedArtifactIdentity(finalIdentity),
    record: journal
  };
}

function assertExactCommittedJournalSuccessor(journal, journalUpdate) {
  const expectedSuccessor = { ...journal.record, committed: true };
  if (
    journal.committed
    || !journalUpdate.committed
    || !isDeepStrictEqual(journalUpdate.record, expectedSuccessor)
  ) {
    throw new Error(
      "transaction journal update is not the exact committed successor of the canonical uncommitted journal"
    );
  }
}

function finishJournal(entries, journalPath, journalIdentity, journalUpdateIdentity, io) {
  const updatePath = `${journalPath}.next`;
  const currentJournal = assertArtifactMatchesIdentity(journalPath, journalIdentity, "transaction journal", io);
  const currentUpdate = assertRegularArtifact(updatePath, "transaction journal update", io);
  if (journalUpdateIdentity) {
    if (!currentUpdate) throw new Error(`transaction journal update is missing: ${updatePath}`);
    if (!artifactMatchesIdentity(currentUpdate, journalUpdateIdentity)) {
      throw new Error(`transaction journal update identity does not match the recorded transaction: ${updatePath}`);
    }
    unlinkCreatedArtifact(updatePath, currentUpdate, "transaction journal update", io);
  } else if (currentUpdate) {
    throw new Error(`unowned transaction journal update was preserved: ${updatePath}`);
  }
  unlinkCreatedArtifact(journalPath, currentJournal, "transaction journal", io);
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

function cleanUnpublishedJournalStage(targetPaths, journalPath, io, recoverableTransactionTokens) {
  const stages = stagedJournalPaths(journalPath, io);
  if (stages.length === 0) return;
  if (lstatIfPresent(journalPath, io) || stages.length !== 1) {
    throw new GeneratedPairTransactionError(
      [],
      "MCP output transaction recovery was incomplete; ambiguous journal artifacts were preserved"
    );
  }
  const stagePath = stages[0];
  let stageIdentity;
  try {
    stageIdentity = assertRegularArtifact(stagePath, "staged transaction journal", io, { required: true });
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
  const temporaryIdentities = new Map();
  try {
    for (const { temporaryPath } of entries) {
      temporaryIdentities.set(
        temporaryPath,
        assertRegularArtifact(temporaryPath, "staged transaction temporary file", io, { required: true })
      );
    }
  } catch (error) {
    throw new GeneratedPairTransactionError(
      [error],
      `MCP output transaction recovery was incomplete; staged journal was preserved: ${error.message}`
    );
  }
  if (!recoverableTransactionTokens.has(token)) {
    throw new GeneratedPairTransactionError(
      [],
      "MCP output transaction recovery was incomplete; staged journal ownership could not be proven"
    );
  }
  try {
    assertArtifactMatchesIdentity(
      stagePath,
      serializedArtifactIdentity(stageIdentity),
      "staged transaction journal",
      io
    );
    for (const [temporaryPath, identity] of temporaryIdentities) {
      assertArtifactMatchesIdentity(
        temporaryPath,
        serializedArtifactIdentity(identity),
        "staged transaction temporary file",
        io
      );
    }
  } catch (error) {
    throw new GeneratedPairTransactionError(
      [error],
      `MCP output transaction recovery was incomplete; staged journal was preserved: ${error.message}`
    );
  }
  const cleanupErrors = [];
  for (const [temporaryPath, identity] of temporaryIdentities) {
    try {
      unlinkCreatedArtifact(temporaryPath, identity, "staged transaction temporary file", io);
    } catch (error) {
      cleanupErrors.push(error);
      break;
    }
  }
  if (cleanupErrors.length === 0) {
    try {
      unlinkCreatedArtifact(stagePath, stageIdentity, "staged transaction journal", io);
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

function cleanUnpublishedTemporaryPair(targetPaths, io, recoverableTransactionTokens) {
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
  if (!recoverableTransactionTokens.has(candidates[0].token)) {
    throw new GeneratedPairTransactionError(
      [],
      "MCP output transaction recovery was incomplete; live or unowned pre-journal temporary artifacts were preserved"
    );
  }
  try {
    const candidateIdentities = new Map();
    for (const candidate of candidates) {
      candidateIdentities.set(
        candidate.path,
        assertRegularArtifact(candidate.path, "pre-journal transaction temporary file", io, { required: true })
      );
    }
    for (const candidate of candidates) {
      assertArtifactMatchesIdentity(
        candidate.path,
        serializedArtifactIdentity(candidateIdentities.get(candidate.path)),
        "pre-journal transaction temporary file",
        io
      );
    }
    for (const candidate of candidates) {
      unlinkCreatedArtifact(
        candidate.path,
        candidateIdentities.get(candidate.path),
        "pre-journal transaction temporary file",
        io
      );
    }
    fsyncDirectories(candidates.map(({ path }) => path), io);
  } catch (error) {
    throw new GeneratedPairTransactionError(
      [error],
      `MCP output transaction recovery was incomplete; pre-journal temporary cleanup failed: ${error.message}`
    );
  }
}

export function recoverGeneratedPair(targetPaths, io, { recoverableTransactionTokens = new Set() } = {}) {
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
  cleanUnpublishedJournalStage(targetPaths, journalPath, io, recoverableTransactionTokens);
  if (!lstatIfPresent(journalPath, io)) {
    cleanUnpublishedTemporaryPair(targetPaths, io, recoverableTransactionTokens);
    return;
  }

  let journal;
  let journalUpdate = null;
  try {
    journal = readJournal(journalPath, targetPaths, io);
    if (lstatIfPresent(journalUpdatePath, io)) {
      journalUpdate = readJournal(journalUpdatePath, targetPaths, io, "transaction journal update");
      assertExactCommittedJournalSuccessor(journal, journalUpdate);
    }
  } catch (error) {
    throw new GeneratedPairTransactionError([error], `MCP output transaction recovery was incomplete: ${error.message}`);
  }
  const { entries, journalIdentity } = journal;
  const committed = journalUpdate ? true : journal.committed;
  const journalUpdateIdentity = journalUpdate?.journalIdentity ?? null;
  try {
    assertExistingEntryArtifactsAreRegular(entries, io);
    for (const entry of entries) {
      if (!io.existsSync(entry.temporaryPath)) continue;
      if (!entry.temporaryIdentity) throw new Error("transaction temporary file identity was not recorded");
      assertArtifactMatchesIdentity(
        entry.temporaryPath,
        entry.temporaryIdentity,
        "transaction temporary file",
        io
      );
    }
    for (const entry of entries) {
      if (!io.existsSync(entry.backupPath)) continue;
      if (!entry.originalIdentity) throw new Error("transaction backup identity was not recorded");
      assertArtifactMatchesIdentity(
        entry.backupPath,
        entry.originalIdentity,
        "transaction backup",
        io
      );
    }
    if (!committed) {
      for (const entry of entries) {
        if (!entry.hadTarget || io.existsSync(entry.backupPath)) continue;
        if (!entry.originalIdentity) throw new Error("transaction original output identity was not recorded");
        assertArtifactMatchesIdentity(
          entry.targetPath,
          entry.originalIdentity,
          "transaction original output",
          io
        );
      }
    }
    assertArtifactMatchesIdentity(journalPath, journalIdentity, "transaction journal", io);
    if (journalUpdateIdentity) {
      assertArtifactMatchesIdentity(
        journalUpdatePath,
        journalUpdateIdentity,
        "transaction journal update",
        io
      );
    }
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
      if (!entry.temporaryIdentity) {
        throw new GeneratedPairTransactionError(
          [],
          "MCP output transaction recovery was incomplete; committed output identity was not recorded"
        );
      }
      try {
        assertArtifactMatchesIdentity(
          entry.targetPath,
          entry.temporaryIdentity,
          "committed transaction output",
          io
        );
      } catch (error) {
        throw new GeneratedPairTransactionError(
          [error],
          `MCP output transaction recovery was incomplete; committed output does not belong to the recorded transaction: ${error.message}`
        );
      }
    }
    for (const entry of entries) {
      if (!io.existsSync(entry.backupPath)) continue;
      try {
        assertArtifactMatchesIdentity(entry.backupPath, entry.originalIdentity, "transaction backup", io);
        io.unlinkSync(entry.backupPath);
      } catch (error) {
        recoveryErrors.push(error);
      }
    }
  } else {
    for (const entry of entries) {
      try {
        if (io.existsSync(entry.backupPath)) {
          if (io.existsSync(entry.targetPath)) {
            if (!entry.temporaryIdentity) throw new Error("installed output identity was not recorded");
            assertArtifactMatchesIdentity(
              entry.targetPath,
              entry.temporaryIdentity,
              "rollback transaction output",
              io
            );
          }
          io.renameSync(entry.backupPath, entry.targetPath);
        } else if (!entry.hadTarget && io.existsSync(entry.targetPath) && !io.existsSync(entry.temporaryPath)) {
          if (!entry.temporaryIdentity) throw new Error("installed output identity was not recorded");
          assertArtifactMatchesIdentity(
            entry.targetPath,
            entry.temporaryIdentity,
            "rollback transaction output",
            io
          );
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
      `MCP output transaction recovery was incomplete; recovery backups and journal were preserved: ${recoveryErrors[0].message}`,
      { recoveryMutationsAttempted: true }
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
    if (io.existsSync(entry.temporaryPath)) {
      assertArtifactMatchesIdentity(
        entry.temporaryPath,
        entry.temporaryIdentity,
        "transaction temporary file",
        io
      );
      io.unlinkSync(entry.temporaryPath);
    }
    if (io.existsSync(entry.backupPath)) {
      assertArtifactMatchesIdentity(entry.backupPath, entry.originalIdentity, "transaction backup", io);
      io.unlinkSync(entry.backupPath);
    }
  }
  fsyncDirectories(entries.map(({ targetPath }) => targetPath), io);
  finishJournal(entries, journalPath, journalIdentity, journalUpdateIdentity, io);
}

function writeGeneratedPairLocked(outputs, { io, transactionToken, transactionPhaseHook, writerLock }) {
  const entries = outputs.map(({ targetPath, contents }) => {
    const originalStat = lstatIfPresent(targetPath, io);
    return {
      targetPath,
      contents,
      ...transactionPathsFor(targetPath, transactionToken),
      hadTarget: Boolean(originalStat),
      originalIdentity: originalStat ? serializedArtifactIdentity(originalStat) : null
    };
  });
  const targetPaths = entries.map(({ targetPath }) => targetPath);
  const journalPath = journalPathFor(targetPaths[0]);
  const initialJournalStagePath = `${journalPath}.${transactionToken}.stage`;
  let journalPersisted = false;
  let journalIdentity = null;
  const createdTemporaryArtifacts = new Map();
  let createdInitialJournalStage = null;

  try {
    assertGeneratedPairWriterLock(writerLock, targetPaths, io);
    assertExistingEntryArtifactsAreRegular(entries, io);
    for (const entry of entries) {
      io.writeFileSync(entry.temporaryPath, entry.contents, { encoding: "utf8", flag: "wx" });
      const identity = assertRegularArtifact(entry.temporaryPath, "transaction temporary file", io, { required: true });
      createdTemporaryArtifacts.set(entry.temporaryPath, identity);
      entry.temporaryIdentity = serializedArtifactIdentity(identity);
      fsyncPath(entry.temporaryPath, io);
    }
    fsyncDirectories(entries.map(({ temporaryPath }) => temporaryPath), io);
    transactionPhaseHook?.("temporary-files");
    assertGeneratedPairWriterLock(writerLock, targetPaths, io);

    const journal = {
      version: JOURNAL_VERSION,
      committed: false,
      entries: entries.map(({ targetPath, temporaryPath, backupPath, hadTarget, originalIdentity, temporaryIdentity }) => ({
        targetPath,
        temporaryPath,
        backupPath,
        hadTarget,
        originalIdentity,
        temporaryIdentity
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
    journalIdentity = serializedArtifactIdentity(
      assertRegularArtifact(journalPath, "transaction journal", io, { required: true })
    );
    fsyncDirectories([journalPath], io);
    transactionPhaseHook?.("journal");
    assertGeneratedPairWriterLock(writerLock, targetPaths, io);

    for (const entry of entries) {
      if (entry.hadTarget) {
        assertArtifactMatchesIdentity(
          entry.targetPath,
          entry.originalIdentity,
          "transaction original output",
          io
        );
        io.renameSync(entry.targetPath, entry.backupPath);
        assertArtifactMatchesIdentity(entry.backupPath, entry.originalIdentity, "transaction backup", io);
      }
    }
    fsyncDirectories(targetPaths, io);
    transactionPhaseHook?.("backup");
    assertGeneratedPairWriterLock(writerLock, targetPaths, io);

    io.renameSync(entries[0].temporaryPath, entries[0].targetPath);
    assertRegularArtifact(entries[0].targetPath, "installed transaction output", io, { required: true });
    fsyncDirectories([entries[0].targetPath], io);
    transactionPhaseHook?.("first-install");
    assertGeneratedPairWriterLock(writerLock, targetPaths, io);
    assertInstalledEntryIdentities(entries.slice(0, 1), io);

    io.renameSync(entries[1].temporaryPath, entries[1].targetPath);
    assertRegularArtifact(entries[1].targetPath, "installed transaction output", io, { required: true });
    fsyncDirectories([entries[1].targetPath], io);
    assertInstalledEntryIdentities(entries, io);
    const journalUpdatePath = `${journalPath}.next`;
    io.writeFileSync(
      journalUpdatePath,
      `${JSON.stringify({ ...journal, committed: true }, null, 2)}\n`,
      { encoding: "utf8", flag: "wx" }
    );
    assertRegularArtifact(journalUpdatePath, "transaction journal update", io, { required: true });
    fsyncPath(journalUpdatePath, io);
    io.renameSync(journalUpdatePath, journalPath);
    journalIdentity = serializedArtifactIdentity(
      assertRegularArtifact(journalPath, "transaction journal", io, { required: true })
    );
    fsyncDirectories([journalPath], io);
    transactionPhaseHook?.("second-install");
    assertGeneratedPairWriterLock(writerLock, targetPaths, io);
    assertInstalledEntryIdentities(entries, io);
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
      assertGeneratedPairWriterLock(writerLock, targetPaths, io);
    } catch (lockError) {
      throw new GeneratedPairTransactionError(
        [error, lockError],
        `${error.message}; rollback was not attempted because writer lock ownership was lost, and transaction evidence was preserved`
      );
    }
    try {
      recoverGeneratedPair(targetPaths, io, { recoverableTransactionTokens: new Set([transactionToken]) });
    } catch (recoveryError) {
      const cleanupErrors = [];
      if (recoveryError?.recoveryMutationsAttempted) {
        for (const [temporaryPath, identity] of createdTemporaryArtifacts) {
          try {
            unlinkCreatedArtifact(temporaryPath, identity, "transaction temporary file", io);
          } catch (cleanupError) {
            cleanupErrors.push(cleanupError);
          }
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
  try {
    transactionPhaseHook?.("cleanup");
    assertGeneratedPairWriterLock(writerLock, targetPaths, io);
    assertInstalledEntryIdentities(entries, io);
    assertArtifactMatchesIdentity(journalPath, journalIdentity, "transaction journal", io);
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (cleanupErrors.length > 0) {
    throw new GeneratedPairTransactionError(
      cleanupErrors,
      `backup cleanup failed after MCP outputs were committed; journal was preserved: ${cleanupErrors[0].message}`
    );
  }
  for (const entry of entries) {
    if (!entry.hadTarget || !io.existsSync(entry.backupPath)) continue;
    try {
      assertArtifactMatchesIdentity(entry.backupPath, entry.originalIdentity, "transaction backup", io);
      io.unlinkSync(entry.backupPath);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  try {
    fsyncDirectories(targetPaths, io);
    assertGeneratedPairWriterLock(writerLock, targetPaths, io);
    assertInstalledEntryIdentities(entries, io);
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (cleanupErrors.length > 0) {
    throw new GeneratedPairTransactionError(
      cleanupErrors,
      `backup cleanup failed after MCP outputs were committed; journal was preserved: ${cleanupErrors[0].message}`
    );
  }
  finishJournal(entries, journalPath, journalIdentity, null, io);
}

export function writeGeneratedPair(outputs, options) {
  const { io, transactionToken, writerLock = null } = options;
  const targetPaths = outputs.map(({ targetPath }) => targetPath);
  if (writerLock && writerLock.transactionToken !== transactionToken) {
    throw new GeneratedPairWriterLockError("MCP writer lock token does not match the generated-pair transaction");
  }
  const ownedLock = writerLock ?? acquireGeneratedPairWriterLock(targetPaths, transactionToken, io, {
    writerLockPhaseHook: options.writerLockPhaseHook
  });
  let operationError = null;
  try {
    assertGeneratedPairWriterLock(ownedLock, targetPaths, io);
    return writeGeneratedPairLocked(outputs, { ...options, writerLock: ownedLock });
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    if (!writerLock) {
      try {
        releaseGeneratedPairWriterLock(ownedLock, io);
      } catch (releaseError) {
        if (operationError) {
          throw new GeneratedPairTransactionError(
            [operationError, releaseError],
            `${operationError.message}; writer lock release was incomplete: ${releaseError.message}`
          );
        }
        throw releaseError;
      }
    }
  }
}
