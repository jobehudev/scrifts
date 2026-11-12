/** OpenType scripts and languages, for the language systems a feature is registered under (`arab{dflt}`, `latn{TRK}`). */
export type Script = {
  tag: string          // OpenType script tag, as in `languagesystem arab dflt;`
  iso: string          // ISO 15924, what the shaping engine wants to know
  name: string
  sample: string       // text to try the script with: a pangram or the letters in order
  rtl?: boolean
}

export const SCRIPTS: Script[] = [
  { tag: 'DFLT', iso: 'Zyyy', name: 'Default (any script)', sample: '' },
  { tag: 'latn', iso: 'Latn', name: 'Latin', sample: 'The quick brown fox jumps over the lazy dog' },
  { tag: 'cyrl', iso: 'Cyrl', name: 'Cyrillic', sample: 'Съешь же ещё этих мягких французских булок, да выпей чаю' },
  { tag: 'grek', iso: 'Grek', name: 'Greek', sample: 'Ξεσκεπάζω την ψυχοφθόρα βδελυγμία' },
  { tag: 'arab', iso: 'Arab', name: 'Arabic', sample: 'نص حكيم له سر قاطع وذو شأن عظيم', rtl: true },
  { tag: 'hebr', iso: 'Hebr', name: 'Hebrew', sample: 'דג סקרן שט בים מאוכזב ולפתע מצא חברה', rtl: true },
  { tag: 'armn', iso: 'Armn', name: 'Armenian', sample: 'Ա Բ Գ Դ Ե Զ Է Ը Թ Ժ Ի Լ Խ Ծ Կ Հ' },
  { tag: 'geor', iso: 'Geor', name: 'Georgian', sample: 'ა ბ გ დ ე ვ ზ თ ი კ ლ მ ნ ო პ' },
  { tag: 'hani', iso: 'Hani', name: 'Han (Chinese, Kanji)', sample: '天地玄黃 宇宙洪荒 日月盈昃 辰宿列張' },
  { tag: 'kana', iso: 'Kana', name: 'Kana (Japanese)', sample: 'いろはにほへと ちりぬるを イロハニホヘト' },
  { tag: 'hang', iso: 'Hang', name: 'Hangul (Korean)', sample: '가나다라마바사아자차카타파하' },
  { tag: 'dev2', iso: 'Deva', name: 'Devanagari (new shaping, dev2)', sample: 'अ आ इ ई उ ऊ ए ऐ ओ औ क ख ग घ' },
  { tag: 'deva', iso: 'Deva', name: 'Devanagari (old shaping, deva)', sample: 'अ आ इ ई उ ऊ ए ऐ ओ औ क ख ग घ' },
  { tag: 'bng2', iso: 'Beng', name: 'Bengali', sample: 'অ আ ই ঈ উ ঊ ঋ এ ঐ ও ঔ ক খ গ ঘ' },
  { tag: 'taml', iso: 'Taml', name: 'Tamil', sample: 'அ ஆ இ ஈ உ ஊ எ ஏ ஐ ஒ ஓ ஔ க ங ச' },
  { tag: 'thai', iso: 'Thai', name: 'Thai', sample: 'ก ข ฃ ค ฅ ฆ ง จ ฉ ช ซ ฌ ญ ฎ ฏ' },
  { tag: 'khmr', iso: 'Khmr', name: 'Khmer', sample: 'ក ខ គ ឃ ង ច ឆ ជ ឈ ញ ដ ឋ ឌ ឍ ណ' },
  { tag: 'tibt', iso: 'Tibt', name: 'Tibetan', sample: 'ཀ ཁ ག ང ཅ ཆ ཇ ཉ ཏ ཐ ད ན པ ཕ བ མ' },
]

/** A few of the language tags people actually reach for; any 3 or 4 letter tag can be typed in too. */
export const LANGUAGES: [string, string][] = [
  ['dflt', 'Default (every language of the script)'],
  ['TRK', 'Turkish'], ['ROM', 'Romanian'], ['CAT', 'Catalan'], ['NLD', 'Dutch'], ['DEU', 'German'], ['FRA', 'French'],
  ['PLK', 'Polish'], ['SRB', 'Serbian'], ['BGR', 'Bulgarian'], ['MKD', 'Macedonian'], ['URD', 'Urdu'], ['FAR', 'Persian'],
  ['ARA', 'Arabic'], ['HIN', 'Hindi'], ['JAN', 'Japanese'], ['KOR', 'Korean'], ['ZHS', 'Chinese, simplified'], ['ZHT', 'Chinese, traditional'],
]

export const scriptOf = (tag: string) => SCRIPTS.find(s => s.tag.toLowerCase() === tag.toLowerCase())
export const scriptName = (tag: string) => scriptOf(tag)?.name ?? tag
