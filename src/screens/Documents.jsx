import React, { useCallback, useEffect, useId, useState } from 'react'
import { Ic, Confirm } from '../ui.jsx'
import { api } from '../api.js'

export const DOC_CATS = [['vet', 'Vet records'], ['vaccination', 'Vaccination certificates'], ['registration', 'Registration and pedigree'], ['licence', 'Licence and microchip'], ['insurance', 'Insurance'], ['show', 'Show entries and certificates'], ['other', 'Other']]
const TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
const MAX = 5 * 1024 * 1024
const size = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB')
const date = (v) => new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const readFile = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('That file could not be read.')); r.readAsDataURL(file) })

function Group({ docs, render }) {
  return DOC_CATS.filter(([k]) => docs.some((d) => d.category === k)).map(([k, l]) => <section key={k} className="card padc" aria-label={l}><div className="eyebrow dark">{l.toUpperCase()}</div>{docs.filter((d) => d.category === k).map(render)}</section>)
}

export function DemoDocuments({ dd }) {
  return <div className="list">
    <p className="meta padx">Sample documents for {dd.dog.name}. They show what the list looks like and do not open.</p>
    <Group docs={dd.docs} render={(d) => <div key={d.id} className="hentry"><div className="row between g8"><span className="hb row g8"><Ic n="file" s={18} c="#1F5AE8" />{d.name}</span><span className="tagx">Sample</span></div><div className="meta">{size(d.size)} · {date(Date.now() - d.daysAgo * 864e5)}</div></div>} />
  </div>
}

