"use client"

import { useEffect, useMemo, useRef, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "../../../lib/supabase"

const BG = "#2B0F6B"
const YELLOW = "#FBDF54"

const PALETTE = [
  "#000000","#555555","#AAAAAA","#FFFFFF",
  "#E53935","#FB8C00","#FDD835","#C0CA33",
  "#43A047","#00897B","#039BE5","#1E88E5",
  "#3949AB","#8E24AA","#D81B60","#FDDBB4",
  "#D4956A","#8D5524","#6D4C41","#A1887F",
]

const BRUSH_SIZES = [3, 8, 20]
const ERASER_SIZES = [12, 24, 48]

// ─── Drawing Canvas ────────────────────────────────────────────────────────

function DrawingCanvas({ onExport }) {
  const containerRef = useRef(null)
  const canvasRef = useRef(null)
  const fabricRef = useRef(null)
  const historyRef = useRef([])
  const onExportRef = useRef(onExport)
  onExportRef.current = onExport

  const [color, setColorState] = useState("#000000")
  const [brushSizeIdx, setBrushSizeIdx] = useState(1)
  const [isEraser, setIsEraser] = useState(false)

  useEffect(() => {
    let canvas
    let cancelled = false

    ;(async () => {
      const { fabric } = await import("fabric")
      if (cancelled || !canvasRef.current) return

      const w = containerRef.current.clientWidth
      const h = Math.round(w * 0.72)

      canvas = new fabric.Canvas(canvasRef.current, {
        isDrawingMode: true,
        width: w,
        height: h,
        backgroundColor: "#ffffff",
      })

      canvas.freeDrawingBrush.color = "#000000"
      canvas.freeDrawingBrush.width = BRUSH_SIZES[1]

      canvas.on("path:created", () => {
        historyRef.current.push(JSON.stringify(canvas.toJSON()))
      })

      fabricRef.current = canvas
    })()

    return () => {
      cancelled = true
      fabricRef.current?.dispose()
      fabricRef.current = null
    }
  }, [])

  function applyBrush(newColor, newSizeIdx, newIsEraser) {
    const cv = fabricRef.current
    if (!cv) return
    const sizes = newIsEraser ? ERASER_SIZES : BRUSH_SIZES
    cv.freeDrawingBrush.color = newIsEraser ? "#ffffff" : newColor
    cv.freeDrawingBrush.width = sizes[newSizeIdx]
  }

  function handleColorClick(c) {
    setColorState(c)
    setIsEraser(false)
    applyBrush(c, brushSizeIdx, false)
  }

  function handleSizeChange(idx) {
    setBrushSizeIdx(idx)
    applyBrush(color, idx, isEraser)
  }

  function handleEraserToggle() {
    const next = !isEraser
    setIsEraser(next)
    applyBrush(color, brushSizeIdx, next)
  }

  function handleUndo() {
    const hist = historyRef.current
    hist.pop()
    const cv = fabricRef.current
    if (!cv) return
    if (hist.length === 0) {
      cv.clear()
      cv.backgroundColor = "#ffffff"
      cv.renderAll()
    } else {
      cv.loadFromJSON(JSON.parse(hist[hist.length - 1]), () => cv.renderAll())
    }
  }

  function handleClear() {
    historyRef.current = []
    const cv = fabricRef.current
    if (!cv) return
    cv.clear()
    cv.backgroundColor = "#ffffff"
    cv.renderAll()
  }

  function getDataUrl() {
    if (!fabricRef.current) return null
    return fabricRef.current.toDataURL({ format: "jpeg", quality: 0.72 })
  }

  // Expose export function to parent via ref callback
  useEffect(() => {
    if (onExportRef.current) {
      onExportRef.current(() => getDataUrl())
    }
  }, [])

  const sizeLabels = ["S", "M", "L"]

  return (
    <div>
      {/* Toolbar */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 0 10px",
        flexWrap: "wrap",
      }}>
        {/* Pen / Eraser toggle */}
        <button
          onClick={handleEraserToggle}
          style={{
            background: isEraser ? YELLOW : "rgba(255,255,255,0.15)",
            color: isEraser ? "#000" : "white",
            fontSize: 13,
            fontWeight: 800,
            padding: "8px 14px",
            borderRadius: 6,
            flexShrink: 0,
          }}
        >
          {isEraser ? "Eraser ✓" : "Eraser"}
        </button>

        {/* Undo */}
        <button
          onClick={handleUndo}
          style={{
            background: "rgba(255,255,255,0.15)",
            color: "white",
            fontSize: 13,
            fontWeight: 800,
            padding: "8px 14px",
            borderRadius: 6,
            flexShrink: 0,
          }}
        >
          Undo
        </button>

        {/* Clear */}
        <button
          onClick={handleClear}
          style={{
            background: "rgba(255,255,255,0.10)",
            color: "rgba(255,255,255,0.6)",
            fontSize: 13,
            fontWeight: 800,
            padding: "8px 14px",
            borderRadius: 6,
            flexShrink: 0,
          }}
        >
          Clear
        </button>

        {/* Size buttons */}
        <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
          {sizeLabels.map((lbl, i) => (
            <button
              key={i}
              onClick={() => handleSizeChange(i)}
              style={{
                background: brushSizeIdx === i ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.12)",
                color: "white",
                fontWeight: 900,
                fontSize: 12,
                width: 34,
                height: 34,
                borderRadius: 6,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {/* Color palette */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        {PALETTE.map(c => (
          <button
            key={c}
            onClick={() => handleColorClick(c)}
            style={{
              width: 30,
              height: 30,
              borderRadius: 6,
              background: c,
              border: color === c && !isEraser
                ? "3px solid white"
                : c === "#FFFFFF" ? "1px solid rgba(255,255,255,0.3)" : "2px solid transparent",
              flexShrink: 0,
            }}
          />
        ))}
      </div>

      {/* Canvas */}
      <div ref={containerRef} style={{ width: "100%", borderRadius: 8, overflow: "hidden", background: "#fff" }}>
        <canvas ref={canvasRef} style={{ display: "block", touchAction: "none" }} />
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────

export default function Play({ params }) {
  const router = useRouter()
  const code = useMemo(() => params.code.toUpperCase(), [params.code])

  const [game, setGame] = useState(null)
  const [players, setPlayers] = useState([])
  const [steps, setSteps] = useState([])
  const [myPlayerId, setMyPlayerId] = useState(null)

  // Writing phase state
  const [sentence, setSentence] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [shownIdeas, setShownIdeas] = useState([])
  const [loadingIdeas, setLoadingIdeas] = useState(false)

  // Drawing phase state
  const getDrawingRef = useRef(null)

  // Reveal phase state
  const [advancing, setAdvancing] = useState(false)

  const me = players.find(p => p.id === myPlayerId)

  async function loadState() {
    const { data: gameData } = await supabase
      .from("tel_games")
      .select("*")
      .eq("code", code)
      .single()

    if (!gameData) { router.replace(`/${code}`); return }
    if (gameData.phase === "lobby") { router.replace(`/${code}`); return }

    const { data: playerData } = await supabase
      .from("tel_players")
      .select("id,name,first_name,seat,is_bot")
      .eq("game_code", code)
      .order("seat", { ascending: true })

    const { data: stepData } = await supabase
      .from("tel_steps")
      .select("id,chain_owner_id,step_number,step_type,content,author_id")
      .eq("game_code", code)
      .order("step_number", { ascending: true })

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

  // ── Derived state ─────────────────────────────────────────────────────

  const n = game?.total_steps ?? 0
  const currentStep = game?.current_step ?? 0

  // Which chain does my player hold at currentStep?
  const myChainOwner = useMemo(() => {
    if (!me || n === 0) return null
    const ownerSeat = ((me.seat - currentStep) % n + n) % n
    return players.find(p => p.seat === ownerSeat) ?? null
  }, [me, currentStep, n, players])

  // Content from the previous step in my current chain (what I'm working from)
  const myPrevStepContent = useMemo(() => {
    if (!myChainOwner || currentStep === 0) return null
    return steps.find(s => s.chain_owner_id === myChainOwner.id && s.step_number === currentStep - 1) ?? null
  }, [myChainOwner, currentStep, steps])

  // Have I already submitted the current step?
  const myStepSubmitted = useMemo(() => {
    if (!myChainOwner || !me) return false
    return steps.some(s => s.chain_owner_id === myChainOwner.id && s.step_number === currentStep && s.author_id === me.id)
  }, [myChainOwner, currentStep, steps, me])

  // How many submissions are in for the current step?
  const submittedCount = useMemo(() => {
    return steps.filter(s => s.step_number === currentStep).length
  }, [steps, currentStep])

  // Reveal state
  const revealOrder = game?.reveal_order ?? []
  const currentRevealChain = game?.current_reveal_chain ?? 0
  const currentRevealStep = game?.current_reveal_step ?? -1

  const currentPresenterPlayer = useMemo(() => {
    if (!revealOrder.length || !players.length) return null
    return players.find(p => p.id === revealOrder[currentRevealChain]) ?? null
  }, [revealOrder, currentRevealChain, players])

  const amPresenter = me && currentPresenterPlayer && me.id === currentPresenterPlayer.id

  const currentChainSteps = useMemo(() => {
    if (!currentPresenterPlayer) return []
    return steps
      .filter(s => s.chain_owner_id === currentPresenterPlayer.id)
      .sort((a, b) => a.step_number - b.step_number)
  }, [currentPresenterPlayer, steps])

  // ── Submit helpers ─────────────────────────────────────────────────────

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
    if (loadingIdeas) return
    setLoadingIdeas(true)
    const { data } = await supabase.rpc("get_random_ideas", {
      p_count: 6,
      p_exclude: shownIdeas,
    })
    if (data) setShownIdeas(prev => [...prev, ...data])
    setLoadingIdeas(false)
  }

  async function handleAdvanceReveal() {
    if (advancing) return
    setAdvancing(true)
    const newStep = currentRevealStep + 1
    await supabase.rpc("tel_advance_reveal", {
      p_code: code,
      p_new_reveal_step: newStep,
      p_new_reveal_chain: currentRevealChain,
    })
    await loadState()
    setAdvancing(false)
  }

  async function handleNextChain() {
    if (advancing) return
    setAdvancing(true)
    const newChain = currentRevealChain + 1
    await supabase.rpc("tel_advance_reveal", {
      p_code: code,
      p_new_reveal_step: -1,
      p_new_reveal_chain: newChain,
    })
    await loadState()
    setAdvancing(false)
  }

  async function handlePlayAgain() {
    await supabase.rpc("tel_reset_game", { p_code: code })
    router.replace(`/${code}`)
  }

  // ── Loading / waiting ──────────────────────────────────────────────────

  if (!game || !me) {
    return (
      <div style={{ minHeight: "100dvh", background: BG, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 18, fontWeight: 700 }}>Loading…</p>
      </div>
    )
  }

  // ── Finished ───────────────────────────────────────────────────────────

  if (game.phase === "finished") {
    return (
      <div style={{ minHeight: "100dvh", background: BG, color: "white", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 24px", textAlign: "center" }}>
        <div style={{ fontSize: 56, marginBottom: 16 }}>🎨</div>
        <h1 style={{ fontSize: 36, fontWeight: 900, letterSpacing: "-1px", marginBottom: 12 }}>That's a wrap!</h1>
        <p style={{ fontSize: 17, opacity: 0.65, fontWeight: 500, marginBottom: 48 }}>This is your reminder to take screenshots.</p>
        <button
          onClick={handlePlayAgain}
          style={{ background: YELLOW, color: "#000", fontSize: 22, fontWeight: 900, padding: "22px 40px", width: "100%", maxWidth: 360, display: "block" }}
        >
          Play again
        </button>
        <button
          onClick={() => router.replace(`/${code}`)}
          style={{ background: "rgba(255,255,255,0.12)", color: "white", fontSize: 16, fontWeight: 700, padding: "16px 24px", marginTop: 12, width: "100%", maxWidth: 360, display: "block" }}
        >
          Back to lobby
        </button>
      </div>
    )
  }

  // ── Reveal ─────────────────────────────────────────────────────────────

  if (game.phase === "reveal") {
    const allStepsRevealed = currentRevealStep >= n - 1
    const isLastChain = currentRevealChain >= revealOrder.length - 1

    // Waiting for first presenter to start (reveal_step = -1, not presenter)
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

    // Presenter intro screen
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
            style={{ background: YELLOW, color: "#000", fontSize: 22, fontWeight: 900, padding: "22px", width: "100%", display: "block" }}
          >
            Reveal my telestration
          </button>
        </div>
      )
    }

    // Active reveal — audience view
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
              return (
                <RevealCard key={s.id} step={s} authorName={author?.name ?? "?"} />
              )
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

    // Active reveal — presenter view
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
            return (
              <div key={s.id} style={{ opacity: isRevealed ? 1 : 0.3, marginBottom: 4, transition: "opacity 0.3s" }}>
                <RevealCard step={s} authorName={author?.name ?? "?"} />
              </div>
            )
          })}

          <div style={{ marginTop: 24 }}>
            {!allStepsRevealed ? (
              <button
                onClick={handleAdvanceReveal}
                disabled={advancing}
                style={{ background: YELLOW, color: "#000", fontSize: 22, fontWeight: 900, padding: "22px", width: "100%", display: "block" }}
              >
                Reveal
              </button>
            ) : (
              <button
                onClick={isLastChain ? handleNextChain : handleNextChain}
                disabled={advancing}
                style={{ background: "rgba(255,255,255,0.2)", color: "white", fontSize: 18, fontWeight: 900, padding: "20px", width: "100%", display: "block" }}
              >
                {isLastChain ? "Finish →" : "Next telestration →"}
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ── Play phase ─────────────────────────────────────────────────────────

  if (!myChainOwner) {
    return (
      <div style={{ minHeight: "100dvh", background: BG, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 18, fontWeight: 700 }}>Loading…</p>
      </div>
    )
  }

  const isDrawingStep = currentStep % 2 === 1
  const stepProgress = `${submittedCount} of ${n} done`

  // ── Drawing step ───────────────────────────────────────────────────────

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
            fontSize: 20,
            fontWeight: 800,
            lineHeight: 1.35,
            background: "rgba(255,255,255,0.1)",
            padding: "14px 16px",
            borderRadius: 8,
            marginBottom: 4,
          }}>
            {prompt}
          </div>
        </div>

        <div style={{ padding: "0 24px 24px" }}>
          <DrawingCanvas
            onExport={fn => { getDrawingRef.current = fn }}
          />

          <button
            onClick={handleSubmitDrawing}
            disabled={submitting}
            style={{ background: YELLOW, color: "#000", fontSize: 20, fontWeight: 900, padding: "20px", width: "100%", display: "block", marginTop: 16 }}
          >
            {submitting ? "Submitting…" : "Done drawing"}
          </button>
        </div>
      </div>
    )
  }

  // ── Writing step ───────────────────────────────────────────────────────

  const isFirstStep = currentStep === 0
  const ideasExhausted = shownIdeas.length >= 30

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
            fontSize: 18,
            fontWeight: 600,
            padding: "16px",
            resize: "none",
            borderRadius: 4,
            lineHeight: 1.45,
          }}
        />

        <button
          onClick={handleSubmitSentence}
          disabled={!sentence.trim() || submitting}
          style={{ background: YELLOW, color: "#000", fontSize: 20, fontWeight: 900, padding: "18px", width: "100%", marginTop: 8, display: "block" }}
        >
          {submitting ? "Submitting…" : "Lock it in"}
        </button>

        {/* Random Ideas — only on the first writing step */}
        {isFirstStep && (
          <div style={{ marginTop: 20 }}>
            {!ideasExhausted ? (
              <button
                onClick={handleGetIdeas}
                disabled={loadingIdeas}
                style={{
                  background: "rgba(255,255,255,0.12)",
                  color: "white",
                  fontSize: 15,
                  fontWeight: 800,
                  padding: "14px 18px",
                  width: "100%",
                  marginBottom: shownIdeas.length ? 12 : 0,
                }}
              >
                {shownIdeas.length === 0 ? "✦ Random ideas" : "✦ 3 more ideas"}
              </button>
            ) : (
              <div style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.25)", padding: "12px 18px", background: "rgba(255,255,255,0.05)" }}>
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
                      padding: "7px 14px",
                      borderRadius: 999,
                      fontSize: 14,
                      fontWeight: 700,
                      background: "rgba(255,255,255,0.1)",
                      color: "white",
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

// ─── RevealCard ─────────────────────────────────────────────────────────

function RevealCard({ step, authorName }) {
  const isDrawing = step.step_type === "drawing"
  return (
    <div style={{ marginBottom: 20, background: "rgba(255,255,255,0.07)", borderRadius: 10, overflow: "hidden" }}>
      <div style={{ padding: "10px 14px 8px", fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.12em", opacity: 0.5, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        {isDrawing ? `${authorName} drew:` : `${authorName} wrote:`}
      </div>
      <div style={{ padding: isDrawing ? 0 : "14px" }}>
        {isDrawing ? (
          <img
            src={step.content}
            alt="Drawing"
            style={{ width: "100%", display: "block" }}
          />
        ) : (
          <p style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.4, color: "white" }}>{step.content}</p>
        )}
      </div>
    </div>
  )
}
