"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "../../../lib/supabase"

const BG = "#2B0F6B"
const YELLOW = "#FBDF54"

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
  const d = imageData.data
  const w = imageData.width
  const h = imageData.height
  if (startX < 0 || startY < 0 || startX >= w || startY >= h) return
  const [fr, fg, fb] = hexToRgb(fillHex)
  const si = (startY * w + startX) * 4
  const tr = d[si], tg = d[si+1], tb = d[si+2]
  if (tr === fr && tg === fg && tb === fb) return
  const stack = [startY * w + startX]
  const visited = new Uint8Array(w * h)
  const tol = 40
  while (stack.length) {
    const p = stack.pop()
    if (p < 0 || p >= w * h || visited[p]) continue
    const i = p * 4
    if (Math.abs(d[i]-tr) > tol || Math.abs(d[i+1]-tg) > tol || Math.abs(d[i+2]-tb) > tol) continue
    visited[p] = 1
    d[i] = fr; d[i+1] = fg; d[i+2] = fb; d[i+3] = 255
    const x = p % w, y = Math.floor(p / w)
    if (x > 0) stack.push(p-1)
    if (x < w-1) stack.push(p+1)
    if (y > 0) stack.push(p-w)
    if (y < h-1) stack.push(p+w)
  }
}

// ─── DrawingCanvas ────────────────────────────────────────────────────────────