export function RealDocuments({ real, setToast }) {
  const { dog } = real
  const owner = dog.role === 'owner'
  const id = useId()
  const [data, setData] = useState(null), [err, setErr] = useState('')
  const [f, setF] = useState({ name: '', category: 'vet', notes: '' }), [file, setFile] = useState(null), [ferr, setFerr] = useState(''), [pct, setPct] = useState(null), [key, setKey] = useState(0)
  const [edit, setEdit] = useState(null), [ask, setAsk] = useState(null)
  const load = useCallback(async () => { try { setData(await api.documents.list(dog.slug)); setErr('') } catch (e) { setErr(e.message) } }, [dog.slug])
  useEffect(() => { setData(null); load() }, [load])
  const pick = (e) => {
    const x = e.target.files && e.target.files[0]
    setFerr(''); setFile(null)
    if (!x) return
    if (!TYPES.includes(x.type)) { setFerr('Only PDF, JPEG, PNG and WebP files can be stored.'); return }
    if (x.size > MAX) { setFerr(`That file is ${size(x.size)}. The limit is 5 MB.`); return }
    setFile(x); if (!f.name.trim()) setF((v) => ({ ...v, name: x.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 120) }))
  }
  const upload = async (e) => {
    e.preventDefault()
    if (pct !== null) return
    if (!file) { setFerr('Choose a file first.'); return }
    if (!f.name.trim()) { setFerr('Give the document a name.'); return }
    setPct(0); setFerr('')
    try {
      await api.documents.upload(dog.slug, { name: f.name.trim(), category: f.category, notes: f.notes.trim(), file: await readFile(file) }, setPct)
      setF({ name: '', category: f.category, notes: '' }); setFile(null); setKey((k) => k + 1); await load(); setToast('Document stored')
    } catch (x) { setFerr(x.message) }
    setPct(null)
  }
  const open = async (d) => { try { await api.documents.view(d.id) } catch (x) { setToast(x.message) } }
  const save = async (e) => { e.preventDefault(); if (!edit.name.trim()) { setEdit({ ...edit, error: 'Give the document a name.' }); return } try { await api.documents.update(edit.id, { name: edit.name.trim(), category: edit.category }); setEdit(null); await load(); setToast('Document updated') } catch (x) { setEdit({ ...edit, error: x.message }) } }
  const vet = async (d, on) => { try { await api.documents.update(d.id, { inVetSummary: on }); await load(); setToast(on ? 'Listed on the vet summary' : 'Taken off the vet summary') } catch (x) { setToast(x.message) } }
  const del = async (d) => { setAsk({ id: d.id, busy: true }); try { await api.documents.remove(d.id); setAsk(null); await load(); setToast('Document deleted') } catch (x) { setAsk({ id: d.id, busy: false, error: x.message }) } }
  return <div className="list">
    <form className="card padc wform" onSubmit={upload} noValidate aria-label="Add a document">
      <b>Add a document</b>
      <p className="meta">Vet records, vaccination certificates, registration and pedigree papers, licence and microchip paperwork, insurance and show certificates. PDF, JPEG, PNG or WebP, up to 5 MB each. Only {dog.name}'s care team can see them.</p>
      <div className="field lightf"><label htmlFor={`${id}-file`}>File</label><input key={key} id={`${id}-file`} className="fileinput" type="file" accept=".pdf,image/jpeg,image/png,image/webp,application/pdf" onChange={pick} disabled={pct !== null} aria-describedby={ferr ? `${id}-err` : undefined} /></div>
      <div className="field lightf"><label htmlFor={`${id}-name`}>Name</label><input id={`${id}-name`} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={120} autoComplete="off" /></div>
      <div className="field lightf"><label htmlFor={`${id}-cat`}>Kind</label><select id={`${id}-cat`} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{DOC_CATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
      <div className="field lightf"><label htmlFor={`${id}-notes`}>Notes (optional)</label><input id={`${id}-notes`} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} maxLength={500} autoComplete="off" /></div>
      {pct !== null && <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Upload progress"><i style={{ width: pct + '%' }} /></div>}
      {ferr && <p className="formerr" id={`${id}-err`} role="alert">{ferr}</p>}
      <button className="cta small" type="submit" disabled={pct !== null}>{pct !== null ? `Uploading ${pct}%` : 'Upload'}</button>
    </form>
    {err && <p className="formerr" role="alert">{err}</p>}
    {data && data.documents.length === 0 && <div className="card empty"><b>No documents yet</b><p>Add {dog.name}'s first one above.</p></div>}
    {data && <Group docs={data.documents} render={(d) => <div key={d.id} className="hentry">
      {edit && edit.id === d.id
        ? <form className="wform hform" onSubmit={save} noValidate><div className="field lightf"><label htmlFor={`${id}-r`}>Name</label><input id={`${id}-r`} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value, error: '' })} maxLength={120} autoFocus /></div>
          <div className="field lightf"><label htmlFor={`${id}-rc`}>Kind</label><select id={`${id}-rc`} value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })}>{DOC_CATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          {edit.error && <p className="formerr" role="alert">{edit.error}</p>}<div className="row g8"><button className="cta small" type="submit">Save</button><button className="cta small white bordered" type="button" onClick={() => setEdit(null)}>Cancel</button></div></form>
        : <>
          <button className="rrow" onClick={() => open(d)} aria-label={`Open ${d.name}`}><span className="ricon"><Ic n="file" s={20} c="#1F5AE8" /></span><span className="grow"><b>{d.name}</b><small>{d.contentType === 'application/pdf' ? 'PDF' : 'Image'} · {size(d.size)} · {date(d.createdAt)} · added by {d.uploadedBy}</small></span></button>
          {d.notes && <p className="note">{d.notes}</p>}
          {owner && <label className="switch slim"><input type="checkbox" checked={d.inVetSummary} onChange={(e) => vet(d, e.target.checked)} /><span className="grow"><b>Include in vet summary</b><small>Lists it on any vet link you create, for as long as that link works.</small></span></label>}
          {d.canEdit && (ask && ask.id === d.id ? <Confirm text={`Delete "${d.name}"? This cannot be undone.`} yes="Delete" no="Keep it" busy={ask.busy} error={ask.error} onYes={() => del(d)} onNo={() => setAsk(null)} />
            : <div className="row g8"><button className="tbtn" aria-label={`Rename ${d.name}`} onClick={() => setEdit({ id: d.id, name: d.name, category: d.category })}>Rename</button><button className="tbtn" aria-label={`Delete ${d.name}`} onClick={() => setAsk({ id: d.id })}>Delete</button></div>)}
        </>}
    </div>} />}
    {data && <p className="meta padx">{size(data.usedBytes)} of {size(data.maxBytes)} used. Documents are never public.</p>}
  </div>
}
