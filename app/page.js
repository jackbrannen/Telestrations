"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "../lib/supabase"
import { useSubmitNudge } from "../lib/useSubmitNudge"

const BG = "#2B0F6B"
const YELLOW = "#FBDF54"

const WORDS_A = [
  "MAPLE","RIVER","OCEAN","SUNRISE","VELVET","COPPER","SILVER","EMBER","FOREST","CLOUD",
  "IVORY","SAPPHIRE","SPRING","SUMMER","WINTER","AUTUMN","MORNING","MIDNIGHT","ORCHID","LANTERN",
  "PINE","CEDAR","MEADOW","CANYON","HARBOR","ISLAND","VALLEY","MOUNTAIN","GARDEN","BREEZE",
  "COMET","ROCKET","MIRROR","CARPET","POCKET","BRIDGE","CANDLE","PILOT","CIRCUS","PARADE",
  "BLOSSOM","CORAL","PEBBLE","MARBLE","FROST","FLAME","SPARK","SHADOW","WONDER","GLIMMER",
  "HONEY","BUTTER","COOKIE","WAFFLE","MUFFIN","BAGEL","COCOA","LATTE","LEMON","MANGO",
  "PLUM","PEACH","BERRY","OLIVE","BASIL","PEPPER","GINGER","SUGAR","SALMON","TURKEY",
  "PANDA","TIGER","OTTER","EAGLE","FALCON","ROBIN","WHALE","DOLPHIN","KOALA","ZEBRA",
]

const WORDS_B = [
  "CASTLE","CANDLE","BRIDGE","ROCKET","MIRROR","LANTERN","POCKET","CARPET","PILOT","HARBOR",
  "ISLAND","VALLEY","FOREST","GARDEN","MEADOW","CANYON","RIVER","OCEAN","MOUNTAIN","BREEZE",
  "CLOUD","EMBER","SPARK","GLIMMER","SHADOW","FROST","FLAME","SAPPHIRE","IVORY","MARBLE",
  "COPPER","SILVER","CORAL","ORCHID","BLOSSOM","HONEY","COCOA","LATTE","LEMON","MANGO",
  "PEACH","PLUM","BERRY","OLIVE","BASIL","PEPPER","PANDA","OTTER","EAGLE","FALCON",
  "ROBIN","WHALE","DOLPHIN","KOALA","ZEBRA","NINJA","KNIGHT","WIZARD","RANGER","SCOUT",
]

const BOT_NAMES = ["Raccoon", "Flamingo", "Capybara", "Narwhal"]

const BOT_SENTENCES = [
  "A bear trying to parallel park",
  "A penguin at a job interview",
  "A wizard ordering at McDonald's",
  "A robot learning to dance",
  "A cat who is very bad at yoga",
  "A dragon stuck in an elevator",
]

function randomCode() {
  const a = WORDS_A[Math.floor(Math.random() * WORDS_A.length)]
  const b = WORDS_B[Math.floor(Math.random() * WORDS_B.length)]
  return `${a}${b}`
}

async function createGame(isDummy = false) {
  for (let attempt = 1; attempt <= 10; attempt++) {
    const code = randomCode()
    const { count, error: checkError } = await supabase
      .from("tel_games")
      .select("code", { count: "exact", head: true })
      .eq("code", code)
      .neq("phase", "finished")
    if (checkError) throw checkError
    if ((count ?? 0) > 0) continue

    const { data, error: insertError } = await supabase
      .from("tel_games")
      .insert({ code, is_dummy: isDummy })
      .select("code")
      .single()
    if (insertError) throw insertError
    return String(data.code).toUpperCase()
  }
  throw new Error("unable_to_allocate_game_code")
}

function makeBlankDrawing() {
  try {
    const c = document.createElement("canvas")
    c.width = 320; c.height = 240
    const ctx = c.getContext("2d")
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, 320, 240)
    return c.toDataURL("image/jpeg", 0.5)
  } catch {
    return "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoH"
  }
}

