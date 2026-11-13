import { useEffect, useState } from 'react'
import { api } from './api'

const GithubMark = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
    <path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.2.5-2.3 1.3-3.1-.2-.4-.6-1.6 0-3.2 0 0 1-.3 3.4 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.6.2 2.8.1 3.2.8.8 1.3 1.9 1.3 3.1 0 4.6-2.8 5.6-5.5 5.9.5.4.9 1.1.9 2.3v3.3c0 .3.1.7.8.6A12 12 0 0 0 12 .3" />
  </svg>
)

const open = (url: string) => void api('/api/open-url', { url }).catch(() => window.open(url, '_blank'))

/** The one About: the Help menu's dialog and Settings' About page both show this, so they cannot drift apart. */
export function AboutContent() {
  const [ffVersion, setFfVersion] = useState<string | null>(null)
  useEffect(() => { api<{ fontforge: string }>('/api/ping').then(r => setFfVersion(r.fontforge)).catch(() => {}) }, [])
  const chip = (repo: string, label: string) => (
    <button key={repo} type="button" title={`github.com/${repo}`} onClick={() => open(`https://github.com/${repo}`)}
      className="inline-flex items-center gap-1.5 rounded-full bg-foreground py-1 pr-3 pl-1.5 text-xs font-medium text-background hover:opacity-85">
      <GithubMark className="size-4" />{label}
    </button>
  )
  return (
    <div className="space-y-3 text-sm">
      {/* the wordmark as a mask, so it takes the text colour of every theme */}
      <div role="img" aria-label="Scrifts" className="h-9 w-full max-w-72 bg-foreground"
        style={{ WebkitMask: 'url(/wordmark.svg) left center / contain no-repeat', mask: 'url(/wordmark.svg) left center / contain no-repeat' }} />
      <p className="text-muted-foreground">Open source font editor, made by jobehudev.</p>
      <div className="flex flex-wrap gap-2">{chip('jobehudev/scrifts', '/scrifts')}</div>
      <p>Scrifts is built on <b>FontForge</b>{ffVersion ? ` (build ${ffVersion})` : ''}: all reading, writing and outline work is done by its engine. Variable fonts are made with <b>fontTools</b>; Glyphs files are read with glyphsLib.</p>
      <div className="flex flex-wrap gap-2">
        {['fontforge/fontforge', 'fonttools/fonttools', 'googlefonts/glyphsLib'].map(repo => chip(repo, '/' + repo.split('/')[1].toLowerCase()))}
      </div>
      <p>Free software under the GNU General Public License, version 3 or later: you may use, study, change and share it, and your version stays under the same licence with its source. The Windows installer carries FontForge's own build, unchanged.</p>
      <p className="text-muted-foreground">Thanks to the authors of FontForge, fontTools and glyphsLib. Full credits in CREDITS.md.</p>
    </div>
  )
}
