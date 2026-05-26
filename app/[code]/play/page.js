"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "../../../lib/supabase"
import { useSubmitNudge } from "../../../lib/useSubmitNudge"
import PokeSystem, { FOOTER_H } from "../../../components/PokeSystem"
import GameModal from "../../../components/GameModal"

const BG = "#2B0F6B"
const YELLOW = "#FBDF54"

const POKE_COLORS = { dark: "#1A0840", mid: "#200C52", wl: "#4A228C", yellow: "#FBDF54", notifBg: "#15062A" }
const BOTTOM_PAD = `calc(${FOOTER_H + 8}px + env(safe-area-inset-bottom))`

const PALETTE = [
  // Neutrals
  "#000000","#2D2D2D","#666666","#AAAAAA","#DDDDDD","#FFFFFF",
  // Darks
  "#6B0000","#5C3000","#1A4D00","#003D3D","#002B6B","#3D006B",
  // Vivids
  "#E53935","#FB8C00","#FDD835","#7CB342","#00897B","#039BE5","#1E88E5","#8E24AA",
  // Skin tones + warm neutrals
  "#FDDBB4","#D4956A","#8D5524","#A1887F",
  // Pastels
  "#FFB3C6","#FFD4A8","#FFF5BA","#C8F5D3","#BAE1FF","#E8BAFF",
]

// ─── Flood fill ───────────────────────────────────────────────────────────────

function hexToRgb(hex) {
  return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)]
}

function floodFillImageData(imageData, startX, startY, fillHex) {
  const d = imageData.data, w = imageData.width, h = imageData.height
  if (startX < 0 || startY < 0 || startX >= w || startY >= h) return
  const [fr, fg, fb] = hexToRgb(fillHex)
  const si = (startY * w + startX) * 4
  const tr = d[si], tg = d[si+1], tb = d[si+2]
  if (tr === fr && tg === fg && tb === fb) return
  const stack = [startY * w + startX], visited = new Uint8Array(w * h), tol = 80
  while (stack.length) {
    const p = stack.pop()
    if (p < 0 || p >= w * h || visited[p]) continue
    const i = p * 4
    if (Math.abs(d[i]-tr) > tol || Math.abs(d[i+1]-tg) > tol || Math.abs(d[i+2]-tb) > tol) continue
    visited[p] = 1; d[i] = fr; d[i+1] = fg; d[i+2] = fb; d[i+3] = 255
    const x = p % w, y = Math.floor(p / w)
    if (x > 0) stack.push(p-1); if (x < w-1) stack.push(p+1)
    if (y > 0) stack.push(p-w); if (y < h-1) stack.push(p+w)
  }
  // Dilation pass: cover anti-aliased hairline pixels adjacent to filled area
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!visited[y*w+x]) continue
      for (let dy = -1; dy <= 1; dy++) { for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue
        const nx = x+dx, ny = y+dy
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        const ni = ny*w+nx; if (visited[ni]) continue
        const ii = ni*4
        if (Math.abs(d[ii]-tr) <= 150 && Math.abs(d[ii+1]-tg) <= 150 && Math.abs(d[ii+2]-tb) <= 150) {
          d[ii] = fr; d[ii+1] = fg; d[ii+2] = fb; d[ii+3] = 255; visited[ni] = 1
        }
      }}
    }
  }
}

// ─── DrawingCanvas ────────────────────────────────────────────────────────────