function DrawingCanvas({ onExport }) {
  const containerRef = useRef(null)
  const canvasRef = useRef(null)
  const fabricRef = useRef(null)
  const fabricLibRef = useRef(null)
  const historyRef = useRef([])
  const redoStackRef = useRef([])
  const onExportRef = useRef(onExport)
  onExportRef.current = onExport

  const [color, setColorState] = useState("#000000")
  const [brushSize, setBrushSize] = useState(8)
  const [toolMode, setToolModeState] = useState("pen") // "pen" | "eraser" | "bucket"

  const colorRef = useRef("#000000")
  colorRef.current = color
  const toolModeRef = useRef("pen")
  toolModeRef.current = toolMode
  const brushSizeRef = useRef(8)
  brushSizeRef.current = brushSize

  const doBucketFill = useCallback(async (x, y) => {
    const cv = fabricRef.current
    const fabricLib = fabricLibRef.current
    if (!cv || !fabricLib) return
    const dataUrl = cv.toDataURL({ format: "png" })
    await new Promise(resolve => {
      const img = new Image()
      img.onload = () => {
        const off = document.createElement("canvas")
        off.width = cv.width
        off.height = cv.height
        const ctx = off.getContext("2d")
        ctx.drawImage(img, 0, 0)
        const imgData = ctx.getImageData(0, 0, off.width, off.height)
        floodFillImageData(imgData, x, y, colorRef.current)
        ctx.putImageData(imgData, 0, 0)
        const filledUrl = off.toDataURL()
        fabricLib.Image.fromURL(filledUrl, (fabricImg) => {
          cv.clear()
          cv.backgroundColor = "#ffffff"
          fabricImg.set({ selectable: false, evented: false, left: 0, top: 0, scaleX: 1, scaleY: 1 })
          cv.add(fabricImg)
          cv.renderAll()
          historyRef.current.push(JSON.stringify(cv.toJSON()))
          redoStackRef.current = []
          resolve()
        })
      }
      img.src = dataUrl
    })
  }, [])

  const doBucketFillRef = useRef(doBucketFill)
  doBucketFillRef.current = doBucketFill

  useEffect(() => {
    let canvas
    let cancelled = false

    ;(async () => {
      const { fabric } = await import("fabric")
      if (cancelled || !canvasRef.current) return

      fabricLibRef.current = fabric

      const w = containerRef.current.clientWidth
      const h = Math.round(w * 0.72)

      canvas = new fabric.Canvas(canvasRef.current, {
        isDrawingMode: true,
        width: w,
        height: h,
        backgroundColor: "#ffffff",
      })

      canvas.freeDrawingBrush.color = "#000000"
      canvas.freeDrawingBrush.width = 8

      canvas.on("path:created", () => {
        historyRef.current.push(JSON.stringify(canvas.toJSON()))
        redoStackRef.current = []
      })

      canvas.on("mouse:down", (opt) => {
        if (toolModeRef.current !== "bucket") return
        const p = canvas.getPointer(opt.e)
        doBucketFillRef.current(Math.round(p.x), Math.round(p.y))
      })

      fabricRef.current = canvas
    })()

    return () => {
      cancelled = true
      fabricRef.current?.dispose()
      fabricRef.current = null
    }
  }, [])

  function applyBrush(newColor, newSize, isEraser) {
    const cv = fabricRef.current
    if (!cv) return
    cv.freeDrawingBrush.color = isEraser ? "#ffffff" : newColor
    cv.freeDrawingBrush.width = newSize
  }

  function handleColorClick(c) {
    setColorState(c)
    if (toolMode === "bucket") return
    const nextMode = toolMode === "eraser" ? "pen" : toolMode
    if (nextMode !== toolMode) setToolModeState(nextMode)
    const cv = fabricRef.current
    if (cv) cv.isDrawingMode = true
    applyBrush(c, brushSizeRef.current, false)
  }

  function handleSetTool(mode) {
    setToolModeState(mode)
    const cv = fabricRef.current
    if (!cv) return
    cv.isDrawingMode = (mode !== "bucket")
    if (mode !== "bucket") {
      applyBrush(colorRef.current, brushSizeRef.current, mode === "eraser")
    }
  }

  function handleSizeChange(newSize) {
    setBrushSize(newSize)
    applyBrush(colorRef.current, newSize, toolMode === "eraser")
  }

  function handleUndo() {
    const hist = historyRef.current
    if (!hist.length) return
    const last = hist.pop()
    redoStackRef.current.push(last)
    const cv = fabricRef.current
    if (!cv) return
    if (hist.length === 0) {
      cv.clear(); cv.backgroundColor = "#ffffff"; cv.renderAll()
    } else {
      cv.loadFromJSON(JSON.parse(hist[hist.length - 1]), () => cv.renderAll())
    }
  }

  function handleRedo() {
    const redo = redoStackRef.current
    if (!redo.length) return
    const state = redo.pop()
    historyRef.current.push(state)
    const cv = fabricRef.current
    if (!cv) return
    cv.loadFromJSON(JSON.parse(state), () => cv.renderAll())
  }

  function handleClear() {
    historyRef.current = []
    redoStackRef.current = []
    const cv = fabricRef.current
    if (!cv) return
    cv.clear(); cv.backgroundColor = "#ffffff"; cv.renderAll()
  }

  function getDataUrl() {
    if (!fabricRef.current) return null
    return fabricRef.current.toDataURL({ format: "jpeg", quality: 0.72 })
  }

  useEffect(() => {
    if (onExportRef.current) onExportRef.current(() => getDataUrl())
  }, [])

  const maxSize = toolMode === "eraser" ? 100 : 80

  return (
    <div>
      {/* Tool buttons */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 0 8px", flexWrap: "wrap" }}>
        <button
          onClick={() => handleSetTool(toolMode === "eraser" ? "pen" : "eraser")}
          style={{
            background: toolMode === "eraser" ? YELLOW : "rgba(255,255,255,0.15)",
            color: toolMode === "eraser" ? "#000" : "white",
            fontSize: 13, fontWeight: 800, padding: "8px 12px", borderRadius: 6, flexShrink: 0,
          }}
        >Eraser</button>
        <button
          onClick={() => handleSetTool(toolMode === "bucket" ? "pen" : "bucket")}
          style={{
            background: toolMode === "bucket" ? YELLOW : "rgba(255,255,255,0.15)",
            color: toolMode === "bucket" ? "#000" : "white",
            fontSize: 13, fontWeight: 800, padding: "8px 12px", borderRadius: 6, flexShrink: 0,
          }}
        >Fill</button>
        <button
          onClick={handleUndo}
          style={{ background: "rgba(255,255,255,0.15)", color: "white", fontSize: 13, fontWeight: 800, padding: "8px 12px", borderRadius: 6, flexShrink: 0 }}
        >Undo</button>
        <button
          onClick={handleRedo}
          style={{ background: "rgba(255,255,255,0.15)", color: "white", fontSize: 13, fontWeight: 800, padding: "8px 12px", borderRadius: 6, flexShrink: 0 }}
        >Redo</button>
        <button
          onClick={handleClear}
          style={{ background: "rgba(255,255,255,0.10)", color: "rgba(255,255,255,0.6)", fontSize: 13, fontWeight: 800, padding: "8px 12px", borderRadius: 6, flexShrink: 0 }}
        >Clear</button>
      </div>

      {/* Brush size slider */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.5)", flexShrink: 0 }}>Size</span>
        <input
          type="range"
          min={1}
          max={maxSize}
          value={Math.min(brushSize, maxSize)}
          onChange={e => handleSizeChange(Number(e.target.value))}
          style={{ flex: 1, accentColor: YELLOW, height: 4 }}
        />
        <span style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.5)", minWidth: 28, textAlign: "right" }}>{Math.min(brushSize, maxSize)}</span>
      </div>

      {/* Color palette */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 10 }}>
        {PALETTE.map(c => (
          <button
            key={c}
            onClick={() => handleColorClick(c)}
            style={{
              width: 28, height: 28, borderRadius: 5, background: c, flexShrink: 0,
              border: color === c && toolMode !== "eraser"
                ? "3px solid white"
                : c === "#FFFFFF" || c === "#DDDDDD"
                  ? "1px solid rgba(255,255,255,0.25)"
                  : "2px solid transparent",
            }}
          />
        ))}
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        style={{ width: "100%", borderRadius: 8, overflow: "hidden", background: "#fff", cursor: toolMode === "bucket" ? "crosshair" : "default" }}
      >
        <canvas ref={canvasRef} style={{ display: "block", touchAction: "none" }} />
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
  const [ideasPhase, setIdeasPhase] = useState("none") // "none" | "first" | "done"
  const [loadingIdeas, setLoadingIdeas] = useState(false)

  // Drawing phase
  const getDrawingRef = useRef(null)

  // Reveal phase
  const [advancing, setAdvancing] = useState(false)

  // Finished screen
  const [selectedChainOwner, setSelectedChainOwner] = useState(null)

  const me = players.find(p => p.id === myPlayerId)

  async function loadState() {
    const { data: gameData } = await supabase
      .from("tel_games").select("*").eq("code", code).single()

    if (!gameData) { router.replace(`/${code}`); return }
    if (gameData.phase === "lobby") { router.replace(`/${code}`); return }

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
    const poll = setInterval(loadState, 1500)

    const channel = supabase.channel(`tel-play-${code}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tel_games", filter: `code=eq.${code}` }, loadState)
      .on("postgres_changes", { event: "*", schema: "public", table: "tel_steps", filter: `game_code=eq.${code}` }, loadState)
      .subscribe()

    return () => { clearInterval(poll); supabase.removeChannel(channel) }
  }, [code])

  // ── Derived state (must come before any useEffect that references these) ──

  const n = game?.total_steps ?? 0
  const currentStep = game?.current_step ?? 0

  const myChainOwner = useMemo(() => {
    if (!me || n === 0) return null
    const ownerSeat = ((me.seat - currentStep) % n + n) % n
    return players.find(p => p.seat === ownerSeat) ?? null
  }, [me, currentStep, n, players])

  const myPrevStepContent = useMemo(() => {
    if (!myChainOwner || currentStep === 0) return null
    return steps.find(s => s.chain_owner_id === myChainOwner.id && s.step_number === currentStep - 1) ?? null
  }, [myChainOwner, currentStep, steps])

  const myStepSubmitted = useMemo(() => {
    if (!myChainOwner || !me) return false
    return steps.some(s => s.chain_owner_id === myChainOwner.id && s.step_number === currentStep && s.author_id === me.id)
  }, [myChainOwner, currentStep, steps, me])

  const submittedCount = useMemo(() => {
    return steps.filter(s => s.step_number === currentStep).length
  }, [steps, currentStep])

  const revealOrder = game?.reveal_order ?? []
  const currentRevealChain = game?.current_reveal_chain ?? 0
  const currentRevealStep = game?.current_reveal_step ?? -1

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

  async function handleSubmitSentence() {
    if (!sentence.trim() || !myChainOwner || submitting || myStepSubmitted) return
    setSubmitting(true)
    try {
      await submitStep(myChainOwner.id, currentStep, "text", sentence.trim())
      setSentence("")
    } catch (e) {
      alert("Error submitting: " + e.message)
    }
    setSubmitting(false)
  }

  async function handleSubmitDrawing() {
    if (!myChainOwner || submitting || myStepSubmitted) return
    const getDataUrl = getDrawingRef.current
    if (!getDataUrl) { alert("Canvas not ready"); return }
    const dataUrl = getDataUrl()
    if (!dataUrl) { alert("Canvas not ready"); return }
    setSubmitting(true)
    try {
      await submitStep(myChainOwner.id, currentStep, "drawing", dataUrl)
    } catch (e) {
      alert("Error submitting: " + e.message)
    }
    setSubmitting(false)
  }

  async function handleGetIdeas() {
    if (loadingIdeas || ideasPhase === "done") return
    setLoadingIdeas(true)
    const count = ideasPhase === "none" ? 3 : 2
    const { data } = await supabase.rpc("get_random_ideas", {
      p_count: count,
      p_exclude: shownIdeas,
    })
    if (data) setShownIdeas(prev => [...prev, ...data])
    setIdeasPhase(ideasPhase === "none" ? "first" : "done")
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

  async function handlePlayAgain() {
    await supabase.rpc("tel_reset_game", { p_code: code })
    router.replace(`/${code}`)
  }

  // ── Loading ───────────────────────────────────────────────────────────────

  if (!game || !me) {
    return (
      <div style={{ minHeight: "100dvh", background: BG, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 18, fontWeight: 700 }}>Loading…</p>
      </div>
    )
  }

  // ── Finished ──────────────────────────────────────────────────────────────

  if (game.phase === "finished") {
    const modalChain = selectedChainOwner
      ? allChains.find(c => c.owner.id === selectedChainOwner)
      : null

    return (
      <div style={{ minHeight: "100dvh", background: BG, color: "white" }}>
        {/* Header */}
        <div style={{ padding: "36px 24px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🎨</div>
          <h1 style={{ fontSize: 32, fontWeight: 900, letterSpacing: "-1px", marginBottom: 8 }}>That's a wrap!</h1>
          <p style={{ fontSize: 16, opacity: 0.65, fontWeight: 500, marginBottom: 28 }}>This is your reminder to take screenshots.</p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
            <button
              onClick={handlePlayAgain}
              style={{ background: YELLOW, color: "#000", fontSize: 18, fontWeight: 900, padding: "16px 28px", borderRadius: 8 }}
            >Play again</button>
            <button
              onClick={() => router.replace(`/${code}`)}
              style={{ background: "rgba(255,255,255,0.12)", color: "white", fontSize: 16, fontWeight: 700, padding: "16px 20px", borderRadius: 8 }}
            >Back to lobby</button>
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

        {/* Chain detail modal */}
        {modalChain && (
          <div
            onClick={() => setSelectedChainOwner(null)}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 100, overflowY: "auto", padding: "24px" }}
          >
            <div onClick={e => e.stopPropagation()} style={{ maxWidth: 480, margin: "0 auto" }}>
              <div style={{ fontSize: 22, fontWeight: 900, color: "white", marginBottom: 20 }}>
                {modalChain.owner.name}'s telestration
              </div>
              {modalChain.steps.map(s => {
                const author = players.find(p => p.id === s.author_id)
                return <RevealCard key={s.id} step={s} authorName={author?.name ?? "?"} />
              })}
              <button
                onClick={() => setSelectedChainOwner(null)}
                style={{ background: "rgba(255,255,255,0.15)", color: "white", fontSize: 16, fontWeight: 700, padding: "16px", width: "100%", marginTop: 16, borderRadius: 8 }}
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── Reveal ────────────────────────────────────────────────────────────────

  if (game.phase === "reveal") {
    const allStepsRevealed = currentRevealStep >= n - 1
    const isLastChain = currentRevealChain >= revealOrder.length - 1

    // Waiting for presenter to start (step = -1, not presenter)
    if (currentRevealStep === -1 && !amPresenter) {
      return (
        <div style={{ minHeight: "100dvh", background: BG, color: "white", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.18em", opacity: 0.5, marginBottom: 16 }}>
            REVEAL PHASE
          </div>
          <h2 style={{ fontSize: 28, fontWeight: 900, marginBottom: 8 }}>
            {currentPresenterPlayer?.name} is sharing their telestration!
          </h2>
          <p style={{ fontSize: 16, opacity: 0.55, fontWeight: 500 }}>Get ready…</p>
        </div>
      )
    }

    // Presenter intro screen (step = -1, is presenter)
    if (currentRevealStep === -1 && amPresenter) {
      return (
        <div style={{ minHeight: "100dvh", background: BG, color: "white", display: "flex", flexDirection: "column", padding: "40px 24px" }}>
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
      )
    }

    // Audience view (active reveal)
    if (!amPresenter) {
      const visibleSteps = currentChainSteps.slice(0, currentRevealStep + 1)
      return (
        <div style={{ minHeight: "100dvh", background: BG, color: "white" }}>
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
          </div>
        </div>
      )
    }

    // Presenter view (active reveal) — Reveal button overlaid on the next card
    return (
      <div style={{ minHeight: "100dvh", background: BG, color: "white" }}>
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

          {allStepsRevealed && (
            <div style={{ marginTop: 24 }}>
              <button
                onClick={handleNextChain}
                disabled={advancing}
                style={{ background: "rgba(255,255,255,0.2)", color: "white", fontSize: 18, fontWeight: 900, padding: "20px", width: "100%", display: "block", borderRadius: 8 }}
              >
                {isLastChain ? "Finish →" : "Next telestration →"}
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Play phase ────────────────────────────────────────────────────────────

  if (!myChainOwner) {
    return (
      <div style={{ minHeight: "100dvh", background: BG, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 18, fontWeight: 700 }}>Loading…</p>
      </div>
    )
  }

  const isDrawingStep = currentStep % 2 === 1
  const stepProgress = `${submittedCount} of ${n} done`

  // Drawing step
  if (isDrawingStep) {
    const prompt = myPrevStepContent?.content ?? "…"

    if (myStepSubmitted) {
      return (
        <div style={{ minHeight: "100dvh", background: BG, color: "white", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 24px", textAlign: "center" }}>
          <p style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>Drawing submitted.</p>
          <p style={{ fontSize: 16, opacity: 0.55, fontWeight: 500, marginBottom: 24 }}>Waiting for everyone else…</p>
          <p style={{ fontSize: 13, opacity: 0.35, fontWeight: 700 }}>{stepProgress}</p>
        </div>
      )
    }

    return (
      <div style={{ minHeight: "100dvh", background: BG, color: "white" }}>
        <div style={{ padding: "24px 24px 12px" }}>
          <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.18em", opacity: 0.45, marginBottom: 10 }}>
            DRAW THIS
          </div>
          <div style={{
            fontSize: 20, fontWeight: 800, lineHeight: 1.35,
            background: "rgba(255,255,255,0.1)", padding: "14px 16px", borderRadius: 8, marginBottom: 4,
          }}>
            {prompt}
          </div>
        </div>
        <div style={{ padding: "0 24px 24px" }}>
          <DrawingCanvas onExport={fn => { getDrawingRef.current = fn }} />
          <button
            onClick={handleSubmitDrawing}
            disabled={submitting}
            style={{ background: YELLOW, color: "#000", fontSize: 20, fontWeight: 900, padding: "20px", width: "100%", display: "block", marginTop: 16, borderRadius: 8 }}
          >
            {submitting ? "Submitting…" : "Done drawing"}
          </button>
        </div>
      </div>
    )
  }

  // Writing step
  const isFirstStep = currentStep === 0

  if (myStepSubmitted) {
    return (
      <div style={{ minHeight: "100dvh", background: BG, color: "white", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 24px", textAlign: "center" }}>
        <p style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>
          {isFirstStep ? "Sentence locked in." : "Answer locked in."}
        </p>
        <p style={{ fontSize: 16, opacity: 0.55, fontWeight: 500, marginBottom: 24 }}>Waiting for everyone else…</p>
        <p style={{ fontSize: 13, opacity: 0.35, fontWeight: 700 }}>{stepProgress}</p>
      </div>
    )
  }

  const drawingToDescribe = myPrevStepContent?.content ?? null

  return (
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
          onChange={e => setSentence(e.target.value)}
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

        <button
          onClick={handleSubmitSentence}
          disabled={!sentence.trim() || submitting}
          style={{ background: YELLOW, color: "#000", fontSize: 20, fontWeight: 900, padding: "18px", width: "100%", marginTop: 8, display: "block", borderRadius: 8 }}
        >
          {submitting ? "Submitting…" : "Lock it in"}
        </button>

        {/* Random Ideas — first writing step only */}
        {isFirstStep && (
          <div style={{ marginTop: 20 }}>
            {ideasPhase !== "done" ? (
              <button
                onClick={handleGetIdeas}
                disabled={loadingIdeas}
                style={{
                  background: "rgba(255,255,255,0.12)", color: "white",
                  fontSize: 15, fontWeight: 800, padding: "14px 18px",
                  width: "100%", marginBottom: shownIdeas.length ? 12 : 0, borderRadius: 6,
                }}
              >
                {ideasPhase === "none" ? "✦ Random ideas" : "✦ 2 more ideas"}
              </button>
            ) : (
              <div style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.25)", padding: "12px 18px", background: "rgba(255,255,255,0.05)", borderRadius: 6 }}>
                No more ideas
              </div>
            )}

            {shownIdeas.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, paddingBottom: 24 }}>
                {shownIdeas.map((idea, i) => (
                  <button
                    key={i}
                    onClick={() => setSentence(prev => prev ? prev + " " + idea : idea)}
                    style={{
                      padding: "7px 14px", borderRadius: 999,
                      fontSize: 14, fontWeight: 700,
                      background: "rgba(255,255,255,0.1)", color: "white",
                      border: "1px solid rgba(255,255,255,0.15)",
                    }}
                  >
                    {idea}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div style={{ height: 40 }} />
      </div>
    </div>
  )
}
