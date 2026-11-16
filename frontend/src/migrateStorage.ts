// Settings saved before the rename live under "forge.*": move them to "scrifts.*" once, before anything reads them.
for (const k of Object.keys(localStorage)) {
  if (!k.startsWith('forge.')) continue
  const to = 'scrifts.' + k.slice(6)
  if (localStorage.getItem(to) === null) localStorage.setItem(to, localStorage.getItem(k)!)
  localStorage.removeItem(k)
}