function DrawingCanvas({ onExport, onFirstMark }) {
  const containerRef = useRef(null)
  const canvasRef = useRef(null)
  const fabricRef = useRef(null)
  const fabricLibRef = useRef(null)
  const historyRef = useRef([])
  const redoStackRef = useRef([])
  const onExportRef = useRef(onExport)
  onExportRef.current = onExport
  const onFirstMarkRef = useRef(onFirstMark)
  onFirstMarkRef.current = onFirstMark
  const touchCleanupRef = useRef(null)
  const zoomRef = useRef(1)
  const pinchRef = useRef(null)
  const panStartRef = useRef(null)
  const bucketPendingRef = useRef(null)

  const [color, setColorState] = useState("#000000")
  const [brushSize, setBrushSize] = useState(8)
  const [toolMode, setToolModeState] = useState("pen")
  const [zoomState, setZoomState] = useState(1)

  const colorRef = useRef("#000000")
  colorRef.current = color
  const toolModeRef = useRef("pen")
  toolModeRef.current = toolMode
  const brushSizeRef = useRef(8)
  brushSizeRef.current = brushSize

  const doBucketFill = useCallback(async (x, y) => {
    const cv = fabricRef.current, fabricLib = fabricLibRef.current
    if (!cv || !fabricLib) return
    const savedVT = [...cv.viewportTransform]
    cv.setViewportTransform([1, 0, 0, 1, 0, 0])
    const dataUrl = cv.toDataURL({ format: "png" })
    cv.setViewportTransform(savedVT)
    await new Promise(resolve => {
      const img = new Image()
      img.onload = () => {
        const off = document.createElement("canvas")
        off.width = cv.width; off.height = cv.height
        const ctx = off.getContext("2d")
        ctx.drawImage(img, 0, 0)
        const imgData = ctx.getImageData(0, 0, off.width, off.height)
        floodFillImageData(imgData, x, y, colorRef.current)
        ctx.putImageData(imgData, 0, 0)
        fabricLib.Image.fromURL(off.toDataURL(), (fabricImg) => {
          cv.clear(); cv.backgroundColor = "#ffffff"
          fabricImg.set({ selectable: false, evented: false, left: 0, top: 0, scaleX: 1, scaleY: 1 })
          cv.add(fabricImg); cv.renderAll()
          historyRef.current.push(JSON.stringify(cv.toJSON()))
          redoStackRef.current = []; resolve()
        })
      }
      img.src = dataUrl
    })
  }, [])
  const doBucketFillRef = useRef(doBucketFill)
  doBucketFillRef.current = doBucketFill

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { fabric } = await import("fabric")
      if (cancelled || !canvasRef.current || !containerRef.current) return
      fabricLibRef.current = fabric
      const w = containerRef.current.clientWidth
      const h = containerRef.current.clientHeight || w
      const canvas = new fabric.Canvas(canvasRef.current, { isDrawingMode: true, width: w, height: h, backgroundColor: "#ffffff" })
      canvas.freeDrawingBrush.color = "#000000"
      canvas.freeDrawingBrush.width = 8
      canvas.on("path:created", () => {
        historyRef.current.push(JSON.stringify(canvas.toJSON()))
        redoStackRef.current = []
        onFirstMarkRef.current?.()
      })
      canvas.on("mouse:down", (opt) => {
        if (toolModeRef.current !== "bucket") return
        const p = canvas.getPointer(opt.e)
        bucketPendingRef.current = setTimeout(() => {
          bucketPendingRef.current = null
          doBucketFillRef.current(Math.round(p.x), Math.round(p.y))
        }, 150)
      })
      fabricRef.current = canvas
      onExportRef.current(() => {
        const savedVT = [...canvas.viewportTransform]
        canvas.setViewportTransform([1, 0, 0, 1, 0, 0])
        const url = canvas.toDataURL({ format: "jpeg", quality: 0.72 })
        canvas.setViewportTransform(savedVT)
        return url
      })

      // ── Pinch-to-zoom ─────────────────────────────────────────────────────
      function clampVP() {
        const vt = canvas.viewportTransform, z = canvas.getZoom()
        const W = canvas.width, H = canvas.height
        vt[4] = Math.min(0, Math.max(W * (1 - z), vt[4]))
        vt[5] = Math.min(0, Math.max(H * (1 - z), vt[5]))
        canvas.setViewportTransform(vt)
      }
      function onTouchStart(e) {
        if (e.touches.length >= 2) {
          e.preventDefault(); e.stopImmediatePropagation()
          if (bucketPendingRef.current) { clearTimeout(bucketPendingRef.current); bucketPendingRef.current = null }
          try {
            canvas.freeDrawingBrush._points = []
            canvas.clearContext(canvas.contextTop)
          } catch (_) {}
          canvas.isDrawingMode = false
          const t1 = e.touches[0], t2 = e.touches[1]
          pinchRef.current = {
            dist: Math.hypot(t1.clientX-t2.clientX, t1.clientY-t2.clientY),
            startZoom: zoomRef.current,
            midX: (t1.clientX+t2.clientX)/2,
            midY: (t1.clientY+t2.clientY)/2,
          }
        }
      }
      function onTouchMove(e) {
        if (e.touches.length >= 2 && pinchRef.current) {
          e.preventDefault(); e.stopImmediatePropagation()
          const t1 = e.touches[0], t2 = e.touches[1]
          const newDist = Math.hypot(t1.clientX-t2.clientX, t1.clientY-t2.clientY)
          const newZoom = Math.min(8, Math.max(1, pinchRef.current.startZoom * (newDist / pinchRef.current.dist)))
          const newMidX = (t1.clientX+t2.clientX)/2
          const newMidY = (t1.clientY+t2.clientY)/2
          zoomRef.current = newZoom
          const rect = canvas.upperCanvasEl.getBoundingClientRect()
          canvas.zoomToPoint({ x: newMidX - rect.left, y: newMidY - rect.top }, newZoom)
          canvas.relativePan({ x: newMidX - pinchRef.current.midX, y: newMidY - pinchRef.current.midY })
          pinchRef.current.midX = newMidX; pinchRef.current.midY = newMidY
          clampVP(); setZoomState(newZoom)
        }
      }
      function onTouchEnd(e) {
        if (e.touches.length < 2) pinchRef.current = null
        if (e.touches.length === 0) {
          // Defer re-enabling drawing mode so Fabric's own touchend handling
          // completes first — avoids a state conflict that prevents drawing
          requestAnimationFrame(() => {
            if (toolModeRef.current !== "bucket") canvas.isDrawingMode = true
          })
        }
      }
      canvas.upperCanvasEl.addEventListener("touchstart", onTouchStart, { passive: false })
      canvas.upperCanvasEl.addEventListener("touchmove", onTouchMove, { passive: false })
      canvas.upperCanvasEl.addEventListener("touchend", onTouchEnd)
      touchCleanupRef.current = () => {
        canvas.upperCanvasEl.removeEventListener("touchstart", onTouchStart)
        canvas.upperCanvasEl.removeEventListener("touchmove", onTouchMove)
        canvas.upperCanvasEl.removeEventListener("touchend", onTouchEnd)
      }
    })()
    return () => { cancelled = true; touchCleanupRef.current?.(); fabricRef.current?.dispose(); fabricRef.current = null }
  }, [])

  function applyBrush(c, sz, eraser) {
    const cv = fabricRef.current; if (!cv) return
    cv.freeDrawingBrush.color = eraser ? "#ffffff" : c
    cv.freeDrawingBrush.width = sz
  }
  function handleColorClick(c) {
    setColorState(c)
    if (toolMode === "bucket") return
    const next = toolMode === "eraser" ? "pen" : toolMode
    if (next !== toolMode) setToolModeState(next)
    const cv = fabricRef.current; if (cv) cv.isDrawingMode = true
    applyBrush(c, brushSizeRef.current, false)
  }
  function handleSetTool(mode) {
    const next = mode === toolMode ? "pen" : mode
    setToolModeState(next)
    const cv = fabricRef.current; if (!cv) return
    cv.isDrawingMode = next !== "bucket"
    if (next !== "bucket") applyBrush(colorRef.current, brushSizeRef.current, next === "eraser")
  }
  function handleSizeChange(sz) {
    setBrushSize(sz); applyBrush(colorRef.current, sz, toolMode === "eraser")
  }
  function handleUndo() {
    const hist = historyRef.current; if (!hist.length) return
    const last = hist.pop(); redoStackRef.current.push(last)
    const cv = fabricRef.current; if (!cv) return
    if (hist.length === 0) { cv.clear(); cv.backgroundColor = "#ffffff"; cv.renderAll() }
    else cv.loadFromJSON(JSON.parse(hist[hist.length-1]), () => cv.renderAll())
  }
  function handleRedo() {
    const redo = redoStackRef.current; if (!redo.length) return
    const state = redo.pop(); historyRef.current.push(state)
    const cv = fabricRef.current; if (!cv) return
    cv.loadFromJSON(JSON.parse(state), () => cv.renderAll())
  }
  function handleClear() {
    const cv = fabricRef.current; if (!cv) return
    if (cv.getObjects().length > 0) { historyRef.current.push(JSON.stringify(cv.toJSON())); redoStackRef.current = [] }
    cv.clear(); cv.backgroundColor = "#ffffff"; cv.renderAll()
  }
  function handleResetZoom() {
    const cv = fabricRef.current; if (!cv) return
    cv.setViewportTransform([1, 0, 0, 1, 0, 0]); cv.setZoom(1)
    zoomRef.current = 1; setZoomState(1)
    if (toolModeRef.current !== "bucket") cv.isDrawingMode = true
  }

  const BRUSH_SIZES = [2, 4, 8, 14, 22, 34, 52]
  const iconStroke = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }
  const BTN_SEC = "rgba(255,255,255,0.15)"

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Canvas — fills available height, with floating zoom-out button */}
      <div ref={containerRef} style={{ flex: 1, minHeight: 0, position: "relative", cursor: toolMode === "bucket" ? "crosshair" : "default" }}>
        <canvas ref={canvasRef} style={{ display: "block", touchAction: "none" }} />
        {zoomState > 1.05 && (
          <button onClick={handleResetZoom} style={{
            position: "absolute", bottom: 10, right: 10,
            width: 44, height: 44, background: "rgba(0,0,0,0.55)",
            color: "white", display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" {...iconStroke}>
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/>
            </svg>
          </button>
        )}
      </div>

      {/* Brush sizes */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "10px 16px 8px" }}>
        {BRUSH_SIZES.map((sz, i) => {
          const d = 5 + i * 4.5, active = brushSize === sz && toolMode !== "bucket"
          return (
            <button key={sz} onClick={() => handleSizeChange(sz)} disabled={toolMode === "bucket"}
              style={{ width: 38, height: 38, flexShrink: 0, background: active ? BTN_SEC : "transparent", display: "flex", alignItems: "center", justifyContent: "center", border: active ? `2px solid ${YELLOW}` : "2px solid transparent" }}>
              <div style={{ width: d, height: d, borderRadius: "50%", background: "white" }} />
            </button>
          )
        })}
      </div>

      {/* Color palette */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, padding: "0 16px 8px" }}>
        {PALETTE.map(c => (
          <button key={c} onClick={() => handleColorClick(c)}
            style={{ width: 28, height: 28, background: c, flexShrink: 0,
              border: color === c && toolMode !== "eraser" ? "3px solid white" : c === "#FFFFFF" || c === "#DDDDDD" ? "1px solid rgba(255,255,255,0.25)" : "2px solid transparent" }} />
        ))}
      </div>

      {/* Tool + utility row */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "0 16px 10px", flexWrap: "nowrap" }}>
        {[
          { mode: "pen", label: "Draw", icon: <svg width="18" height="18" viewBox="0 0 24 24" {...iconStroke}><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> },
          { mode: "eraser", label: "Erase", icon: <svg width="18" height="18" viewBox="0 0 24 24" {...iconStroke}><path d="M20 20H7L3 16l13-13 7 7-3 3"/><path d="M6 17l4-4"/></svg> },
          { mode: "bucket", label: "Fill", icon: <svg width="18" height="18" viewBox="0 0 24 24" {...iconStroke}><path d="M19 11L11 3 2.5 11.5a5.5 5.5 0 0 0 7.78 7.78L19 11z"/><path d="M5 3l5 5"/><path d="M22 22c0-1.2-.2-2-.8-3-1.4 0-2.2 1.8-2.2 3"/></svg> },
        ].map(({ mode, label, icon }) => (
          <button key={mode} onClick={() => handleSetTool(mode)}
            style={{ background: toolMode === mode ? YELLOW : BTN_SEC, color: toolMode === mode ? "#000" : "white", padding: "8px 10px", display: "flex", alignItems: "center", gap: 5, flexShrink: 0, height: 40 }}>
            {icon}
            <span style={{ fontSize: 13, fontWeight: 800 }}>{label}</span>
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={handleUndo} style={{ background: BTN_SEC, color: "white", width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" {...iconStroke}><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>
        </button>
        <button onClick={handleRedo} style={{ background: BTN_SEC, color: "white", width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" {...iconStroke}><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/></svg>
        </button>
        <button onClick={handleClear} style={{ background: BTN_SEC, color: "rgba(255,255,255,0.6)", width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <svg width="17" height="17" viewBox="0 0 24 24" {...iconStroke}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
        </button>
      </div>
    </div>
  )
}

// ─── RevealCard ───────────────────────────────────────────────────────────────

function RevealCard({ step, authorName }) {
  const isDrawing = step.step_type === "drawing"
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 16, fontWeight: 800, color: "rgba(255,255,255,0.75)", marginBottom: 8 }}>
        {isDrawing ? `${authorName} drew:` : `${authorName} wrote:`}
      </div>
      {isDrawing ? (
        <img
          src={step.content}
          alt="Drawing"
          style={{ width: "100%", display: "block", borderRadius: 8 }}
        />
      ) : (
        <div style={{
          background: "white",
          color: "#1a1a1a",
          borderRadius: "16px 16px 16px 4px",
          padding: "14px 18px",
          fontSize: 20,
          fontWeight: 700,
          lineHeight: 1.4,
          boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
        }}>
          {step.content}
        </div>
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

const IDEAS_URL = "https://raw.githubusercontent.com/jackbrannen/JackGames/main/random_ideas.json"
let _ideasCache = null
async function fetchIdeas() {
  if (_ideasCache) return _ideasCache
  const res = await fetch(IDEAS_URL)
  _ideasCache = await res.json()
  return _ideasCache
}
function sampleIdeas(categories, excludeSet, count = 3) {
  const cats = Object.keys(categories).map(cat => ({
    cat,
    pool: categories[cat].filter(idea => !excludeSet.has(idea.toLowerCase()))
  })).filter(({ pool }) => pool.length > 0)
  for (let i = cats.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cats[i], cats[j]] = [cats[j], cats[i]]
  }
  return cats.slice(0, count).map(({ pool }) => pool[Math.floor(Math.random() * pool.length)])
}

function formatPendingNames(players) {
  const names = players.map(p => p.name)
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names[0]}, ${names[1]}, and ${names.length - 2} more`
}

export default function Play({ params }) {
  const router = useRouter()
  const code = useMemo(() => params.code.toUpperCase(), [params.code])

  const [game, setGame] = useState(null)
  const [players, setPlayers] = useState([])
  const [steps, setSteps] = useState([])
  const [myPlayerId, setMyPlayerId] = useState(null)

  // Writing phase
  const [sentence, setSentence] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [shownIdeas, setShownIdeas] = useState([])
  const [loadingIdeas, setLoadingIdeas] = useState(false)

  // Drawing phase
  const getDrawingRef = useRef(null)
  const [drawingDirty, setDrawingDirty] = useState(false)

  // Reveal phase
  const [advancing, setAdvancing] = useState(false)

  // Finished screen
  const [selectedChainOwner, setSelectedChainOwner] = useState(null)

  // Timer
  const [timeLeft, setTimeLeft] = useState(null)
  const [showGameModal, setShowGameModal] = useState(false)
  const [pokeCooldownActive, setPokeCooldownActive] = useState(false)
  const [pokeJustSent, setPokeJustSent] = useState(null)
  const [instructions, setInstructions] = useState("")

  // Track previous phase so we don't auto-redirect when game resets after finishing
  const prevPhaseRef = useRef(null)
  const channelRef = useRef(null)
  const typingTimerRef = useRef(null)
  const [presenceState, setPresenceState] = useState({})
  const timedAutoSubmitRef = useRef(null)
  const sentenceRef = useRef("")
  const revealEndRef = useRef(null)

  useEffect(() => {
    if (!game?.next_game) return
    window.location.href = `https://${game.next_game}.jackbrannen.com/`
  }, [game?.next_game])

  const me = players.find(p => p.id === myPlayerId)

  useEffect(() => {
    supabase.from("game_instructions").select("body").eq("game_key", "telestrations").single()
      .then(({ data }) => { if (data?.body) setInstructions(data.body) })
  }, [])

  async function sendInlinePoke(targetName) {
    if (!me || pokeCooldownActive) return
    setPokeCooldownActive(true)
    setPokeJustSent(targetName)
    await supabase.from("pokes").insert({ room_code: code, from_player: me.name, to_player: targetName, message: "👉" })
    setTimeout(() => setPokeJustSent(null), 2000)
    setTimeout(() => setPokeCooldownActive(false), 10000)
  }

  async function loadState() {
    const { data: gameData } = await supabase
      .from("tel_games").select("phase,is_dummy,current_step,total_steps,reveal_order,current_reveal_chain,current_reveal_step,timer_seconds,step_started_at,next_game").eq("code", code).single()

    if (!gameData) { router.replace(`/${code}`); return }
    if (gameData.phase === "lobby") {
      // Don't auto-redirect players who are viewing the finished screen
      if (prevPhaseRef.current !== "finished") router.replace(`/${code}`)
      return
    }
    prevPhaseRef.current = gameData.phase

    const { data: playerData } = await supabase
      .from("tel_players").select("id,name,first_name,seat,is_bot")
      .eq("game_code", code).order("seat", { ascending: true })

    const { data: stepData } = await supabase
      .from("tel_steps").select("id,chain_owner_id,step_number,step_type,content,author_id")
      .eq("game_code", code).order("step_number", { ascending: true })

    setGame(gameData)
    setPlayers(playerData ?? [])
    setSteps(stepData ?? [])
  }

  useEffect(() => {
    const existing = localStorage.getItem(`tel:${code}:playerId`)
    if (existing) setMyPlayerId(existing)
  }, [code])

  useEffect(() => {
    loadState()
    let poll = setInterval(loadState, 1500)
    function handleVisibility() { clearInterval(poll); if (!document.hidden) { loadState(); poll = setInterval(loadState, 1500) } }
    document.addEventListener("visibilitychange", handleVisibility)

    const channel = supabase.channel(`tel-play-${code}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tel_games", filter: `code=eq.${code}` }, loadState)
      .on("postgres_changes", { event: "*", schema: "public", table: "tel_steps", filter: `game_code=eq.${code}` }, loadState)
      .on("presence", { event: "sync" }, () => setPresenceState({ ...channel.presenceState() }))
      .subscribe(async status => {
        if (status === "SUBSCRIBED" && myPlayerId) {
          await channel.track({ playerId: myPlayerId, typing: false })
        }
      })
    channelRef.current = channel

    return () => { clearInterval(poll); document.removeEventListener("visibilitychange", handleVisibility); supabase.removeChannel(channel) }
  }, [code])

  // Auto-reset after 30s on finished so late-joiners aren't stuck on the in-progress screen
  useEffect(() => {
    if (game?.phase !== "finished") return
    const t = setTimeout(() => supabase.rpc("tel_reset_game", { p_code: code }), 30000)
    return () => clearTimeout(t)
  }, [game?.phase, code])

  // ── Derived state (must come before any useEffect that references these) ──

  const n = game?.total_steps ?? 0
  const currentStep = game?.current_step ?? 0

  const myChainOwner = useMemo(() => {
    if (!me || n === 0) return null
    const passOffsets = game?.pass_offsets ?? null
    const offset = currentStep === 0 ? 0 : (passOffsets?.[currentStep - 1] ?? currentStep)
    const ownerSeat = ((me.seat - offset) % n + n) % n
    return players.find(p => p.seat === ownerSeat) ?? null
  }, [me, currentStep, n, players, game?.pass_offsets])

  const myPrevStepContent = useMemo(() => {
    if (!myChainOwner || currentStep === 0) return null
    return steps.find(s => s.chain_owner_id === myChainOwner.id && s.step_number === currentStep - 1) ?? null
  }, [myChainOwner, currentStep, steps])

  const myStepSubmitted = useMemo(() => {
    if (!myChainOwner || !me) return false
    return steps.some(s => s.chain_owner_id === myChainOwner.id && s.step_number === currentStep && s.author_id === me.id)
  }, [myChainOwner, currentStep, steps, me])

  const nudgeSentence = useSubmitNudge(sentence, myStepSubmitted)

  const submittedCount = useMemo(() => {
    return steps.filter(s => s.step_number === currentStep).length
  }, [steps, currentStep])

  const revealOrder = game?.reveal_order ?? []
  const currentRevealChain = game?.current_reveal_chain ?? 0
  const currentRevealStep = game?.current_reveal_step ?? -1

  useEffect(() => {
    if (game?.phase !== "reveal" || currentRevealStep < 0) return
    setTimeout(() => revealEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 80)
  }, [game?.phase, currentRevealStep, currentRevealChain])

  const currentPresenterPlayer = useMemo(() => {
    if (!revealOrder.length || !players.length) return null
    return players.find(p => p.id === revealOrder[currentRevealChain]) ?? null
  }, [revealOrder, currentRevealChain, players])

  const amPresenter = !!(me && currentPresenterPlayer && me.id === currentPresenterPlayer.id)

  const currentChainSteps = useMemo(() => {
    if (!currentPresenterPlayer) return []
    return steps
      .filter(s => s.chain_owner_id === currentPresenterPlayer.id)
      .sort((a, b) => a.step_number - b.step_number)
  }, [currentPresenterPlayer, steps])

  const allChains = useMemo(() => {
    return players
      .map(p => ({
        owner: p,
        steps: steps.filter(s => s.chain_owner_id === p.id).sort((a, b) => a.step_number - b.step_number),
      }))
      .filter(c => c.steps.length > 0)
  }, [players, steps])

  // Reset drawing dirty flag on each new step
  useEffect(() => {
    setDrawingDirty(false)
  }, [currentStep])

  // Auto-advance through bot chains in dummy games
  useEffect(() => {
    if (!game || game.phase !== "reveal" || !game.is_dummy) return
    if (!currentPresenterPlayer?.is_bot) return
    if (advancing) return

    const allRevealed = currentRevealStep >= n - 1
    const timer = setTimeout(async () => {
      if (!allRevealed) {
        await supabase.rpc("tel_advance_reveal", {
          p_code: code,
          p_new_reveal_step: currentRevealStep + 1,
          p_new_reveal_chain: currentRevealChain,
        })
      } else {
        await supabase.rpc("tel_advance_reveal", {
          p_code: code,
          p_new_reveal_step: -1,
          p_new_reveal_chain: currentRevealChain + 1,
        })
      }
      await loadState()
    }, 400)

    return () => clearTimeout(timer)
  }, [game?.phase, game?.is_dummy, currentPresenterPlayer?.id, currentRevealStep, currentRevealChain, advancing])

  // ── Submit helpers ────────────────────────────────────────────────────────

  async function submitStep(chainOwnerId, stepNumber, stepType, content) {
    if (!me) return
    const { error } = await supabase.rpc("tel_submit_step", {
      p_code: code,
      p_chain_owner_id: chainOwnerId,
      p_step_number: stepNumber,
      p_step_type: stepType,
      p_content: content,
      p_author_id: me.id,
    })
    if (error) throw error
    await loadState()
  }

  async function handleSubmitSentence(forcedText) {
    const text = forcedText !== undefined ? forcedText : sentence
    if (!text.trim() || !myChainOwner || submitting || myStepSubmitted) return
    setSubmitting(true)
    try {
      await submitStep(myChainOwner.id, currentStep, "text", text.trim())
      setSentence("")
    } catch (e) {
      alert("Error submitting: " + e.message)
    }
    setSubmitting(false)
  }

  async function uploadDrawing(dataUrl) {
    const res = await fetch(dataUrl)
    const blob = await res.blob()
    const filename = `${code}/${Date.now()}-${crypto.randomUUID()}.jpg`
    const { data, error } = await supabase.storage
      .from("drawings")
      .upload(filename, blob, { contentType: "image/jpeg" })
    if (error) throw error
    const { data: urlData } = supabase.storage.from("drawings").getPublicUrl(data.path)
    return urlData.publicUrl
  }

  async function handleSubmitDrawing() {
    if (!myChainOwner || submitting || myStepSubmitted) return
    const getDataUrl = getDrawingRef.current
    if (!getDataUrl) { alert("Canvas not ready"); return }
    const dataUrl = getDataUrl()
    if (!dataUrl) { alert("Canvas not ready"); return }
    setSubmitting(true)
    try {
      const url = await uploadDrawing(dataUrl)
      await submitStep(myChainOwner.id, currentStep, "drawing", url)
    } catch (e) {
      alert("Error submitting: " + e.message)
    }
    setSubmitting(false)
  }

  async function handleGetIdeas() {
    if (loadingIdeas || shownIdeas.length >= 9) return
    setLoadingIdeas(true)
    const isFirst = shownIdeas.length === 0
    const categories = await fetchIdeas()
    const excludeSet = new Set(shownIdeas.map(s => s.toLowerCase()))
    const picked = sampleIdeas(categories, excludeSet)
    if (isFirst) {
      const others = players.filter(p => p.id !== myPlayerId && (p.first_name || p.name))
      if (others.length && picked.length) {
        const pick = others[Math.floor(Math.random() * others.length)]
        picked[Math.floor(Math.random() * picked.length)] = pick.first_name || pick.name
      }
    }
    if (picked.length) setShownIdeas(prev => [...prev, ...picked])
    setLoadingIdeas(false)
  }

  async function handleAdvanceReveal() {
    if (advancing) return
    setAdvancing(true)
    await supabase.rpc("tel_advance_reveal", {
      p_code: code,
      p_new_reveal_step: currentRevealStep + 1,
      p_new_reveal_chain: currentRevealChain,
    })
    await loadState()
    setAdvancing(false)
  }

  async function handleNextChain() {
    if (advancing) return
    setAdvancing(true)
    await supabase.rpc("tel_advance_reveal", {
      p_code: code,
      p_new_reveal_step: -1,
      p_new_reveal_chain: currentRevealChain + 1,
    })
    await loadState()
    setAdvancing(false)
  }

  function trackTyping() {
    if (!channelRef.current || !myPlayerId) return
    channelRef.current.track({ playerId: myPlayerId, typing: true })
    clearTimeout(typingTimerRef.current)
    typingTimerRef.current = setTimeout(() => {
      if (channelRef.current) channelRef.current.track({ playerId: myPlayerId, typing: false })
    }, 3000)
  }

  const typingPlayerIds = new Set(
    Object.values(presenceState).flatMap(presences =>
      presences.filter(p => p.typing && p.playerId !== myPlayerId).map(p => p.playerId)
    )
  )

  sentenceRef.current = sentence

  // ── Timer countdown ───────────────────────────────────────────────────────

  useEffect(() => {
    if (!game?.timer_seconds || !game?.step_started_at || game?.phase !== "play") {
      setTimeLeft(null)
      return
    }
    const startMs = new Date(game.step_started_at).getTime()
    const durationMs = game.timer_seconds * 1000
    let fired = false

    const tick = () => {
      const left = Math.max(0, Math.ceil((startMs + durationMs - Date.now()) / 1000))
      setTimeLeft(left)
      if (left <= 0 && !fired) {
        fired = true
        timedAutoSubmitRef.current?.()
      }
    }
    tick()
    const id = setInterval(tick, 500)
    return () => clearInterval(id)
  }, [game?.timer_seconds, game?.step_started_at, game?.phase, game?.current_step])

  // ── Image strip export ────────────────────────────────────────────────────

  async function handleDownloadChainImage(chain) {
    const W = 640
    const HEADER_H = 48
    const IMG_H = Math.round(W * 0.72)
    const TEXT_PAD = 24
    const TEXT_LINE_H = 32
    const MAX_TEXT_LINES = 5

    async function loadImg(url) {
      const resp = await fetch(url)
      const blob = await resp.blob()
      const objUrl = URL.createObjectURL(blob)
      return new Promise((resolve) => {
        const img = new Image()
        img.onload = () => { URL.revokeObjectURL(objUrl); resolve(img) }
        img.onerror = () => resolve(null)
        img.src = objUrl
      })
    }

    function wrapText(ctx, text, maxWidth) {
      const words = text.split(" ")
      const lines = []
      let line = ""
      for (const word of words) {
        const test = line ? line + " " + word : word
        if (ctx.measureText(test).width > maxWidth && line) {
          lines.push(line)
          line = word
        } else {
          line = test
        }
      }
      if (line) lines.push(line)
      return lines.slice(0, MAX_TEXT_LINES)
    }

    const images = {}
    await Promise.all(chain.steps.map(async s => {
      if (s.step_type === "drawing") images[s.id] = await loadImg(s.content)
    }))

    // Measure canvas height
    const TITLE_H = 72
    let totalH = TITLE_H
    for (const s of chain.steps) {
      totalH += HEADER_H
      totalH += s.step_type === "drawing" ? IMG_H : (TEXT_PAD * 2 + TEXT_LINE_H * 3)
    }

    const canvas = document.createElement("canvas")
    canvas.width = W
    canvas.height = totalH
    const ctx = canvas.getContext("2d")

    // Background
    ctx.fillStyle = "#2B0F6B"
    ctx.fillRect(0, 0, W, totalH)

    // Title
    ctx.fillStyle = "#1A0840"
    ctx.fillRect(0, 0, W, TITLE_H)
    ctx.fillStyle = "rgba(255,255,255,0.9)"
    ctx.font = "900 22px -apple-system, Arial, sans-serif"
    ctx.textBaseline = "middle"
    ctx.fillText(`${chain.owner.name}'s telestration`, 24, TITLE_H / 2)

    let y = TITLE_H
    for (const s of chain.steps) {
      const author = players.find(p => p.id === s.author_id)
      const label = s.step_type === "drawing" ? `${author?.name ?? "?"} drew:` : `${author?.name ?? "?"} wrote:`

      // Step header
      ctx.fillStyle = "#200C52"
      ctx.fillRect(0, y, W, HEADER_H)
      ctx.fillStyle = "rgba(255,255,255,0.65)"
      ctx.font = "700 16px -apple-system, Arial, sans-serif"
      ctx.textBaseline = "middle"
      ctx.fillText(label, 20, y + HEADER_H / 2)
      y += HEADER_H

      if (s.step_type === "drawing") {
        const img = images[s.id]
        if (img) {
          ctx.drawImage(img, 0, y, W, IMG_H)
        } else {
          ctx.fillStyle = "#fff"
          ctx.fillRect(0, y, W, IMG_H)
        }
        y += IMG_H
      } else {
        const textH = TEXT_PAD * 2 + TEXT_LINE_H * 3
        ctx.fillStyle = "#ffffff"
        ctx.fillRect(0, y, W, textH)
        ctx.fillStyle = "#1a1a1a"
        ctx.font = "700 20px -apple-system, Arial, sans-serif"
        ctx.textBaseline = "top"
        const lines = wrapText(ctx, s.content, W - TEXT_PAD * 2)
        const blockH = lines.length * TEXT_LINE_H
        const startY = y + TEXT_PAD + Math.max(0, (textH - TEXT_PAD * 2 - blockH) / 2)
        lines.forEach((line, i) => ctx.fillText(line, TEXT_PAD, startY + i * TEXT_LINE_H))
        y += textH
      }
    }

    canvas.toBlob(blob => {
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${chain.owner.name.replace(/\s+/g, "-")}-telestration.png`
      a.click()
      URL.revokeObjectURL(url)
    }, "image/png")
  }

  // ── PokeSystem (rendered on every screen) ────────────────────────────────

  const pokeSystemNode = (footer = null) => me ? (
    <PokeSystem
      colors={POKE_COLORS}
      roomCode={code}
      currentPlayer={me.name}
      allPlayers={players.map(p => p.name)}
      playerDetails={players.map(p => ({ name: p.name, firstName: p.first_name, lastName: p.last_name }))}
      gamePhase={game?.phase}
      rules={instructions ? [["How to Play", instructions]] : null}
      onResetToLobby={async () => { await supabase.rpc("tel_reset_game", { p_code: code }) }}
    >{footer}</PokeSystem>
  ) : null

  // ── Loading ───────────────────────────────────────────────────────────────

  if (!game || !me) {
    return (
      <div style={{ minHeight: "100dvh", background: BG, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 18, fontWeight: 700 }}>Loading…</p>
      </div>
    )
  }

  async function pickNextGame(gameSub) {
    await supabase.from("tel_games").update({ next_game: gameSub }).eq("code", code)
  }

  // ── Finished ──────────────────────────────────────────────────────────────

  if (game.phase === "finished") {
    const modalChain = selectedChainOwner
      ? allChains.find(c => c.owner.id === selectedChainOwner)
      : null

    return (
      <>
      <div style={{ minHeight: "100dvh", background: BG, color: "white", paddingBottom: FOOTER_H }}>
        {/* Header */}
        <div style={{ padding: "36px 24px 24px", textAlign: "center" }}>
          <h1 style={{ fontSize: 32, fontWeight: 900, letterSpacing: "-1px", marginBottom: 8 }}>That's a wrap!</h1>
          <p style={{ fontSize: 16, opacity: 0.65, fontWeight: 500, marginBottom: 28 }}>This is your reminder to take screenshots.</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 360, margin: "0 auto" }}>
            <button
              onClick={() => supabase.rpc("tel_reset_game", { p_code: code })}
              style={{ background: YELLOW, color: "#000", fontSize: 16, fontWeight: 900, padding: "14px 24px", width: "100%" }}
            >Play Again</button>
            <button
              onClick={() => setShowGameModal(true)}
              style={{ background: "rgba(255,255,255,0.15)", color: "white", fontSize: 16, fontWeight: 700, padding: "14px 24px", width: "100%" }}
            >Play Another Game</button>
          </div>
        </div>

        {/* Telestration thumbnails */}
        <div style={{ padding: "0 24px 48px" }}>
          <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.15em", opacity: 0.4, marginBottom: 14 }}>
            All Telestrations
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 12 }}>
            {allChains.map(chain => {
              const firstDrawing = chain.steps.find(s => s.step_type === "drawing")
              const firstSentence = chain.steps.find(s => s.step_type === "text")
              return (
                <button
                  key={chain.owner.id}
                  onClick={() => setSelectedChainOwner(chain.owner.id)}
                  style={{
                    background: "rgba(255,255,255,0.08)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 10,
                    padding: 0,
                    overflow: "hidden",
                    textAlign: "left",
                    color: "white",
                    display: "block",
                  }}
                >
                  {firstDrawing && (
                    <img src={firstDrawing.content} alt="" style={{ width: "100%", display: "block" }} />
                  )}
                  <div style={{ padding: "8px 10px" }}>
                    <div style={{ fontSize: 12, fontWeight: 800, opacity: 0.5, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>
                      {chain.owner.name}
                    </div>
                    {firstSentence && (
                      <div style={{ fontSize: 12, fontWeight: 600, opacity: 0.85, lineHeight: 1.3 }}>
                        "{firstSentence.content}"
                      </div>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Play another game */}
        <div style={{ padding: "0 24px 48px" }}>
          <button onClick={() => setShowGameModal(true)}
            style={{ background: YELLOW, color: "#000", fontSize: 16, fontWeight: 900, padding: "14px 24px", width: "100%" }}>
            Play Another Game
          </button>
        </div>

        {/* Chain detail modal */}
        {modalChain && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 100, display: "flex", flexDirection: "column" }}>
            {/* Sticky header */}
            <div style={{ padding: "16px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0, borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
              <div style={{ fontSize: 20, fontWeight: 900, color: "white" }}>
                {modalChain.owner.name}'s telestration
              </div>
              <button
                onClick={() => setSelectedChainOwner(null)}
                style={{ background: "rgba(255,255,255,0.15)", color: "white", width: 36, height: 36, borderRadius: "50%", fontSize: 20, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
              >×</button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px 0" }}>
              <div style={{ maxWidth: 480, margin: "0 auto" }}>
                {modalChain.steps.map(s => {
                  const author = players.find(p => p.id === s.author_id)
                  return <RevealCard key={s.id} step={s} authorName={author?.name ?? "?"} />
                })}
                <div style={{ height: 24 }} />
              </div>
            </div>
            <div style={{ padding: "16px 24px", paddingBottom: "calc(16px + env(safe-area-inset-bottom))", background: "rgba(0,0,0,0.95)", borderTop: "1px solid rgba(255,255,255,0.12)" }}>
              <div style={{ maxWidth: 480, margin: "0 auto", display: "flex", flexDirection: "column", gap: 8 }}>
                <button
                  onClick={() => handleDownloadChainImage(modalChain)}
                  style={{ background: YELLOW, color: "#000", fontSize: 16, fontWeight: 900, padding: "16px", width: "100%", borderRadius: 8 }}
                >
                  Download as image
                </button>
                <button
                  onClick={() => setSelectedChainOwner(null)}
                  style={{ background: "rgba(255,255,255,0.15)", color: "white", fontSize: 16, fontWeight: 700, padding: "16px", width: "100%", borderRadius: 8 }}
                >Close</button>
              </div>
            </div>
          </div>
        )}
      </div>
      {pokeSystemNode()}
      {showGameModal && (
        <GameModal
          onClose={() => setShowGameModal(false)}
          onSelect={sub => pickNextGame(sub)}
          currentSub="telestrations"
        />
      )}
    </>
    )
  }

  // ── Reveal ────────────────────────────────────────────────────────────────

  if (game.phase === "reveal") {
    const allStepsRevealed = currentRevealStep >= n - 1
    const isLastChain = currentRevealChain >= revealOrder.length - 1

    // Waiting for presenter to start (step = -1, not presenter)
    if (currentRevealStep === -1 && !amPresenter) {
      return (
        <>
        <div style={{ minHeight: "100dvh", background: BG, color: "white", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 24px", textAlign: "center", paddingBottom: FOOTER_H }}>
          <div style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.18em", opacity: 0.5, marginBottom: 16 }}>
            REVEAL PHASE
          </div>
          <h2 style={{ fontSize: 28, fontWeight: 900, marginBottom: 8 }}>
            {currentPresenterPlayer?.name} is sharing their telestration!
          </h2>
          <p style={{ fontSize: 16, opacity: 0.55, fontWeight: 500 }}>Get ready…</p>
        </div>
        {pokeSystemNode()}
        </>
      )
    }

    // Presenter intro screen (step = -1, is presenter)
    if (currentRevealStep === -1 && amPresenter) {
      return (
        <>
        <div style={{ minHeight: "100dvh", background: BG, color: "white", display: "flex", flexDirection: "column", padding: "40px 24px", paddingBottom: FOOTER_H }}>
          <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.18em", opacity: 0.45, marginBottom: 8 }}>
            YOUR TELESTRATION
          </div>
          <h2 style={{ fontSize: 28, fontWeight: 900, marginBottom: 24, letterSpacing: "-0.5px" }}>It's your turn to share.</h2>
          <p style={{ fontSize: 16, opacity: 0.65, fontWeight: 500, marginBottom: 32 }}>
            Tap Reveal to show each step to the group, one at a time.
          </p>
          <button
            onClick={handleAdvanceReveal}
            disabled={advancing}
            style={{ background: YELLOW, color: "#000", fontSize: 22, fontWeight: 900, padding: "22px", width: "100%", display: "block", borderRadius: 8 }}
          >
            Reveal my telestration
          </button>
        </div>
        {pokeSystemNode()}
        </>
      )
    }

    // Audience view (active reveal)
    if (!amPresenter) {
      const visibleSteps = currentChainSteps.slice(0, currentRevealStep + 1)
      return (
        <>
        <div style={{ minHeight: "100dvh", background: BG, color: "white", paddingBottom: FOOTER_H }}>
          <div style={{ padding: "28px 24px 20px", background: "rgba(0,0,0,0.3)" }}>
            <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.18em", opacity: 0.45, marginBottom: 4 }}>
              CHAIN {currentRevealChain + 1} OF {n}
            </div>
            <div style={{ fontSize: 24, fontWeight: 900 }}>{currentPresenterPlayer?.name}'s telestration</div>
          </div>
          <div style={{ padding: "24px" }}>
            {visibleSteps.map(s => {
              const author = players.find(p => p.id === s.author_id)
              return <RevealCard key={s.id} step={s} authorName={author?.name ?? "?"} />
            })}
            {!allStepsRevealed && (
              <div style={{ fontSize: 16, opacity: 0.45, fontWeight: 600, textAlign: "center", marginTop: 24, padding: "16px" }}>
                Waiting for {currentPresenterPlayer?.name}…
              </div>
            )}
            <div ref={revealEndRef} />
          </div>
        </div>
        {pokeSystemNode()}
        </>
      )
    }

    // Presenter view (active reveal) — Reveal button overlaid on the next card
    return (
      <>
      <div style={{ minHeight: "100dvh", background: BG, color: "white", paddingBottom: allStepsRevealed ? FOOTER_H + 80 : FOOTER_H }}>
        <div style={{ padding: "28px 24px 20px", background: "rgba(0,0,0,0.3)" }}>
          <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.18em", opacity: 0.45, marginBottom: 4 }}>
            YOUR TELESTRATION
          </div>
          <div style={{ fontSize: 22, fontWeight: 900 }}>Tap Reveal to show each step.</div>
        </div>
        <div style={{ padding: "24px" }}>
          {currentChainSteps.map((s, i) => {
            const author = players.find(p => p.id === s.author_id)
            const isRevealed = i <= currentRevealStep
            const isNext = !allStepsRevealed && i === currentRevealStep + 1
            return (
              <div key={s.id} style={{ position: "relative", marginBottom: 4 }}>
                <div style={{ opacity: isRevealed ? 1 : 0.15, transition: "opacity 0.3s" }}>
                  <RevealCard step={s} authorName={author?.name ?? "?"} />
                </div>
                {isNext && (
                  <div style={{
                    position: "absolute", inset: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: "rgba(43,15,107,0.75)",
                    borderRadius: 10,
                  }}>
                    <button
                      onClick={handleAdvanceReveal}
                      disabled={advancing}
                      style={{ background: YELLOW, color: "#000", fontSize: 20, fontWeight: 900, padding: "16px 36px", borderRadius: 8 }}
                    >
                      Reveal
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <div ref={revealEndRef} />
      </div>
      {pokeSystemNode(
        allStepsRevealed
          ? <button onClick={handleNextChain} disabled={advancing} style={{ flex: 1, height: "100%", background: YELLOW, color: "#000", fontSize: 16, fontWeight: 900 }}>{isLastChain ? "Finish →" : "Next telestration →"}</button>
          : null
      )}
      </>
    )
  }

  // ── Play phase ────────────────────────────────────────────────────────────

  if (!myChainOwner) {
    return (
      <>
      <div style={{ minHeight: "100dvh", background: BG, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 18, fontWeight: 700 }}>Loading…</p>
      </div>
      {pokeSystemNode()}
      </>
    )
  }

  const isDrawingStep = currentStep % 2 === 1

  // Keep auto-submit ref pointed at the current submit function.
  // Don't auto-submit if the player hasn't drawn/written anything — just hide the timer.
  timedAutoSubmitRef.current = myStepSubmitted ? null : isDrawingStep
    ? (drawingDirty ? handleSubmitDrawing : null)
    : (sentenceRef.current.trim() ? () => handleSubmitSentence(sentenceRef.current.trim()) : null)

  const timerColor = timeLeft !== null && timeLeft <= 10 ? "#F04F52" : "rgba(255,255,255,0.65)"

  // Drawing step
  if (isDrawingStep) {
    const prompt = myPrevStepContent?.content ?? "…"
    const submittedPlayerIds = new Set(steps.filter(s => s.step_number === currentStep).map(s => s.author_id))

    if (myStepSubmitted) {
      const pendingDrawers = players.filter(p => !submittedPlayerIds.has(p.id))
      return (
        <>
        <div style={{ minHeight: "100dvh", background: BG, color: "white", display: "flex", flexDirection: "column", padding: "40px 24px", paddingBottom: FOOTER_H }}>
          <p style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>Drawing submitted.</p>
          <p style={{ fontSize: 16, opacity: 0.55, fontWeight: 500, marginBottom: 28 }}>Waiting for everyone else…</p>
          {timeLeft !== null && timeLeft <= 0 && pendingDrawers.length > 0 && (
            <p style={{ fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,0.65)", marginBottom: 16 }}>
              Waiting for {formatPendingNames(pendingDrawers)} to draw.
            </p>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {players.map(p => {
              const done = submittedPlayerIds.has(p.id)
              const isMe = p.id === myPlayerId
              return (
                <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(255,255,255,0.08)", padding: "12px 16px" }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: done ? "#12BAAA" : "rgba(255,255,255,0.2)", flexShrink: 0 }} />
                  <span style={{ fontSize: 16, fontWeight: 700, flex: 1 }}>
                    {p.name}
                    {isMe && <span style={{ fontSize: 11, opacity: 0.65, marginLeft: 6 }}>you</span>}
                  </span>
                  {!done && !isMe && (
                    pokeJustSent === p.name ? (
                      <span style={{ fontSize: 18, color: "#12BAAA", fontWeight: 700 }}>✓</span>
                    ) : !pokeCooldownActive ? (
                      <button onClick={() => sendInlinePoke(p.name)} style={{ background: "transparent", color: "rgba(255,255,255,0.55)", fontSize: 20, padding: "0 4px", lineHeight: 1 }}>👉</button>
                    ) : null
                  )}
                </div>
              )
            })}
          </div>
        </div>
        {pokeSystemNode()}
        </>
      )
    }

    return (
      <>
      <div style={{ height: "100dvh", background: BG, color: "white", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Compact header */}
        <div style={{ flexShrink: 0, padding: "12px 24px 10px" }}>
          <div style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.15em", opacity: 0.65, marginBottom: 6 }}>Draw this</div>
          <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.35 }}>{prompt}</div>
        </div>

        {/* Canvas — fills remaining space */}
        <div style={{ flex: 1, minHeight: 0 }}>
          <DrawingCanvas onExport={fn => { getDrawingRef.current = fn }} onFirstMark={() => setDrawingDirty(true)} />
        </div>

        {/* Submit */}
        <div style={{ flexShrink: 0, padding: "12px 24px", paddingBottom: BOTTOM_PAD }}>
          {timeLeft !== null && (timeLeft > 0 || drawingDirty) && (
            <p style={{ fontSize: 14, fontWeight: 800, color: timerColor, textAlign: "center", marginBottom: 8 }}>⏱ {timeLeft}s</p>
          )}
          <button
            onClick={handleSubmitDrawing}
            disabled={submitting}
            style={{ background: YELLOW, color: "#000", fontSize: 20, fontWeight: 900, padding: "20px", width: "100%", display: "block" }}
          >
            {submitting ? "Submitting…" : "Done drawing"}
          </button>
        </div>
      </div>
      {pokeSystemNode()}
      </>
    )
  }

  // Writing step
  const isFirstStep = currentStep === 0

  if (myStepSubmitted) {
    const submittedPlayerIds = new Set(steps.filter(s => s.step_number === currentStep).map(s => s.author_id))
    const pendingWriters = players.filter(p => !submittedPlayerIds.has(p.id))
    return (
      <>
      <div style={{ minHeight: "100dvh", background: BG, color: "white", display: "flex", flexDirection: "column", padding: "40px 24px", paddingBottom: FOOTER_H }}>
        <p style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>
          {isFirstStep ? "Sentence locked in." : "Answer locked in."}
        </p>
        <p style={{ fontSize: 16, opacity: 0.55, fontWeight: 500, marginBottom: 28 }}>Waiting for everyone else…</p>
        {timeLeft !== null && timeLeft <= 0 && pendingWriters.length > 0 && (
          <p style={{ fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,0.65)", marginBottom: 16 }}>
            Waiting for {formatPendingNames(pendingWriters)} to write.
          </p>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {players.map(p => {
            const done = submittedPlayerIds.has(p.id)
            const isMe = p.id === myPlayerId
            return (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(255,255,255,0.08)", padding: "12px 16px" }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: done ? "#12BAAA" : "rgba(255,255,255,0.2)", flexShrink: 0 }} />
                <span style={{ fontSize: 16, fontWeight: 700, flex: 1 }}>
                  {p.name}
                  {isMe && <span style={{ fontSize: 11, opacity: 0.65, marginLeft: 6 }}>you</span>}
                  {!done && typingPlayerIds.has(p.id) && <span style={{ fontSize: 14, marginLeft: 6 }}>💬</span>}
                </span>
                {!done && !isMe && (
                  pokeJustSent === p.name ? (
                    <span style={{ fontSize: 18, color: "#12BAAA", fontWeight: 700 }}>✓</span>
                  ) : !pokeCooldownActive ? (
                    <button onClick={() => sendInlinePoke(p.name)} style={{ background: "transparent", color: "rgba(255,255,255,0.55)", fontSize: 20, padding: "0 4px", lineHeight: 1 }}>👉</button>
                  ) : null
                )}
              </div>
            )
          })}
        </div>
      </div>
      {pokeSystemNode()}
      </>
    )
  }

  const drawingToDescribe = myPrevStepContent?.content ?? null

  return (
    <>
    <div style={{ minHeight: "100dvh", background: BG, color: "white" }}>
      <div style={{ padding: "28px 24px 0" }}>
        <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.18em", opacity: 0.45, marginBottom: 10 }}>
          {isFirstStep ? "WRITE A SENTENCE" : "WHAT IS THIS?"}
        </div>

        {isFirstStep && (
          <p style={{ fontSize: 16, opacity: 0.65, fontWeight: 500, marginBottom: 16 }}>
            The next person will draw this — keep it simple, or not.
          </p>
        )}

        {!isFirstStep && drawingToDescribe && (
          <div style={{ marginBottom: 16 }}>
            <img
              src={drawingToDescribe}
              alt="Drawing to describe"
              style={{ width: "100%", borderRadius: 8, display: "block", background: "#fff" }}
            />
          </div>
        )}

        {!isFirstStep && (
          <p style={{ fontSize: 16, opacity: 0.65, fontWeight: 500, marginBottom: 16 }}>
            Write what you think this drawing shows.
          </p>
        )}

        <textarea
          value={sentence}
          onChange={e => { setSentence(e.target.value); trackTyping() }}
          placeholder={isFirstStep ? 'e.g. "A squid getting sued"' : "Write what you see…"}
          maxLength={200}
          rows={3}
          style={{
            width: "100%",
            background: "rgba(255,255,255,0.15)",
            color: "white",
            fontSize: 18, fontWeight: 600,
            padding: "16px", resize: "none", borderRadius: 4, lineHeight: 1.45,
          }}
        />

        {timeLeft !== null && (timeLeft > 0 || sentence.trim()) && (
          <p style={{ fontSize: 14, fontWeight: 800, color: timerColor, marginTop: 8 }}>⏱ {timeLeft}s</p>
        )}
        <button
          onClick={() => handleSubmitSentence()}
          disabled={!sentence.trim() || submitting}
          style={{ background: YELLOW, color: "#000", fontSize: 20, fontWeight: 900, padding: "18px", width: "100%", marginTop: 8, display: "block", borderRadius: 8, animation: nudgeSentence ? "nudgePulse 1.0s ease-in-out infinite" : "none" }}
        >
          {submitting ? "Submitting…" : "Lock it in"}
        </button>

        {/* Random Ideas — first writing step only */}
        {isFirstStep && (
          <div style={{ marginTop: 20 }}>
            {shownIdeas.length < 9 ? (
              <button
                onClick={handleGetIdeas}
                disabled={loadingIdeas}
                style={{
                  background: "rgba(255,255,255,0.12)", color: "white",
                  fontSize: 15, fontWeight: 800, padding: "14px 18px",
                  width: "100%", marginBottom: shownIdeas.length ? 12 : 0, borderRadius: 6,
                }}
              >
                {shownIdeas.length === 0 ? "✦ Random ideas" : "✦ 3 more ideas"}
              </button>
            ) : (
              <div style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.25)", padding: "12px 18px", background: "rgba(255,255,255,0.05)", borderRadius: 6, marginBottom: 12 }}>
                No more ideas
              </div>
            )}

            {shownIdeas.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, paddingBottom: 24 }}>
                {shownIdeas.map((idea, i) => (
                  <div
                    key={i}
                    style={{
                      padding: "7px 14px", borderRadius: 999,
                      fontSize: 14, fontWeight: 700,
                      background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.65)",
                      border: "1px solid rgba(255,255,255,0.12)",
                    }}
                  >
                    {idea}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div style={{ height: 40 }} />
      </div>
    </div>
    {pokeSystemNode()}
    </>
  )
}
