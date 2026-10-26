const STATE_TITLE = 'MovieBot state — do not delete';
const MARKER = '<!-- MOVIEBOT_STATE -->';
const STATE_VERSION = 5;
// Issues created with the workflow's GITHUB_TOKEN are authored by this account.
const STATE_AUTHOR = 'github-actions[bot]';
// Only users with write access can label issues; GitHub creates the label on first use.
const STATE_LABEL = 'moviebot-state';
// GitHub rejects issue bodies over 65,536 characters; leave room for the wrapper text.
const MAX_STATE_CHARS = 60_000;

function githubHeaders(token) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
    'User-Agent': 'moviebot-seat-monitor',
  };
}

async function githubRequest(path, options = {}) {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!token || !repository) return null;
  const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
    ...options,
    headers: { ...githubHeaders(token), ...(options.headers || {}) },
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${await response.text()}`);
  if (response.status === 204) return null;
  return response.json();
}

/**
 * pages:    "<movie>|<date>" -> { checkedAt, showtimes: [...] } (only showtimes some watch wants)
 * sessions: "<session url>" -> { checkedAt, date, alerts: { "<watch name>": fingerprint } }
 * block:    { pausedUntil, active } after Harkins shows a CAPTCHA/block page
 * health:   "<watch name>" -> { badRuns, alerted }
 */
export function emptyState() {
  return { version: STATE_VERSION, pages: {}, sessions: {}, block: { pausedUntil: null, active: false }, health: {} };
}

export function parseState(body = '') {
  const markerIndex = body.indexOf(MARKER);
  if (markerIndex < 0) return emptyState();
  const jsonMatch = body.slice(markerIndex + MARKER.length).match(/```json\s*([\s\S]*?)```/i);
  if (!jsonMatch) return emptyState();
  try {
    const parsed = JSON.parse(jsonMatch[1]);
    // Older versions stored different shapes; start fresh rather than misread them.
    if (parsed.version !== STATE_VERSION) return emptyState();
    const empty = emptyState();
    return {
      ...empty,
      ...parsed,
      pages: parsed.pages || {},
      sessions: parsed.sessions || {},
      block: { ...empty.block, ...(parsed.block || {}) },
      health: parsed.health || {},
    };
  } catch {
    return emptyState();
  }
}

/**
 * Drop entries for past dates, then, if the state is still too large for an
 * issue body, drop the furthest-out cached pages first (they are simply
 * re-read on a later run).
 */
export function pruneState(state, today) {
  for (const [key, page] of Object.entries(state.pages)) {
    if (key.split('|')[1] < today) delete state.pages[key];
    else if (!page?.checkedAt) delete state.pages[key];
  }
  for (const [url, session] of Object.entries(state.sessions)) {
    if (!session?.date || session.date < today) delete state.sessions[url];
  }
  const size = () => JSON.stringify(state).length;
  if (size() <= MAX_STATE_CHARS) return state;
  const pageKeys = Object.keys(state.pages).sort((a, b) => b.split('|')[1].localeCompare(a.split('|')[1]));
  for (const key of pageKeys) {
    delete state.pages[key];
    if (size() <= MAX_STATE_CHARS) return state;
  }
  const sessionUrls = Object.keys(state.sessions)
    .sort((a, b) => state.sessions[b].date.localeCompare(state.sessions[a].date));
  for (const url of sessionUrls) {
    delete state.sessions[url];
    if (size() <= MAX_STATE_CHARS) return state;
  }
  return state;
}

export function serializeState(state) {
  return `${MARKER}\nThis issue stores MovieBot's bookkeeping (what was already checked and alerted). Do not edit it by hand.\n\n\`\`\`json\n${JSON.stringify(state)}\n\`\`\``;
}

export async function loadState() {
  if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_REPOSITORY) {
    console.warn('No GITHUB_TOKEN/GITHUB_REPOSITORY: state is in-memory only for this run.');
    return { issueNumber: null, state: emptyState() };
  }
  // Look the issue up by label so it is found however many alert issues exist.
  // The repo is public and anyone may open issues, so also require that the
  // workflow itself created it, not a look-alike opened by someone else.
  const issues = await githubRequest(`/issues?state=all&per_page=100&labels=${STATE_LABEL}`);
  const issue = issues.find((item) => item.title === STATE_TITLE && !item.pull_request && item.user?.login === STATE_AUTHOR);
  if (issue) return { issueNumber: issue.number, state: parseState(issue.body) };

  const state = emptyState();
  const created = await githubRequest('/issues', {
    method: 'POST',
    body: JSON.stringify({ title: STATE_TITLE, body: serializeState(state), labels: [STATE_LABEL] }),
  });
  return { issueNumber: created.number, state };
}

export async function saveState(issueNumber, state) {
  if (!issueNumber) return;
  state.version = STATE_VERSION;
  state.updatedAt = new Date().toISOString();
  await githubRequest(`/issues/${issueNumber}`, {
    method: 'PATCH',
    body: JSON.stringify({ body: serializeState(state) }),
  });
}
