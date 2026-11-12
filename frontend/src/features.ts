// Feature-code generators from glyph naming conventions (AGL / Adobe style):
// f_f_i is a ligature of f f i, a.sc is a small capital, a.ss01 is in set 1,
// one.onum is the old-style figure, and so on.

export type Generator = 'liga' | 'smcp' | 'c2sc' | 'ss' | 'alt' | 'aalt' | 'all'

/** Glyph-name suffix -> the feature that swaps the base glyph for it (a.salt, one.onum ...). */
export const SUFFIX_FEATURES = ['onum', 'lnum', 'tnum', 'pnum', 'case', 'zero', 'sups', 'sinf', 'subs', 'swsh', 'salt', 'hist', 'titl']
/** Features whose alternates the aalt feature collects. */
const AALT_TAGS = ['smcp', 'c2sc', 'salt', 'swsh', 'hist', 'onum', 'lnum', 'tnum', 'pnum', 'zero', 'sups', 'sinf', 'subs', 'titl', 'case']

const mentioned = (code: string, name: string) =>
  new RegExp(`(^|[\\s\\[\\\\])${name.replace(/[.]/g, '\\.')}(?=[\\s\\];])`, 'm').test(code)

/** The text of every `feature tag { ... } tag;` block in the code. */
const blockOf = (code: string, tag: string) =>
  [...code.matchAll(new RegExp(`feature\\s+${tag}\\s*\\{([\\s\\S]*?)\\}\\s*${tag}\\s*;`, 'g'))].map(m => m[1]).join('\n')

const feature = (tag: string, rules: string[]) => (rules.length ? [`feature ${tag} {\n${rules.join('\n')}\n} ${tag};`] : [])
const isSet = (t: string) => /^ss\d\d$/.test(t)

/** Feature blocks for glyphs that feature's code doesn't use yet. */
function blocksFor(kind: Exclude<Generator, 'all'>, names: string[], code: string): string[] {
  const have = new Set(names)
  const fresh = (tag: string) => { const used = blockOf(code, tag); return names.filter(n => !mentioned(used, n)) }
  const swaps = (tag: string, suffix: string) => fresh(tag)
    .filter(n => n.endsWith('.' + suffix) && have.has(n.slice(0, -suffix.length - 1)))
    .map(n => `  sub ${n.slice(0, -suffix.length - 1)} by ${n};`)

  if (kind === 'liga') {
    const rules = fresh('liga')
      .filter(n => n.includes('_') && !n.includes('.'))
      .map(n => [n, n.split('_')] as const)
      .filter(([, parts]) => parts.length > 1 && parts.every(p => have.has(p)))
      // longest first: f_f_i must be tried before f_f
      .sort((a, b) => b[1].length - a[1].length)
      .map(([n, parts]) => `  sub ${parts.join(' ')} by ${n};`)
    return feature('liga', rules)
  }
  if (kind === 'smcp') return feature('smcp', swaps('smcp', 'sc'))
  if (kind === 'c2sc') {
    // capitals to small caps: A -> a.sc
    const rules = fresh('c2sc').filter(n => n.endsWith('.sc')).flatMap(n => {
      const base = n.slice(0, -3), cap = base.toUpperCase()
      return cap !== base && have.has(cap) ? [`  sub ${cap} by ${n};`] : []
    })
    return feature('c2sc', rules)
  }
  if (kind === 'ss') {
    const sets = new Map<string, string[]>()
    for (const n of names) {
      const m = /^(.+)\.(ss(0[1-9]|1\d|20))$/.exec(n)
      if (m && have.has(m[1]) && !mentioned(blockOf(code, m[2]), n)) sets.set(m[2], [...(sets.get(m[2]) ?? []), `  sub ${m[1]} by ${n};`])
    }
    return [...sets.keys()].sort().flatMap(tag => feature(tag, sets.get(tag)!))
  }
  if (kind === 'alt') return SUFFIX_FEATURES.flatMap(tag => feature(tag, swaps(tag, tag)))
  // aalt: one place that lists every alternate feature the code defines
  if (/feature\s+aalt\s*\{/.test(code)) return []
  const defined = featureTags(code)
  const listed = [...AALT_TAGS.filter(t => defined.includes(t)), ...defined.filter(isSet)]
  return feature('aalt', listed.map(t => `  feature ${t};`))
}

/** Feature code for glyphs the code doesn't use yet; '' when there is nothing to add. */
export function generate(kind: Generator, names: string[], code: string): string {
  const blocks: string[] = []
  let seen = code
  for (const k of kind === 'all' ? (['liga', 'smcp', 'c2sc', 'ss', 'alt', 'aalt'] as const) : [kind]) {
    const b = blocksFor(k, names, seen)
    blocks.push(...b)
    seen += '\n\n' + b.join('\n\n')  // later generators (aalt) see what the earlier ones added
  }
  if (!blocks.length) return ''
  const header = /^\s*languagesystem\b/m.test(code) ? '' : 'languagesystem DFLT dflt;\nlanguagesystem latn dflt;\n\n'
  return header + blocks.join('\n\n')
}

/** Feature tags the code defines, plus GPOS ones, in a stable order. */
export const featureTags = (code: string, extra: string[] = []) =>
  [...new Set([...[...code.matchAll(/^\s*feature\s+(\w{4})\s*\{/gm)].map(m => m[1]), ...extra])].sort()

/** Features HarfBuzz applies to Latin text unless told otherwise. */
export const ON_BY_DEFAULT = new Set(['ccmp', 'locl', 'rlig', 'liga', 'clig', 'calt', 'kern', 'mark', 'mkmk', 'rvrn'])

/** A script and language a feature is registered under: `arab{dflt}`, `latn{TRK}`. */
export type LangSys = { script: string; lang: string }
const LANGSYS = /^[ \t]*languagesystem[ \t]+(\w{3,4})[ \t]+(\w{3,4})[ \t]*;[ \t]*$/gm

export const languageSystems = (code: string): LangSys[] =>
  [...code.matchAll(LANGSYS)].map(m => ({ script: m[1], lang: m[2] }))

const same = (a: LangSys, b: LangSys) => a.script === b.script && a.lang.toLowerCase() === b.lang.toLowerCase()

/** The code with one more `languagesystem` line, after the last one (DFLT dflt first, as the spec wants). */
export function addLanguageSystem(code: string, sys: LangSys): string {
  const have = languageSystems(code)
  if (have.some(h => same(h, sys))) return code
  const line = `languagesystem ${sys.script} ${sys.lang};`
  if (!have.length) {
    const first = sys.script === 'DFLT' && sys.lang === 'dflt' ? '' : 'languagesystem DFLT dflt;\n'
    return `${first}${line}\n\n${code.replace(/^\s+/, '')}`
  }
  const last = [...code.matchAll(LANGSYS)].at(-1)!
  const at = last.index! + last[0].length
  return code.slice(0, at) + '\n' + line + code.slice(at)
}

export function removeLanguageSystem(code: string, sys: LangSys): string {
  return code
    .split('\n')
    .filter(l => {
      const m = /^[ \t]*languagesystem[ \t]+(\w+)[ \t]+(\w+)[ \t]*;/.exec(l)
      return !(m && same({ script: m[1], lang: m[2] }, sys))
    })
    .join('\n')
}
