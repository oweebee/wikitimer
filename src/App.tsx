import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'

type Timer = { id: string; title: string; endsAt: number; auctionUrl: string }
type ArchivedTimer = Timer & { archivedAt: number }
type SoundId = 'bell' | 'chime' | 'alarm'
type SortOrder = 'closest' | 'furthest'

const TIMER_STORAGE_KEY = 'wikitimer.timers.v1'
const ARCHIVE_STORAGE_KEY = 'wikitimer.archive.v1'
const SETTINGS_STORAGE_KEY = 'wikitimer.settings.v1'

function readList<T>(key: string): T[] {
  try { const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]'); return Array.isArray(value) ? value as T[] : [] } catch { return [] }
}

function readSound(): SoundId {
  try { const sound = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '{}')?.sound; return sound === 'chime' || sound === 'alarm' ? sound : 'bell' } catch { return 'bell' }
}

function readSortOrder(): SortOrder {
  try { return JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '{}')?.sortOrder === 'furthest' ? 'furthest' : 'closest' } catch { return 'closest' }
}

function formatRemaining(milliseconds: number) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000)); const days = Math.floor(seconds / 86400)
  const clock = [Math.floor((seconds % 86400) / 3600), Math.floor((seconds % 3600) / 60), seconds % 60].map((value) => String(value).padStart(2, '0')).join(':')
  return days ? `${days} j ${clock}` : clock
}

function formatDate(value: number) { return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(value) }

