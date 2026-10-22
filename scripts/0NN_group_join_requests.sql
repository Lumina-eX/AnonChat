-- Tables
CREATE TABLE IF NOT EXISTS public.group_join_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,       -- REPLACE rooms
  requester_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','cancelled')),
  message text CHECK (message IS NULL OR char_length(message) <= 500),
  reviewed_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Only one pending request per user and group
CREATE UNIQUE INDEX IF NOT EXISTS uniq_pending_join_request
  ON public.group_join_requests (room_id, requester_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_join_requests_room_status
  ON public.group_join_requests (room_id, status, created_at);

-- Audit trail
CREATE TABLE IF NOT EXISTS public.group_join_request_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.group_join_requests(id) ON DELETE CASCADE,
  room_id uuid NOT NULL,
  actor_id uuid,
  event text NOT NULL CHECK (event IN ('created','approved','rejected','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Notifications for requesters (skip this table and insert into the repo's own one if it has one)
CREATE TABLE IF NOT EXISTS public.join_request_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL REFERENCES public.group_join_requests(id) ON DELETE CASCADE,
  room_id uuid NOT NULL,
  status text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.group_join_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_join_request_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.join_request_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "requester reads own requests" ON public.group_join_requests;
CREATE POLICY "requester reads own requests" ON public.group_join_requests
  FOR SELECT USING (requester_id = auth.uid());
DROP POLICY IF EXISTS "user reads own notifications" ON public.join_request_notifications;
CREATE POLICY "user reads own notifications" ON public.join_request_notifications
  FOR SELECT USING (user_id = auth.uid());

-- Who may review: owner or moderator
CREATE OR REPLACE FUNCTION public.is_group_reviewer(p_room uuid, p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.room_members m
    WHERE m.room_id = p_room AND m.user_id = p_user
      AND m.role IN ('owner','moderator')                -- REPLACE with the real role column/values
  );
$$;

-- Create request
CREATE OR REPLACE FUNCTION public.create_join_request(p_room uuid, p_user uuid, p_message text)
RETURNS public.group_join_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.group_join_requests; v_private boolean;
BEGIN
  SELECT is_private INTO v_private FROM public.rooms WHERE id = p_room;   -- REPLACE column/table
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT v_private THEN RAISE EXCEPTION 'group_not_private'; END IF;
  IF EXISTS (SELECT 1 FROM public.room_members WHERE room_id = p_room AND user_id = p_user) THEN
    RAISE EXCEPTION 'already_member';
  END IF;
  BEGIN
    INSERT INTO public.group_join_requests (room_id, requester_id, message)
    VALUES (p_room, p_user, p_message) RETURNING * INTO r;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'duplicate_pending_request';
  END;
  INSERT INTO public.group_join_request_events (request_id, room_id, actor_id, event)
  VALUES (r.id, r.room_id, p_user, 'created');
  RETURN r;
END $$;

-- Approve or reject, atomically
CREATE OR REPLACE FUNCTION public.review_join_request(p_request_id uuid, p_reviewer uuid, p_decision text)
RETURNS public.group_join_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.group_join_requests;
BEGIN
  IF p_decision NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'invalid_decision'; END IF;
  SELECT * INTO r FROM public.group_join_requests WHERE id = p_request_id FOR UPDATE;  -- row lock
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT public.is_group_reviewer(r.room_id, p_reviewer) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'already_reviewed'; END IF;

  IF p_decision = 'approved' THEN
    INSERT INTO public.room_members (room_id, user_id)       -- REPLACE: add required columns/default role
    VALUES (r.room_id, r.requester_id)
    ON CONFLICT DO NOTHING;
  END IF;

  UPDATE public.group_join_requests
     SET status = p_decision, reviewed_by = p_reviewer, reviewed_at = now(), updated_at = now()
   WHERE id = r.id RETURNING * INTO r;

  INSERT INTO public.group_join_request_events (request_id, room_id, actor_id, event)
  VALUES (r.id, r.room_id, p_reviewer, p_decision);
  INSERT INTO public.join_request_notifications (user_id, request_id, room_id, status)
  VALUES (r.requester_id, r.id, r.room_id, p_decision);
  RETURN r;
END $$;

-- Only the server (service role) may call these
REVOKE ALL ON FUNCTION public.is_group_reviewer(uuid,uuid), public.create_join_request(uuid,uuid,text),
  public.review_join_request(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_group_reviewer(uuid,uuid), public.create_join_request(uuid,uuid,text),
  public.review_join_request(uuid,uuid,text) TO service_role;