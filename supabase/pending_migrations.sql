-- ============================================================
-- Telestrations
-- ============================================================

-- Games table
CREATE TABLE IF NOT EXISTS tel_games (
  code text PRIMARY KEY,
  phase text NOT NULL DEFAULT 'lobby',
  host_id uuid,
  is_dummy boolean NOT NULL DEFAULT false,
  total_steps int NOT NULL DEFAULT 0,
  current_step int NOT NULL DEFAULT 0,
  reveal_order text[] NOT NULL DEFAULT '{}',
  current_reveal_chain int NOT NULL DEFAULT 0,
  current_reveal_step int NOT NULL DEFAULT -1,
  created_at timestamptz DEFAULT now()
);

-- Players table
CREATE TABLE IF NOT EXISTS tel_players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_code text REFERENCES tel_games(code) ON DELETE CASCADE,
  name text,
  first_name text,
  last_name text,
  seat int,
  is_bot boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Steps table
-- One row per player per step per chain.
-- chain_owner_id: which player's chain this step belongs to
-- step_number: 0-indexed. even = text, odd = drawing
-- author_id: who wrote/drew this step
CREATE TABLE IF NOT EXISTS tel_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_code text REFERENCES tel_games(code) ON DELETE CASCADE,
  chain_owner_id uuid REFERENCES tel_players(id) ON DELETE CASCADE,
  step_number int NOT NULL,
  step_type text NOT NULL, -- 'text' or 'drawing'
  content text,            -- sentence text or base64 JPEG data URL
  author_id uuid REFERENCES tel_players(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE (game_code, chain_owner_id, step_number)
);

-- RLS (permissive anon access, matching other games)
ALTER TABLE tel_games ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow all" ON tel_games;
CREATE POLICY "allow all" ON tel_games FOR ALL TO anon USING (true) WITH CHECK (true);

ALTER TABLE tel_players ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow all" ON tel_players;
CREATE POLICY "allow all" ON tel_players FOR ALL TO anon USING (true) WITH CHECK (true);

ALTER TABLE tel_steps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow all" ON tel_steps;
CREATE POLICY "allow all" ON tel_steps FOR ALL TO anon USING (true) WITH CHECK (true);

-- ── RPC: tel_start_game ───────────────────────────────────────────────────
-- Assigns random seat numbers to all players, sets game phase to 'play'.

CREATE OR REPLACE FUNCTION tel_start_game(p_code text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_player_ids uuid[];
  v_count int;
  v_i int;
BEGIN
  SELECT ARRAY(
    SELECT id FROM tel_players
    WHERE game_code = p_code
    ORDER BY random()
  ) INTO v_player_ids;

  v_count := array_length(v_player_ids, 1);

  FOR v_i IN 0..v_count-1 LOOP
    UPDATE tel_players
    SET seat = v_i
    WHERE id = v_player_ids[v_i + 1];
  END LOOP;

  UPDATE tel_games
  SET phase = 'play',
      total_steps = v_count,
      current_step = 0
  WHERE code = p_code;
END;
$$;

-- ── RPC: tel_submit_step ──────────────────────────────────────────────────
-- Records one player's submission for the current step.
-- If all players have submitted, advances current_step.
-- If the last step was just completed, transitions to reveal phase.

CREATE OR REPLACE FUNCTION tel_submit_step(
  p_code text,
  p_chain_owner_id uuid,
  p_step_number int,
  p_step_type text,
  p_content text,
  p_author_id uuid
)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_total int;
  v_submitted int;
BEGIN
  INSERT INTO tel_steps (game_code, chain_owner_id, step_number, step_type, content, author_id)
  VALUES (p_code, p_chain_owner_id, p_step_number, p_step_type, p_content, p_author_id)
  ON CONFLICT (game_code, chain_owner_id, step_number) DO NOTHING;

  SELECT total_steps INTO v_total FROM tel_games WHERE code = p_code;

  SELECT COUNT(*) INTO v_submitted
  FROM tel_steps
  WHERE game_code = p_code AND step_number = p_step_number;

  IF v_submitted >= v_total THEN
    IF p_step_number + 1 >= v_total THEN
      -- All steps done — move to reveal
      UPDATE tel_games
      SET phase = 'reveal',
          current_step = p_step_number + 1,
          reveal_order = ARRAY(
            SELECT id::text FROM tel_players
            WHERE game_code = p_code
            ORDER BY random()
          ),
          current_reveal_chain = 0,
          current_reveal_step = -1
      WHERE code = p_code AND current_step = p_step_number;
    ELSE
      -- Advance to next step
      UPDATE tel_games
      SET current_step = p_step_number + 1
      WHERE code = p_code AND current_step = p_step_number;
    END IF;
  END IF;
END;
$$;

-- ── RPC: tel_advance_reveal ───────────────────────────────────────────────
-- Presenter taps to reveal next item, or to advance to next chain.
-- When p_new_reveal_chain >= length of reveal_order, transitions to 'finished'.

CREATE OR REPLACE FUNCTION tel_advance_reveal(
  p_code text,
  p_new_reveal_step int,
  p_new_reveal_chain int
)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_reveal_count int;
BEGIN
  SELECT array_length(reveal_order, 1) INTO v_reveal_count FROM tel_games WHERE code = p_code;

  IF p_new_reveal_chain >= v_reveal_count THEN
    UPDATE tel_games SET phase = 'finished' WHERE code = p_code;
  ELSE
    UPDATE tel_games
    SET current_reveal_step = p_new_reveal_step,
        current_reveal_chain = p_new_reveal_chain
    WHERE code = p_code;
  END IF;
END;
$$;

-- ── RPC: tel_reset_game ───────────────────────────────────────────────────
-- Resets game to lobby for play-again. Removes all players and steps so
-- everyone rejoins fresh (display name auto-fills from saved profile).

CREATE OR REPLACE FUNCTION tel_reset_game(p_code text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM tel_steps WHERE game_code = p_code;
  DELETE FROM tel_players WHERE game_code = p_code;
  UPDATE tel_games
  SET phase = 'lobby',
      total_steps = 0,
      current_step = 0,
      reveal_order = '{}',
      current_reveal_chain = 0,
      current_reveal_step = -1
  WHERE code = p_code;
END;
$$;

-- ── Enable Realtime for Telestrations tables ──────────────────────────────
-- Required so postgres_changes subscriptions fire for all clients.
ALTER PUBLICATION supabase_realtime ADD TABLE tel_games;
ALTER PUBLICATION supabase_realtime ADD TABLE tel_players;
ALTER PUBLICATION supabase_realtime ADD TABLE tel_steps;

-- ============================================================
-- Shared: random_ideas table and RPC
-- The random_ideas table is shared across all games.
-- Only creates the table if it doesn't exist.
-- Drops and recreates the function to handle signature changes.
-- ============================================================

CREATE TABLE IF NOT EXISTS random_ideas (
  id serial PRIMARY KEY,
  idea text NOT NULL UNIQUE
);

DROP FUNCTION IF EXISTS get_random_ideas(integer, text[]);

CREATE FUNCTION get_random_ideas(p_count int, p_exclude text[] DEFAULT '{}')
RETURNS text[] LANGUAGE sql AS $$
  SELECT ARRAY(
    SELECT idea FROM random_ideas
    WHERE idea != ALL(p_exclude)
    ORDER BY random()
    LIMIT p_count
  );
$$;
