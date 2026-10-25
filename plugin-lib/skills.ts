// Skill picking, the pure part: index, keyword shortlist, decide request, injection.
// No I/O here; plugins/skill-pick.ts does the fetch and the opencode wiring.
//
// The shortlist is a keyword score of the new prompt against each skill's name and
// description, weighted by how rare each word is across all skills (IDF). It only
// narrows the options handed to the decision; the model's own next-token choice
// over the shortlist (decide-gateway /v1/decide) picks the skill.

export type Skill = { id: string; name: string; description: string; content: string }
export type Entry = Skill & { nameTokens: Set<string>; tokens: Set<string> }
export type Index = { entries: Entry[]; idf: Map<string, number>; catalog: string }

export const SHORTLIST_MAX = 15        // decide takes at most 16 options, "none" is one
export const MIN_SCORE = 2.5           // below this no skill is a candidate: skip the decision
export const ACCEPT = 0.6              // decide probability needed to inject
export const STATE_CHARS = 400         // how much of the prompt the decision reads
export const CATALOG_DESC = 260        // catalog chars per skill (see decideRequest: the catalog must reach the
                                       // engine's conversation-cache floor, 2048 tokens, to keep a slot of its
                                       // own; below it every main turn evicts it and a decision costs ~4 s)
export const INLINE_MAX = 8000         // larger bodies are announced, not inlined

const STOP = new Set(("the and for with that this from your you are use when any not but all can how its into " +
  "what who why will was has have had been them they then than there here also only just each every via " +
  "about after before over under like some more most such other our out own get got let lets make need " +
  "want would could should must may might one two new now off per too very did does done doing using used " +
  "skill skills instead always never before").split(" "))

// lower-case words of 3+ chars, a light plural/verb-suffix trim, stop words dropped
export function tokens(text: string): string[] {
  const out: string[] = []
  for (let w of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (w.length < 3 || STOP.has(w) || /^\d+$/.test(w)) continue
    if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3)
    else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2)
    else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1)
    out.push(w)
  }
  return out
}

export function buildIndex(skills: Skill[]): Index {
  // sorted, so the catalog text is the same whatever order the registry lists skills in
  const entries: Entry[] = [...skills].sort((a, b) => a.id.localeCompare(b.id)).map((s) => {
    const nameTokens = new Set(tokens(s.name + " " + s.id))
    return { ...s, nameTokens, tokens: new Set([...nameTokens, ...tokens(s.description)]) }
  })
  const df = new Map<string, number>()
  for (const e of entries) for (const t of e.tokens) df.set(t, (df.get(t) ?? 0) + 1)
  const idf = new Map<string, number>()
  for (const [t, n] of df) idf.set(t, Math.log(1 + entries.length / n))
  const catalog = "Skills that exist:\n" + entries.map((e) => `- ${e.id}: ${e.description.slice(0, CATALOG_DESC)}`).join("\n")
  return { entries, idf, catalog }
}

// skills whose name or description share rare words with the prompt, best first
export function shortlist(prompt: string, index: Index, max = SHORTLIST_MAX, min = MIN_SCORE): { entry: Entry; score: number }[] {
  const words = new Set(tokens(prompt.slice(0, STATE_CHARS * 2)))
  const scored: { entry: Entry; score: number }[] = []
  for (const entry of index.entries) {
    let score = 0
    for (const w of words) {
      if (!entry.tokens.has(w)) continue
      const idf = index.idf.get(w) ?? 0
      score += entry.nameTokens.has(w) ? 2 * idf : idf
    }
    if (score >= min) scored.push({ entry, score })
  }
  scored.sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id))
  return scored.slice(0, max)
}

export const QUESTION =
  "The user just sent this request to a coding agent. Which skill's instructions does the agent " +
  "need loaded to handle it? Answer none unless one skill clearly applies."

// one /v1/decide body. The catalog (every skill, described once) is the same on every
// call, so the engine keeps it cached; the options are only the shortlisted names, so a
// decision re-reads just the prompt and a few words. Options keep shortlist order, "none" last.
export function decideRequest(prompt: string, picks: Entry[], index: Index) {
  return {
    kind: "choice",
    state: prompt.slice(0, STATE_CHARS),
    question: QUESTION,
    catalog: index.catalog,
    options: [...picks.map((e) => ({ key: e.id, description: e.id })), { key: "none", description: "none" }],
  }
}

// the accepted skill id, or undefined; `seen` is the per-session set of injected ids
export function accept(probabilities: Record<string, number>, seen: ReadonlySet<string>, threshold = ACCEPT): { id: string; p: number } | undefined {
  let best: { id: string; p: number } | undefined
  for (const [id, p] of Object.entries(probabilities)) if (!best || p > best.p) best = { id, p }
  if (!best || best.id === "none" || best.p < threshold || seen.has(best.id)) return undefined
  return best
}

// same shape opencode uses for a skill the user invokes directly
export function injection(s: Skill): string {
  if (s.content.length > INLINE_MAX)
    return `\n\n<skill_content name="${s.id}">\n# Skill: ${s.id}\n${s.description}\n\n` +
      `(${s.content.length} chars, too long to inline: call skill_load with name "${s.id}" for the full instructions.)\n</skill_content>`
  return `\n\n<skill_content name="${s.id}">\n${s.content.trim()}\n</skill_content>`
}

// --- permission.skill from opencode.jsonc ---------------------------------------------

// JSONC to JSON: comments outside strings and trailing commas removed
export function stripJsonc(src: string): string {
  let out = "", i = 0, str = false
  while (i < src.length) {
    const c = src[i]
    if (str) {
      out += c
      if (c === "\\") { out += src[i + 1] ?? ""; i += 2; continue }
      if (c === '"') str = false
      i++
    } else if (c === '"') { str = true; out += c; i++ }
    else if (src.startsWith("//", i)) { while (i < src.length && src[i] !== "\n") i++ }
    else if (src.startsWith("/*", i)) { const e = src.indexOf("*/", i + 2); i = e < 0 ? src.length : e + 2 }
    else { out += c; i++ }
  }
  return out.replace(/,(\s*[}\]])/g, "$1")
}

const glob = (pat: string) => new RegExp("^" + pat.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$")

// rules {pattern: allow|deny|ask}; the last matching pattern wins, as in opencode
export function allowed(id: string, rules: Record<string, string> | undefined): boolean {
  if (!rules) return true
  let effect = "allow"
  for (const [pat, e] of Object.entries(rules)) if (glob(pat).test(id)) effect = e
  return effect !== "deny"
}
