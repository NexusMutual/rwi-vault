const COMMIT_TYPES = {
  feat: 'minor',
  fix: 'patch',
  perf: 'patch',
  build: 'patch',
  chore: 'patch',
  refactor: 'patch',
  revert: 'patch',
  docs: null,
  style: null,
  test: null,
  ci: null,
};

const RELEASE_TYPES = {
  0: 'MAJOR',
  1: 'MINOR',
  2: 'PATCH',
};

// The parser's default header pattern rejects the '!' marker, so 'feat!: x'
// arrives with no type. Read the marker off the raw header.
const BREAKING_HEADER_RE = /^\w+(?:\([^)]*\))?!:[ \t]+\S/;

const config = {
  whatBump: commits => {
    let level = null;
    let breakingCount = 0;
    let featureCount = 0;
    let patchCount = 0;

    commits.forEach(commit => {
      const locations = [commit.body, commit.subject, commit.footer];
      const notesTitles = (commit.notes || []).map(note => note.title);
      const allLocations = [...locations, ...notesTitles];
      // Footer form only — avoid matching prose that mentions the phrase.
      // Conventional Commits treats BREAKING-CHANGE as synonymous with BREAKING CHANGE.
      const BREAKING_CHANGE_RE = /^BREAKING[ -]CHANGE:[ \t]+\S/m;
      const hasBreakingChangeText = allLocations.some(
        text => typeof text === 'string' && BREAKING_CHANGE_RE.test(text),
      );

      if (BREAKING_HEADER_RE.test(commit.header || '') || hasBreakingChangeText) {
        breakingCount++;
        return;
      }

      switch (COMMIT_TYPES[commit.type]) {
        case 'major':
          breakingCount++;
          break;
        case 'minor':
          featureCount++;
          break;
        case 'patch':
          patchCount++;
          break;
      }
    });

    if (breakingCount > 0) {
      level = 0;
    } else if (featureCount > 0) {
      level = 1;
    } else if (patchCount > 0) {
      level = 2;
    }

    const summary = `There are ${breakingCount} breaking changes, ${featureCount} features, and ${patchCount} patches`;
    const releaseMsg = level === null ? 'No version bump needed.' : `Bumping ${RELEASE_TYPES[level]} version.`;
    const reason = `${summary}. ${releaseMsg}`;
    
    console.warn(reason);

    return {
      level,
      reason,
    };
  },
};

module.exports = config;
