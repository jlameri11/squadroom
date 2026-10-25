// The only place a Supabase project is named.
//
// CLAUDE.md's first rule: "Only ever touch the Supabase project squadroom-dev
// (rnykncrdcywmetuvslvw). Never read or change any other Supabase project."
//
// A Supabase personal access token cannot be scoped to one project — it is
// account-wide, and there is no setting that changes that. So the guarantee
// cannot come from the credential; it has to come from the code that holds
// it. This module is that code.
//
// Every script that can reach Supabase builds its URL through `endpoint()`
// and checks its connection string through `assertOurs()`. Neither takes a
// project id from an argument, an environment variable or a prompt, so there
// is no input to any of these tools that can aim them somewhere else.
//
// scripts/test-project-guard.mjs proves it.

export const PROJECT_REF = 'rnykncrdcywmetuvslvw'
export const PROJECT_NAME = 'squadroom-dev'

const API = 'https://api.supabase.com'

/**
 * A management API URL for OUR project, and no other.
 *
 * `path` is appended after /v1/projects/<ref>, so a caller cannot escape the
 * project even by passing something hostile: a path containing ".." or its
 * own "/v1/projects/" is refused rather than normalised, because normalising
 * it quietly is how a guard becomes decoration.
 */
export function endpoint(path = '') {
  const tail = path.replace(/^\/+/, '')
  if (tail.includes('..') || tail.includes('//') || /v1\/projects/i.test(tail)) {
    throw new Error(`refusing to build a URL from a path that tries to leave the project: ${path}`)
  }
  return `${API}/v1/projects/${PROJECT_REF}${tail ? '/' + tail : ''}`
}

/**
 * Refuse a Postgres connection string that is not ours.
 *
 * A connection string is exactly the kind of thing that gets pasted from the
 * wrong dashboard tab, and the symptom of getting it wrong is a migration
 * applied to somebody else's database.
 */
export function assertOurs(connectionString) {
  if (!connectionString.includes(PROJECT_REF)) {
    throw new Error(
      `That connection string is not ${PROJECT_NAME} (${PROJECT_REF}).\n` +
        '  Refusing to run. Only ever touch ' + PROJECT_NAME + '.'
    )
  }
}

/**
 * Ask the API which project this actually is, and stop if it is not ours.
 *
 * The URL guard above is already enough, but this costs one request and
 * closes the gap between "the URL names our project" and "the thing that
 * answered IS our project" — a redirect, a proxy or a typo'd constant would
 * all pass the first check and fail this one.
 */
export async function confirmProject(token) {
  const response = await fetch(endpoint(), { headers: { Authorization: `Bearer ${token}` } })
  if (!response.ok) {
    throw new Error(`could not confirm the project: HTTP ${response.status} ${await response.text()}`)
  }
  const project = await response.json()
  if (project.id !== PROJECT_REF) {
    throw new Error(`the API answered for project ${project.id}, not ${PROJECT_REF}`)
  }
  return project
}
