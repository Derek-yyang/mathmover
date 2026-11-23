const fs = require('node:fs');
const path = require('node:path');

function versionParts(version) {
  return typeof version === 'string' && /^\d+\.\d+\.\d+$/.test(version) ? version.split('.').map(Number) : null;
}

function newerThan(current, seen) {
  const left = versionParts(current);
  const right = versionParts(seen);
  if (!left) return false;
  if (!right) return true;
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] > right[i];
  }
  return false;
}

/** App-owned persistence survives the random localhost port and app upgrades. */
function createReleaseNotesState(dataDir, version) {
  const file = path.join(dataDir, 'release-notes.json');
  const read = () => {
    try {
      const value = JSON.parse(fs.readFileSync(file, 'utf8')).seenVersion;
      return versionParts(value) ? value : null;
    } catch { return null; }
  };
  return {
    get(onboarding = false) {
      const seenVersion = read();
      return { version, seenVersion, onboarding, shouldShow: !onboarding && newerThan(version, seenVersion) };
    },
    acknowledge(requestedVersion) {
      if (requestedVersion !== version || !versionParts(version)) throw new Error('无效的更新记录版本');
      // Opening an older installation must not reset the acknowledgement.
      if (!newerThan(version, read())) return;
      fs.mkdirSync(dataDir, { recursive: true });
      const temporary = `${file}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify({ seenVersion: version }), 'utf8');
      fs.renameSync(temporary, file);
    },
  };
}

module.exports = { createReleaseNotesState };