export default function Home() {
  const router = useRouter()
  const [isCreating, setIsCreating] = useState(false)
  const [joinCode, setJoinCode] = useState("")
  const nudgeJoin = useSubmitNudge(joinCode, false)
  const [error, setError] = useState("")

  async function onCreateClick() {
    if (isCreating) return
    setError("")
    setIsCreating(true)
    try {
      const code = await createGame(false)
      router.push(`/${code}`)
    } catch (e) {
      setError(e?.message ?? "unknown error")
      setIsCreating(false)
    }
  }

  async function onDummyClick() {
    if (isCreating) return
    setError("")
    setIsCreating(true)
    try {
      const code = await createGame(true)

      // Create real player slot — will be claimed in lobby
      // Create 4 bots
      const { data: botData, error: botError } = await supabase
        .from("tel_players")
        .insert(BOT_NAMES.map(name => ({ game_code: code, name, first_name: name, last_name: "", is_bot: true })))
        .select("id,name")
      if (botError) throw botError

      // Create placeholder real player ("You")
      const { data: realData, error: realError } = await supabase
        .from("tel_players")
        .insert({ game_code: code, name: "You", first_name: "You", last_name: "", is_bot: false })
        .select("id")
        .single()
      if (realError) throw realError

      localStorage.setItem(`tel:${code}:playerId`, realData.id)

      // Start game (assigns seats)
      await supabase.rpc("tel_start_game", { p_code: code })

      // Fetch players with seats to pre-insert bot step 0
      const { data: allPlayers } = await supabase
        .from("tel_players")
        .select("id,seat,is_bot")
        .eq("game_code", code)

      const blankDrawing = makeBlankDrawing()
      const n = allPlayers.length

      // Pre-insert ALL bot steps — text steps get funny sentences, drawing steps get blank canvas
      const botPlayers = allPlayers.filter(p => p.is_bot)
      const stepsToInsert = []
      let textStepCounter = 0

      for (const bot of botPlayers) {
        for (let step = 0; step < n; step++) {
          const chainOwnerSeat = ((bot.seat - step) % n + n) % n
          const chainOwner = allPlayers.find(p => p.seat === chainOwnerSeat)
          if (!chainOwner) continue

          const isDrawing = step % 2 === 1
          stepsToInsert.push({
            game_code: code,
            chain_owner_id: chainOwner.id,
            step_number: step,
            step_type: isDrawing ? "drawing" : "text",
            content: isDrawing ? blankDrawing : BOT_SENTENCES[textStepCounter++ % BOT_SENTENCES.length],
            author_id: bot.id,
          })
        }
      }

      // Insert bot steps (bot steps that need real player's content as predecessor will be fine
      // because the step auto-advance only happens after ALL player submissions per step number)
      if (stepsToInsert.length > 0) {
        const { error: stepsError } = await supabase.from("tel_steps").insert(stepsToInsert)
        if (stepsError) throw stepsError
      }

      router.push(`/${code}/play`)
    } catch (e) {
      setError(e?.message ?? "unknown error")
      setIsCreating(false)
    }
  }

  function onJoin() {
    const trimmed = joinCode.trim()
    if (trimmed) router.push(`/${trimmed}`)
  }

  return (
    <div style={{
      minHeight: "100dvh",
      background: BG,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "40px 24px",
    }}>
      <h1 style={{
        fontSize: "clamp(44px, 13vw, 88px)",
        fontWeight: 900,
        color: "white",
        letterSpacing: "-2px",
        lineHeight: 0.9,
        textAlign: "center",
        marginBottom: 12,
      }}>
        Telestrations
      </h1>

      <p style={{
        color: "rgba(255,255,255,0.45)",
        fontSize: 14,
        fontWeight: 700,
        textAlign: "center",
        marginBottom: 56,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
      }}>
        Telephone + Drawing
      </p>

      <div style={{ width: "100%", maxWidth: 400, display: "flex", flexDirection: "column", gap: 8 }}>
        <button
          onClick={onCreateClick}
          disabled={isCreating}
          style={{
            background: YELLOW,
            color: "#000",
            fontSize: 22,
            fontWeight: 900,
            padding: "22px 40px",
            width: "100%",
            display: "block",
          }}
        >
          {isCreating ? "Creating…" : "Create Game"}
        </button>

        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            placeholder="Room code"
            value={joinCode}
            onChange={e => setJoinCode(e.target.value.toUpperCase())}
            onKeyDown={e => { if (e.key === "Enter") onJoin() }}
            style={{
              flex: 1,
              minWidth: 0,
              background: "rgba(255,255,255,0.15)",
              border: "none",
              color: "white",
              fontSize: 18,
              fontWeight: 800,
              padding: "18px 16px",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              outline: "none",
            }}
          />
          <button
            onClick={onJoin}
            style={{
              background: "rgba(255,255,255,0.15)",
              color: "white",
              fontSize: 18,
              fontWeight: 900,
              padding: "18px 20px",
              flexShrink: 0,
              animation: nudgeJoin ? "nudgePulse 1.5s ease-in-out infinite" : "none",
            }}
          >
            Join
          </button>
        </div>
      </div>

      {!!error && (
        <p style={{ color: YELLOW, marginTop: 20, fontSize: 14, fontWeight: 600, textAlign: "center" }}>
          Error: {error}
        </p>
      )}

      <button
        onClick={onDummyClick}
        disabled={isCreating}
        style={{
          position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)",
          background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.35)",
          fontSize: 11, fontWeight: 700, padding: "8px 16px",
          letterSpacing: "0.1em", textTransform: "uppercase", whiteSpace: "nowrap",
        }}
      >
        {isCreating ? "Setting up…" : "Dummy Game"}
      </button>
    </div>
  )
}
