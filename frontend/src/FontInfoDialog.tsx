import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api } from './api'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'

type Metric = { value: number; auto: boolean }
type Info = {
  fields: Record<string, string | number>
  os2_vendor: string; use_typo_metrics: boolean
  em: number; ascent: number; descent: number; xheight: number | null; capheight: number | null
  metrics: Record<string, Metric>
  names: Record<string, string>
}

const WEIGHTS: [number, string][] = [[100, 'Thin'], [200, 'ExtraLight'], [300, 'Light'], [400, 'Regular'], [500, 'Medium'],
  [600, 'SemiBold'], [700, 'Bold'], [800, 'ExtraBold'], [900, 'Black']]
const WIDTHS = ['UltraCondensed', 'ExtraCondensed', 'Condensed', 'SemiCondensed', 'Normal', 'SemiExpanded', 'Expanded', 'ExtraExpanded', 'UltraExpanded']
const EMBEDDING: [number, string][] = [[0, 'Installable (no restriction)'], [8, 'Editable'], [4, 'Preview & print'], [2, 'Restricted']]
// Style linking: the OS/2 fsSelection bits and head.macStyle that make an app's B / I buttons find this font
const LINKING: [string, number, number][] = [['Regular', 0x40, 0], ['Bold', 0x20, 1], ['Italic', 0x01, 2], ['Bold Italic', 0x21, 3]]

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[150px_1fr] items-start gap-3 py-1">
      <div className="pt-1.5">
        <Label>{label}</Label>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="flex min-w-0 items-center gap-2">{children}</div>
    </div>
  )
}