function normaliseUrl(value: string) {
  if (!value.trim()) return ''
  const candidate = /^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`
  try { const url = new URL(candidate); return ['http:', 'https:'].includes(url.protocol) ? url.href : '' } catch { return '' }
}

function startAlertLoop(sound: SoundId) {
  const context = new AudioContext()
  const patterns: Record<SoundId, number[]> = { bell: [880, 1320], chime: [660, 880, 1320], alarm: [520, 520, 740, 520] }
  const pattern = patterns[sound]
  const playPattern = () => pattern.forEach((frequency, index) => {
    const oscillator = context.createOscillator(); const gain = context.createGain(); const at = context.currentTime + index * 0.16
    oscillator.type = sound === 'alarm' ? 'square' : 'sine'; oscillator.frequency.value = frequency
    gain.gain.setValueAtTime(0.0001, at); gain.gain.exponentialRampToValueAtTime(0.16, at + 0.02); gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.25)
    oscillator.connect(gain).connect(context.destination); oscillator.start(at); oscillator.stop(at + 0.27)
  })
  playPattern()
  const loop = window.setInterval(playPattern, Math.max(1_100, pattern.length * 160 + 450))
  return () => { window.clearInterval(loop); void context.close() }
}

function App() {
  const [timers, setTimers] = useState<Timer[]>(() => readList<Timer>(TIMER_STORAGE_KEY))
  const [archive, setArchive] = useState<ArchivedTimer[]>(() => readList<ArchivedTimer>(ARCHIVE_STORAGE_KEY))
  const [now, setNow] = useState(0)
  const [title, setTitle] = useState(''); const [duration, setDuration] = useState('30'); const [auctionUrl, setAuctionUrl] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false); const [pickerHours, setPickerHours] = useState(0); const [pickerMinutes, setPickerMinutes] = useState(30)
  const [sound, setSound] = useState<SoundId>(readSound); const [formError, setFormError] = useState(''); const [finishedTimer, setFinishedTimer] = useState<Timer | null>(null)
  const [showArchive, setShowArchive] = useState(false)
  const [sortOrder, setSortOrder] = useState<SortOrder>(readSortOrder)
  const [composerOpen, setComposerOpen] = useState(false)
  const [archiveSelectionMode, setArchiveSelectionMode] = useState(false)
  const [selectedArchiveIds, setSelectedArchiveIds] = useState<string[]>([])
  const alertTimerId = useRef<string | null>(null); const stopAlertRef = useRef<() => void>(() => {})

  useEffect(() => { setNow(Date.now()); const interval = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(interval) }, [])
  useEffect(() => () => stopAlertRef.current(), [])
  useEffect(() => { localStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify(timers)) }, [timers])
  useEffect(() => { localStorage.setItem(ARCHIVE_STORAGE_KEY, JSON.stringify(archive)) }, [archive])
  useEffect(() => { localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ sound, sortOrder })) }, [sound, sortOrder])

  function archiveTimer(timer: Timer) {
    const anotherExpiredTimerRemains = timers.some((item) => item.id !== timer.id && item.endsAt <= Date.now())
    if (!anotherExpiredTimerRemains) { stopAlertRef.current(); stopAlertRef.current = () => {}; alertTimerId.current = null }
    setFinishedTimer((current) => current?.id === timer.id ? null : current)
    setTimers((current) => current.filter((item) => item.id !== timer.id))
    setArchive((current) => current.some((item) => item.id === timer.id) ? current : [{ ...timer, archivedAt: Date.now() }, ...current])
  }

  useEffect(() => {
    const elapsed = timers.find((timer) => timer.endsAt <= now)
    if (!elapsed) return
    if (alertTimerId.current) return
    alertTimerId.current = 'active'; stopAlertRef.current = startAlertLoop(sound); setFinishedTimer(elapsed)
    if ('Notification' in window && Notification.permission === 'granted') {
      const notification = new Notification('WikiTimers — échéance terminée', {
        body: `« ${elapsed.title} » est terminée.`,
        icon: new URL('/wikitimer-icon.png', window.location.origin).href,
        badge: new URL('/wikitimer-icon.png', window.location.origin).href,
      })
      notification.addEventListener('click', () => { notification.close(); window.focus(); archiveTimer(elapsed) })
    }
  }, [now, sound, timers])

  const orderedTimers = useMemo(() => [...timers].sort((a, b) => sortOrder === 'closest' ? a.endsAt - b.endsAt : b.endsAt - a.endsAt), [timers, sortOrder])
  const orderedArchive = useMemo(() => [...archive].sort((a, b) => b.archivedAt - a.archivedAt), [archive])

  function requestNotifications() {
    if (!('Notification' in window)) { setFormError('Les notifications ne sont pas prises en charge par ce navigateur.'); return }
    void Notification.requestPermission().then((permission) => setFormError(permission === 'granted' ? '' : 'Les notifications sont refusées. Tu peux les activer dans les réglages du navigateur.'))
  }

  function saveTimer() {
    const minutes = Number(duration); const link = normaliseUrl(auctionUrl)
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 525600) { setFormError('Indique une durée comprise entre 1 minute et 365 jours.'); return false }
    if (auctionUrl.trim() && !link) { setFormError('Le lien de l’enchère doit être une adresse web valide.'); return false }
    setTimers((current) => [{ id: crypto.randomUUID(), title: title.trim() || 'Enchère sans nom', endsAt: Date.now() + minutes * 60000, auctionUrl: link }, ...current])
    setTitle(''); setDuration('30'); setAuctionUrl(''); setFormError(''); setComposerOpen(false)
    return true
  }

  function addTimer(event: FormEvent<HTMLFormElement>) { event.preventDefault(); saveTimer() }

  function confirmDuration() {
    setDuration(String(pickerHours * 60 + pickerMinutes))
    setPickerOpen(false)
  }

  function removeTimer(timer: Timer) { archiveTimer(timer) }
  function toggleArchiveSelection(id: string) { setSelectedArchiveIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]) }
  function deleteSelectedArchive() {
    if (!selectedArchiveIds.length) return
    if (!window.confirm(`Supprimer définitivement ${selectedArchiveIds.length} archive${selectedArchiveIds.length > 1 ? 's' : ''} ?`)) return
    setArchive((current) => current.filter((timer) => !selectedArchiveIds.includes(timer.id)))
    setSelectedArchiveIds([])
    setArchiveSelectionMode(false)
  }

  return <main className="app-shell">
    <header className="topbar"><img className="brand-mark" src="/wikitimer-icon.png" alt=""/><div><p className="eyebrow">WIKITIMERS</p><h1>Mes enchères</h1></div><span className="local-badge">● Données sur cet appareil</span></header>
    <section className="notification-card" aria-label="Alertes de fin"><div><h2>Alertes de fin</h2><p>Popup, notification navigateur et son répété jusqu’à validation.</p></div><div className="notification-controls"><select value={sound} onChange={(event) => setSound(event.target.value as SoundId)} aria-label="Son de l’alerte"><option value="bell">Son : Cloche</option><option value="chime">Son : Carillon</option><option value="alarm">Son : Alarme</option></select><button type="button" className="tonal-button" onClick={() => { const stop = startAlertLoop(sound); window.setTimeout(stop, 1800) }}>Écouter</button><button type="button" className="tonal-button" onClick={requestNotifications}>{'Notification' in window && Notification.permission === 'granted' ? 'Notifications actives' : 'Activer les notifications'}</button></div></section>
    <section className="timers-section" aria-labelledby="timers-title"><div className="section-heading"><div><h2 id="timers-title">Minuteries</h2><p>{timers.length === 0 ? 'Aucune minuterie pour le moment.' : `${timers.length} minuterie${timers.length > 1 ? 's' : ''} active${timers.length > 1 ? 's' : ''}.`}</p></div><div className="dashboard-actions"><button type="button" className="add-timer-button" onClick={() => setComposerOpen(true)}>＋ Ajouter un timer</button><label className="sort-control"><span>Organiser</span><select value={sortOrder} onChange={(event) => setSortOrder(event.target.value as SortOrder)}><option value="closest">Échéance proche</option><option value="furthest">Échéance éloignée</option></select></label><button type="button" className="archive-button" onClick={() => setShowArchive((current) => !current)}>Archives <span>{archive.length}</span></button></div></div>
      {orderedTimers.length === 0 ? <div className="empty-state"><span aria-hidden="true">◴</span><h3>Aucune minuterie active</h3><p>Ajoute ta première enchère pour démarrer.</p><button type="button" className="empty-add-button" onClick={() => setComposerOpen(true)} aria-label="Ajouter la première minuterie">＋</button></div> : <div className="timer-grid">{orderedTimers.map((timer) => { const finished = timer.endsAt <= now; return <article className={`timer-card${finished ? ' is-finished' : ''}`} key={timer.id}><div className="card-topline"><span className={`status-dot${finished ? ' is-finished' : ''}`} aria-hidden="true"/><span>{finished ? 'À valider' : 'En cours'}</span><button className="icon-button" type="button" onClick={() => removeTimer(timer)} aria-label={`Archiver ${timer.title}`}>×</button></div><h3>{timer.title}</h3><time className="countdown" dateTime={new Date(timer.endsAt).toISOString()}>{finished ? '00:00:00' : formatRemaining(timer.endsAt - now)}</time><p className="end-date">Fin prévue le {formatDate(timer.endsAt)}</p>{finished ? <button type="button" className="validate-timer-button" onClick={() => archiveTimer(timer)}>✓ Valider et archiver</button> : timer.auctionUrl ? <a className="auction-link" href={timer.auctionUrl} target="_blank" rel="noreferrer">Lien de l’enchère <span aria-hidden="true">↗</span></a> : <span className="no-link">Aucun lien d’enchère</span>}</article> })}</div>}
    </section>
    {showArchive && <section className="archive-section" aria-labelledby="archive-title"><div className="section-heading"><div><h2 id="archive-title">Archives</h2><p>Échéances déjà validées.</p></div>{orderedArchive.length > 0 && <div className="archive-actions">{archiveSelectionMode ? <><button type="button" className="tonal-button" onClick={() => { setArchiveSelectionMode(false); setSelectedArchiveIds([]) }}>Annuler</button><button type="button" className="delete-selection-button" disabled={!selectedArchiveIds.length} onClick={deleteSelectedArchive}>Supprimer ({selectedArchiveIds.length})</button></> : <button type="button" className="tonal-button" onClick={() => setArchiveSelectionMode(true)}>Sélectionner</button>}</div>}</div>{orderedArchive.length === 0 ? <p className="archive-empty">Aucune archive.</p> : <div className="archive-list">{orderedArchive.map((timer) => <article key={timer.id} className={selectedArchiveIds.includes(timer.id) ? 'is-selected' : ''}>{archiveSelectionMode && <button type="button" className="archive-select-target" onClick={() => toggleArchiveSelection(timer.id)} aria-label={`${selectedArchiveIds.includes(timer.id) ? 'Désélectionner' : 'Sélectionner'} ${timer.title}`} aria-pressed={selectedArchiveIds.includes(timer.id)}>{selectedArchiveIds.includes(timer.id) ? '✓' : ''}</button>}<div><strong>{timer.title}</strong><span>Terminée le {formatDate(timer.endsAt)} · Archivée le {formatDate(timer.archivedAt)}</span></div>{timer.auctionUrl && <a href={timer.auctionUrl} target="_blank" rel="noreferrer">Lien ↗</a>}</article>)}</div>}</section>}
    {composerOpen && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !pickerOpen) saveTimer() }}><section className="composer-dialog" role="dialog" aria-modal="true" aria-labelledby="new-timer-title"><div className="dialog-heading"><div className="dialog-brand"><img src="/wikitimer-icon.png" alt=""/><div><p className="eyebrow">NOUVELLE ÉCHÉANCE</p><h2 id="new-timer-title">Ajouter une minuterie</h2></div></div><button className="icon-button" type="button" onClick={() => { setComposerOpen(false); setFormError('') }} aria-label="Fermer">×</button></div><p>La date de fin réelle reste exacte même après un redémarrage.</p><form className="timer-form" onSubmit={addTimer}><label><span>Nom de l’enchère</span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} placeholder="Ex. Console rétro" autoFocus /></label><label><span>Durée</span><button type="button" className="time-picker-trigger" onClick={() => setPickerOpen(true)}><strong>{String(pickerHours).padStart(2, '0')}:{String(pickerMinutes).padStart(2, '0')}</strong><small>Régler</small></button></label><label className="link-field"><span>Lien de l’enchère</span><input value={auctionUrl} onChange={(event) => setAuctionUrl(event.target.value)} type="url" placeholder="https://…" /></label><button className="primary-button" type="submit"><span aria-hidden="true">＋</span> Ajouter la minuterie</button></form>{formError && <p className="form-error" role="alert">{formError}</p>}{pickerOpen && <div className="time-picker-popover" role="dialog" aria-modal="true" aria-label="Régler la durée"><p className="eyebrow">DURÉE</p><h3>Régler le minuteur</h3><div className="time-wheel"><div><span>Heures</span><div className="spinner"><button type="button" onClick={() => setPickerHours((value) => Math.min(8760, value + 1))}>⌃</button><button className="time-value-button" type="button" aria-label="Heures : saisir un chiffre remplace la valeur" onKeyDown={(event) => { if (/^\d$/.test(event.key)) { event.preventDefault(); setPickerHours(Number(event.key)) } }}>{String(pickerHours).padStart(2, '0')}</button><button type="button" onClick={() => setPickerHours((value) => Math.max(0, value - 1))}>⌄</button></div></div><b>:</b><div><span>Minutes</span><div className="spinner"><button type="button" onClick={() => setPickerMinutes((value) => (value + 1) % 60)}>⌃</button><button className="time-value-button" type="button" aria-label="Minutes : saisir un chiffre remplace la valeur" onKeyDown={(event) => { if (/^\d$/.test(event.key)) { event.preventDefault(); setPickerMinutes(Number(event.key)) } }}>{String(pickerMinutes).padStart(2, '0')}</button><button type="button" onClick={() => setPickerMinutes((value) => (value + 59) % 60)}>⌄</button></div></div></div><div className="picker-actions"><button type="button" className="tonal-button" onClick={() => setPickerOpen(false)}>Annuler</button><button type="button" className="primary-button" onClick={confirmDuration} disabled={pickerHours === 0 && pickerMinutes === 0}>Valider</button></div></div>}</section></div>}
    {finishedTimer && <div className="dialog-backdrop" role="presentation"><section className="finish-dialog" role="dialog" aria-modal="true" aria-labelledby="finished-title"><button className="icon-button finish-close" type="button" onClick={() => setFinishedTimer(null)} aria-label="Fermer le popup">×</button><span className="finish-icon" aria-hidden="true">⏰</span><p className="eyebrow">ÉCHÉANCE TERMINÉE</p><h2 id="finished-title">{finishedTimer.title}</h2><p>L’alarme continue jusqu’à validation ou archivage de cette minuterie.</p>{finishedTimer.auctionUrl && <a className="auction-link" href={finishedTimer.auctionUrl} target="_blank" rel="noreferrer">Ouvrir le lien de l’enchère ↗</a>}<button type="button" className="primary-button" onClick={() => archiveTimer(finishedTimer)}>Valider et archiver</button></section></div>}
    {orderedTimers.length > 0 && <button type="button" className="floating-add-button" onClick={() => setComposerOpen(true)} aria-label="Ajouter une minuterie">＋</button>}
  </main>
}

export default App
