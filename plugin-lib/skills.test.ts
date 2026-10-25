// node --experimental-strip-types --test plugin-lib/skills.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { ACCEPT, INLINE_MAX, SHORTLIST_MAX, accept, allowed, buildIndex, decideRequest, injection, shortlist, stripJsonc, tokens, type Skill } from "./skills.ts"

const sk = (id: string, description: string, content = `# ${id}\nbody`): Skill => ({ id, name: id, description, content })
const SKILLS = [
  sk("forgejo-push", "Commit and push code to the lab Forgejo correctly from any machine"),
  sk("lab-deploy", "Deploy a stack or config change to a lab host from a committed ref"),
  sk("eqemu", "Work on the EverQuest emulator: quests, NPCs, spawns, loot, zones"),
  sk("unifi-api", "UniFi controller API on the UDM Pro: port forwards and network config"),
]
const index = buildIndex(SKILLS)

test("tokens: lower-case, stop words and short words dropped, suffixes trimmed", () => {
  assert.deepEqual(tokens("Pushing the Commits to Forgejo"), ["push", "commit", "forgejo"])
  assert.deepEqual(tokens("a an of 42"), [])
})

test("shortlist: the matching skill ranks first, unrelated prompts score nothing", () => {
  assert.equal(shortlist("commit and push this to forgejo", index)[0].entry.id, "forgejo-push")
  assert.equal(shortlist("write a quest for an NPC", index)[0].entry.id, "eqemu")
  assert.deepEqual(shortlist("rename cnt to count in main.py", index), [])
  assert.deepEqual(shortlist("hi", index), [])
})

test("shortlist: never more than SHORTLIST_MAX, so options + none fit decide's 16", () => {
  const many = buildIndex(Array.from({ length: 40 }, (_, i) => sk(`deploy-${i}`, "deploy the stack to the lab host")))
  assert.equal(shortlist("deploy the stack to the lab host", many).length, SHORTLIST_MAX)
  assert.ok(SHORTLIST_MAX + 1 <= 16)
})

test("catalog: independent of registry order, every skill described once", () => {
  assert.equal(buildIndex([...SKILLS].reverse()).catalog, index.catalog)
  for (const s of SKILLS) assert.equal(index.catalog.split(`- ${s.id}: `).length, 2)
})

test("decideRequest: static catalog, short options, none last, state capped", () => {
  const r = decideRequest("x".repeat(5000), [index.entries[0]], index)
  assert.equal(r.catalog, index.catalog)
  assert.deepEqual(r.options.map((o) => o.key), [index.entries[0].id, "none"])
  assert.ok(r.state.length <= 400)
})

test("accept: threshold, none, and once per session", () => {
  assert.deepEqual(accept({ eqemu: 0.9, none: 0.1 }, new Set()), { id: "eqemu", p: 0.9 })
  assert.equal(accept({ eqemu: ACCEPT - 0.01, none: 0.41 }, new Set()), undefined)
  assert.equal(accept({ eqemu: 0.1, none: 0.9 }, new Set()), undefined)
  assert.equal(accept({ eqemu: 0.9, none: 0.1 }, new Set(["eqemu"])), undefined)
})

test("injection: inline body, or a pointer to skill_load past INLINE_MAX", () => {
  assert.match(injection(SKILLS[0]), /<skill_content name="forgejo-push">\n# forgejo-push\nbody\n<\/skill_content>$/)
  const big = injection(sk("big", "huge", "y".repeat(INLINE_MAX + 1)))
  assert.match(big, /skill_load/)
  assert.ok(big.length < 500)
})

test("allowed: last matching pattern wins, as in opencode", () => {
  const rules = { "*": "allow", pdf: "deny", "chrome-*": "deny" }
  assert.equal(allowed("pdf", rules), false)
  assert.equal(allowed("chrome-browser", rules), false)
  assert.equal(allowed("eqemu", rules), true)
  assert.equal(allowed("eqemu", undefined), true)
  assert.equal(allowed("pdf", { pdf: "deny", "*": "allow" }), true)
})

test("stripJsonc: comments and trailing commas, strings untouched", () => {
  const src = '{\n  // c\n  "a": "http://x//y", /* b */\n  "b": [1, 2,],\n}'
  assert.deepEqual(JSON.parse(stripJsonc(src)), { a: "http://x//y", b: [1, 2] })
})
