import fs from "node:fs";
import path from "node:path";

// Managed lifecycle locking is a cooperative operator boundary. The Python
// wrapper owns the kernel lock; descendants verify that fd 3 names the stable
// lock inode before preserving it across another spawn.
export function lifecycleLockFd() {
  const value = process.env.WIKI_LIFECYCLE_LOCK_FD;
  if (value === undefined) return null;
  if (value !== "3") throw Error("Invalid managed lifecycle lock descriptor");
  const root = process.env.WIKI_LIFECYCLE_ROOT;
  const filename = process.env.WIKI_LIFECYCLE_LOCK;
  if (
    !root ||
    !filename ||
    !path.isAbsolute(root) ||
    !path.isAbsolute(filename)
  )
    throw Error("Incomplete managed lifecycle lock environment");
  const expected = path.join(path.resolve(root), ".lifecycle", "owner.lock");
  if (path.resolve(filename) !== expected)
    throw Error("Managed lifecycle lock is outside its data root");
  let descriptor, lock;
  try {
    descriptor = fs.fstatSync(3);
    lock = fs.lstatSync(expected);
  } catch {
    throw Error("Managed lifecycle lock descriptor is unavailable");
  }
  if (
    !descriptor.isFile() ||
    !lock.isFile() ||
    lock.isSymbolicLink() ||
    descriptor.dev !== lock.dev ||
    descriptor.ino !== lock.ino ||
    lock.nlink !== 1
  )
    throw Error("Managed lifecycle lock descriptor does not match owner.lock");
  return 3;
}

export function lifecycleStdio(stdio) {
  const fd = lifecycleLockFd();
  return fd === null ? stdio : [...stdio, fd];
}