/** Names, metrics and licence of the open font, read from and written by FontForge. */
export function FontInfoDialog({ open, onOpenChange, onSaved, allowOverlap, onAllowOverlap }: {
  open: boolean; onOpenChange: (o: boolean) => void; onSaved: (familyname: string, fontname: string) => void
  allowOverlap: boolean; onAllowOverlap: (on: boolean) => void
}) {
  const [info, setInfo] = useState<Info | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (open) api<Info>('/api/font-info').then(setInfo).catch(e => toast.error('Could not read font info', { description: String(e) }))
    else setInfo(null)
  }, [open])

  if (!info) return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-2xl"><DialogTitle>Font info</DialogTitle><p className="text-sm text-muted-foreground">Loading…</p></DialogContent></Dialog>

  const f = (k: string) => String(info.fields[k] ?? '')
  const setF = (k: string, v: string | number) => setInfo({ ...info, fields: { ...info.fields, [k]: v } })
  const setName = (k: string, v: string) => setInfo({ ...info, names: { ...info.names, [k]: v } })
  const setM = (k: string, m: Partial<Metric>) => setInfo({ ...info, metrics: { ...info.metrics, [k]: { ...info.metrics[k], ...m } } })

  const metric = (k: string, label: string, canAuto = true) => {
    const m = info.metrics[k]
    return (
      <Field label={label}>
        <Input type="number" className="h-8 w-28 font-mono" value={m.auto ? '' : m.value} placeholder={m.auto ? 'auto' : ''}
          disabled={m.auto} onChange={e => setM(k, { value: +e.target.value })} />
        {canAuto && (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={m.auto}
              onChange={e => setM(k, { auto: e.target.checked, value: e.target.checked ? 0 : m.value })} />
            Auto (FontForge computes it on export)
          </label>
        )}
      </Field>
    )
  }

  const save = async () => {
    setSaving(true)
    try {
      const textAndNumbers = ['familyname', 'fontname', 'fullname', 'weight', 'version', 'copyright', 'italicangle', 'upos', 'uwidth', 'os2_weight', 'os2_width', 'os2_fstype', 'os2_stylemap', 'macstyle']
      const next = await api<Info>('/api/font-info', {
        fields: Object.fromEntries(textAndNumbers.map(k => [k, info.fields[k]])),
        os2_vendor: info.os2_vendor, use_typo_metrics: info.use_typo_metrics,
        ascent: info.ascent, descent: info.em - info.ascent,
        metrics: info.metrics, names: info.names,
      })
      setInfo(next)
      onSaved(String(next.fields.familyname), String(next.fields.fontname))
      toast.success('Font info updated', { description: 'Save the font to keep it.' })
      onOpenChange(false)
    } catch (e) {
      toast.error('Font info not changed', { description: (e as Error).message })
    } finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Font info</DialogTitle>
          <DialogDescription>Written into the font by FontForge; Save the font afterwards to keep it.</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="names">
          <TabsList>
            <TabsTrigger value="names">Names</TabsTrigger>
            <TabsTrigger value="metrics">Metrics</TabsTrigger>
            <TabsTrigger value="license">License</TabsTrigger>
            <TabsTrigger value="drawing">Drawing</TabsTrigger>
          </TabsList>

          <TabsContent value="names" className="pt-2">
            <Field label="Family"><Input value={f('familyname')} onChange={e => setF('familyname', e.target.value)} /></Field>
            <Field label="Style"><Input value={f('weight')} onChange={e => setF('weight', e.target.value)} placeholder="Regular" /></Field>
            <Field label="Full name"><Input value={f('fullname')} onChange={e => setF('fullname', e.target.value)} /></Field>
            <Field label="PostScript name" hint="No spaces, max 63">
              <Input className="font-mono" value={f('fontname')} onChange={e => setF('fontname', e.target.value)} />
              <Button size="xs" variant="ghost" title="Family-Style without spaces"
                onClick={() => setF('fontname', `${f('familyname')}-${f('weight') || 'Regular'}`.replace(/\s+/g, ''))}>From names</Button>
            </Field>
            <Field label="Version"><Input className="font-mono" value={f('version')} onChange={e => setF('version', e.target.value)} placeholder="1.000" /></Field>
            <Field label="Weight class">
              <Select value={f('os2_weight')} onChange={e => setF('os2_weight', +e.target.value)}>
                {WEIGHTS.map(([v, l]) => <option key={v} value={v}>{v} {l}</option>)}
                {!WEIGHTS.some(([v]) => v === +f('os2_weight')) && <option value={f('os2_weight')}>{f('os2_weight')}</option>}
              </Select>
            </Field>
            <Field label="Width class">
              <Select value={f('os2_width')} onChange={e => setF('os2_width', +e.target.value)}>
                {WIDTHS.map((l, i) => <option key={l} value={i + 1}>{i + 1} {l}</option>)}
              </Select>
            </Field>
            <Field label="Italic angle"><Input type="number" className="w-28 font-mono" value={f('italicangle')} onChange={e => setF('italicangle', +e.target.value)} /></Field>
            <Field label="Vendor ID" hint="4 letters, registered with Microsoft">
              <Input className="w-28 font-mono" maxLength={4} value={info.os2_vendor} onChange={e => setInfo({ ...info, os2_vendor: e.target.value })} />
            </Field>
            <div className="mt-2 border-t pt-2 text-xs font-medium text-muted-foreground">Style linking</div>
            <Field label="Style group" hint="What the B and I buttons of an app pair this font with">
              <div className="flex gap-1">
                {LINKING.map(([label, map, mac]) => (
                  <Button key={label} size="xs" variant={(+f('os2_stylemap') & 0x61) === map ? 'secondary' : 'ghost'}
                    onClick={() => setInfo({ ...info, fields: { ...info.fields, os2_stylemap: map, macstyle: mac } })}>{label}</Button>
                ))}
              </div>
            </Field>
            <Field label="Name ID 1 (family)" hint="Menu family; only Regular, Bold, Italic and Bold Italic share it">
              <Input value={info.names['Family']} onChange={e => setName('Family', e.target.value)} />
            </Field>
            <Field label="Name ID 2 (style)"><Input value={info.names['SubFamily']} onChange={e => setName('SubFamily', e.target.value)} placeholder="Regular" /></Field>
            <Field label="Name ID 16" hint="Typographic family"><Input value={info.names['Preferred Family']} onChange={e => setName('Preferred Family', e.target.value)} /></Field>
            <Field label="Name ID 17" hint="Typographic style"><Input value={info.names['Preferred Styles']} onChange={e => setName('Preferred Styles', e.target.value)} /></Field>
            <div className="mt-2 border-t" />
            {['Designer', 'Designer URL', 'Manufacturer', 'Vendor URL', 'Trademark'].map(n => (
              <Field key={n} label={n}><Input value={info.names[n]} onChange={e => setName(n, e.target.value)} /></Field>
            ))}
            <Field label="Description"><Textarea rows={2} value={info.names['Descriptor']} onChange={e => setName('Descriptor', e.target.value)} /></Field>
            <Field label="Sample text"><Input value={info.names['Sample Text']} onChange={e => setName('Sample Text', e.target.value)} /></Field>
          </TabsContent>

          <TabsContent value="metrics" className="pt-2">
            <Field label="Units per em"><span className="font-mono text-sm">{info.em}</span><span className="text-xs text-muted-foreground">fixed here: changing it means scaling every glyph</span></Field>
            <Field label="Ascent / descent" hint="Always add up to the units per em">
              <Input type="number" className="h-8 w-28 font-mono" value={info.ascent}
                onChange={e => setInfo({ ...info, ascent: Math.max(0, Math.min(info.em, +e.target.value)) })} />
              <span className="font-mono text-sm text-muted-foreground">/ {info.em - info.ascent}</span>
            </Field>
            <Field label="x-height / cap height" hint="Measured from x and H">
              <span className="font-mono text-sm">{info.xheight === null ? '—' : Math.round(info.xheight)} / {info.capheight === null ? '—' : Math.round(info.capheight)}</span>
            </Field>
            <Field label="Underline" hint="Position, thickness">
              <Input type="number" className="h-8 w-24 font-mono" value={f('upos')} onChange={e => setF('upos', +e.target.value)} />
              <Input type="number" className="h-8 w-24 font-mono" value={f('uwidth')} onChange={e => setF('uwidth', +e.target.value)} />
            </Field>
            <h4 className="mt-3 mb-1 text-xs font-medium text-muted-foreground">Line spacing</h4>
            <Field label="Use typo metrics" hint="Recommended: apps then use the three values below">
              <input type="checkbox" checked={info.use_typo_metrics}
                onChange={e => setInfo({ ...info, use_typo_metrics: e.target.checked })} />
            </Field>
            {metric('os2_typoascent', 'Typo ascender')}
            {metric('os2_typodescent', 'Typo descender')}
            {metric('os2_typolinegap', 'Typo line gap', false)}
            {metric('os2_winascent', 'Win ascent')}
            {metric('os2_windescent', 'Win descent')}
            {metric('hhea_ascent', 'hhea ascender')}
            {metric('hhea_descent', 'hhea descender')}
            {metric('hhea_linegap', 'hhea line gap', false)}
          </TabsContent>

          <TabsContent value="license" className="pt-2">
            <Field label="Copyright"><Textarea rows={2} value={f('copyright')} onChange={e => setF('copyright', e.target.value)} /></Field>
            <Field label="License"><Textarea rows={5} value={info.names['License']} onChange={e => setName('License', e.target.value)} /></Field>
            <Field label="License URL">
              <Input value={info.names['License URL']} onChange={e => setName('License URL', e.target.value)} />
              <Button size="xs" variant="ghost" title="SIL Open Font License 1.1"
                onClick={() => setInfo({ ...info, names: { ...info.names, 'License URL': 'https://openfontlicense.org', License: info.names['License'] || 'This Font Software is licensed under the SIL Open Font License, Version 1.1.' } })}>OFL</Button>
            </Field>
            <Field label="Embedding" hint="What apps may do with the font in documents">
              <Select value={f('os2_fstype')} onChange={e => setF('os2_fstype', +e.target.value)}>
                {EMBEDDING.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                {!EMBEDDING.some(([v]) => v === +f('os2_fstype')) && <option value={f('os2_fstype')}>Other ({f('os2_fstype')})</option>}
              </Select>
            </Field>
          </TabsContent>
          <TabsContent value="drawing" className="pt-2">
            <Field label="Allow overlap" hint="Applies at once; not part of Save">
              <Switch checked={allowOverlap} onCheckedChange={onAllowOverlap} label="Allow overlap" />
              <span className="text-xs text-muted-foreground">{allowOverlap ? 'On: shapes stack' : 'Off: direction decides'}</span>
            </Field>
            <p className="mt-2 text-xs text-muted-foreground">
              On, shapes that cross sit on top of each other and merge, even when drawn the other way round. A shape wholly inside another is
              still a hole, and the Shape Builder (Alt-drag a region) cuts one out. Leave it off for a font that relies on opposite-direction
              shapes cutting each other out: when on, every edit turns shapes round so they merge. It applies to edits you make from now on.
              The choice is kept for this project (all of a family's masters) on this computer, not written into the font file.
            </p>
          </TabsContent>
        </Tabs>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
