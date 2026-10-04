import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'

type Timer = { id: string; title: string; endsAt: number; auctionUrl: string }
type ArchivedTimer = Timer & { archivedAt: number }
type SoundId = 'bell' | 'chime' | 'alarm'

const TIMER_STORAGE_KEY = 'wikitimer.timers.v1'
const ARCHIVE_STORAGE_KEY = 'wikitimer.archive.v1'
const SETTINGS_STORAGE_KEY = 'wikitimer.settings.v1'

function readList<T>(key: string): T[] {
  try { const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]'); return Array.isArray(value) ? value as T[] : [] } catch { return [] }
}

function readSound(): SoundId {
  try { const sound = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '{}')?.sound; return sound === 'chime' || sound === 'alarm' ? sound : 'bell' } catch { return 'bell' }
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
  const [sound, setSound] = useState<SoundId>(readSound); const [formError, setFormError] = useState(''); const [finishedTimer, setFinishedTimer] = useState<Timer | null>(null)
  const [showArchive, setShowArchive] = useState(false)
  const alertTimerId = useRef<string | null>(null); const stopAlertRef = useRef<() => void>(() => {})

  useEffect(() => { setNow(Date.now()); const interval = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(interval) }, [])
  useEffect(() => () => stopAlertRef.current(), [])
  useEffect(() => { localStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify(timers)) }, [timers])
  useEffect(() => { localStorage.setItem(ARCHIVE_STORAGE_KEY, JSON.stringify(archive)) }, [archive])
  useEffect(() => { localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ sound })) }, [sound])

  function archiveTimer(timer: Timer) {
    stopAlertRef.current(); stopAlertRef.current = () => {}; alertTimerId.current = null; setFinishedTimer(null)
    setTimers((current) => current.filter((item) => item.id !== timer.id))
    setArchive((current) => current.some((item) => item.id === timer.id) ? current : [{ ...timer, archivedAt: Date.now() }, ...current])
  }

  useEffect(() => {
    if (finishedTimer) return
    const elapsed = timers.find((timer) => timer.endsAt <= now && timer.id !== alertTimerId.current)
    if (!elapsed) return
    alertTimerId.current = elapsed.id; stopAlertRef.current = startAlertLoop(sound); setFinishedTimer(elapsed)
    if ('Notification' in window && Notification.permission === 'granted') {
      const notification = new Notification('WikiTimer — échéance terminée', { body: `« ${elapsed.title} » est terminée.` })
      notification.onclick = () => { window.focus(); archiveTimer(elapsed) }
    }
  }, [finishedTimer, now, sound, timers])

  const orderedTimers = useMemo(() => [...timers].sort((a, b) => a.endsAt - b.endsAt), [timers])
  const orderedArchive = useMemo(() => [...archive].sort((a, b) => b.archivedAt - a.archivedAt), [archive])

  function requestNotifications() {
    if (!('Notification' in window)) { setFormError('Les notifications ne sont pas prises en charge par ce navigateur.'); return }
    void Notification.requestPermission().then((permission) => setFormError(permission === 'granted' ? '' : 'Les notifications sont refusées. Tu peux les activer dans les réglages du navigateur.'))
  }

  function addTimer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const minutes = Number(duration); const link = normaliseUrl(auctionUrl)
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 525600) { setFormError('Indique une durée comprise entre 1 minute et 365 jours.'); return }
    if (auctionUrl.trim() && !link) { setFormError('Le lien de l’enchère doit être une adresse web valide.'); return }
    setTimers((current) => [{ id: crypto.randomUUID(), title: title.trim() || 'Enchère sans nom', endsAt: Date.now() + minutes * 60000, auctionUrl: link }, ...current])
    setTitle(''); setDuration('30'); setAuctionUrl(''); setFormError('')
  }

  function removeTimer(id: string) { if (window.confirm('Supprimer cette minuterie de cet appareil ?')) setTimers((current) => current.filter((timer) => timer.id !== id)) }
  function removeArchived(id: string) { if (window.confirm('Supprimer cette archive ?')) setArchive((current) => current.filter((timer) => timer.id !== id)) }

  return <main className="app-shell">
    <header className="topbar"><div className="brand-mark" aria-hidden="true">◷</div><div><p className="eyebrow">WIKITIMER</p><h1>Mes enchères</h1></div><span className="local-badge">● Données sur cet appareil</span></header>
    <section className="intro-card" aria-labelledby="new-timer-title"><div className="intro-copy"><span className="material-symbol" aria-hidden="true">⏱</span><div><h2 id="new-timer-title">Créer une minuterie</h2><p>La date de fin est enregistrée : après un redémarrage, le compte à rebours reste exact.</p></div></div><form className="timer-form" onSubmit={addTimer}><label><span>Nom de l’enchère</span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} placeholder="Ex. Console rétro" /></label><label><span>Durée (minutes)</span><input value={duration} onChange={(event) => setDuration(event.target.value)} type="number" min="1" max="525600" inputMode="numeric" required /></label><label className="link-field"><span>Lien de l’enchère</span><input value={auctionUrl} onChange={(event) => setAuctionUrl(event.target.value)} type="url" placeholder="https://…" /></label><button className="primary-button" type="submit"><span aria-hidden="true">＋</span> Ajouter</button></form>{formError && <p className="form-error" role="alert">{formError}</p>}</section>
    <section className="notification-card" aria-label="Alertes de fin"><div><h2>Alertes de fin</h2><p>Popup, notification navigateur et son répété jusqu’à validation.</p></div><div className="notification-controls"><select value={sound} onChange={(event) => setSound(event.target.value as SoundId)} aria-label="Son de l’alerte"><option value="bell">Son : Cloche</option><option value="chime">Son : Carillon</option><option value="alarm">Son : Alarme</option></select><button type="button" className="tonal-button" onClick={() => { const stop = startAlertLoop(sound); window.setTimeout(stop, 1800) }}>Écouter</button><button type="button" className="tonal-button" onClick={requestNotifications}>{'Notification' in window && Notification.permission === 'granted' ? 'Notifications actives' : 'Activer les notifications'}</button></div></section>
    <section className="timers-section" aria-labelledby="timers-title"><div className="section-heading"><div><h2 id="timers-title">Minuteries</h2><p>{timers.length === 0 ? 'Aucune minuterie pour le moment.' : `${timers.length} minuterie${timers.length > 1 ? 's' : ''} active${timers.length > 1 ? 's' : ''}.`}</p></div><button type="button" className="archive-button" onClick={() => setShowArchive((current) => !current)}>Archives <span>{archive.length}</span></button></div>
      {orderedTimers.length === 0 ? <div className="empty-state"><span aria-hidden="true">◴</span><h3>Prêt quand tu l’es</h3><p>Ajoute une durée pour suivre la fin d’une enchère.</p></div> : <div className="timer-grid">{orderedTimers.map((timer) => <article className="timer-card" key={timer.id}><div className="card-topline"><span className="status-dot" aria-hidden="true"/><span>En cours</span><button className="icon-button" type="button" onClick={() => removeTimer(timer.id)} aria-label={`Supprimer ${timer.title}`}>×</button></div><h3>{timer.title}</h3><time className="countdown" dateTime={new Date(timer.endsAt).toISOString()}>{formatRemaining(timer.endsAt - now)}</time><p className="end-date">Fin prévue le {formatDate(timer.endsAt)}</p>{timer.auctionUrl ? <a className="auction-link" href={timer.auctionUrl} target="_blank" rel="noreferrer">Lien de l’enchère <span aria-hidden="true">↗</span></a> : <span className="no-link">Aucun lien d’enchère</span>}</article>)}</div>}
    </section>
    {showArchive && <section className="archive-section" aria-labelledby="archive-title"><div className="section-heading"><div><h2 id="archive-title">Archives</h2><p>Échéances déjà validées.</p></div></div>{orderedArchive.length === 0 ? <p className="archive-empty">Aucune archive.</p> : <div className="archive-list">{orderedArchive.map((timer) => <article key={timer.id}><div><strong>{timer.title}</strong><span>Terminée le {formatDate(timer.endsAt)} · Archivée le {formatDate(timer.archivedAt)}</span></div>{timer.auctionUrl && <a href={timer.auctionUrl} target="_blank" rel="noreferrer">Lien ↗</a>}<button type="button" className="icon-button" onClick={() => removeArchived(timer.id)} aria-label={`Supprimer l’archive ${timer.title}`}>×</button></article>)}</div>}</section>}
    {finishedTimer && <div className="dialog-backdrop" role="presentation"><section className="finish-dialog" role="dialog" aria-modal="true" aria-labelledby="finished-title"><span className="finish-icon" aria-hidden="true">⏰</span><p className="eyebrow">ÉCHÉANCE TERMINÉE</p><h2 id="finished-title">{finishedTimer.title}</h2><p>La sonnerie s’arrête et cette minuterie rejoint les archives après validation.</p>{finishedTimer.auctionUrl && <a className="auction-link" href={finishedTimer.auctionUrl} target="_blank" rel="noreferrer">Ouvrir le lien de l’enchère ↗</a>}<button type="button" className="primary-button" onClick={() => archiveTimer(finishedTimer)}>Valider et archiver</button></section></div>}
  </main>
}

export default App
