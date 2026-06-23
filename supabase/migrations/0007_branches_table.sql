-- Migration: 0007_branches_table
--
-- Create the branches table and link existing sessions/messages.

CREATE TABLE public.branches (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        uuid        NOT null REFERENCES public.sessions(id) ON DELETE CASCADE,
  parent_id         uuid        REFERENCES public.branches(id) ON DELETE SET null,
  path_id           text        NOT null, -- dot-separated path, e.g., 'main.b1'
  label             text        NOT null,
  color             text        NOT null,
  fork_message_id   uuid        REFERENCES public.messages(id) ON DELETE SET null,
  is_archived       boolean     NOT null DEFAULT false,
  created_at        timestamptz NOT null DEFAULT now()
);

-- Index for session branches
CREATE INDEX branches_session_idx ON public.branches(session_id);

ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "branches_select" ON public.branches FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "branches_insert" ON public.branches FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "branches_update" ON public.branches FOR UPDATE USING (auth.uid() IS NOT NULL);

-- Add branch_id to public.messages
ALTER TABLE public.messages ADD COLUMN branch_id uuid REFERENCES public.branches(id) ON DELETE SET null;
CREATE INDEX messages_branch_idx ON public.messages(branch_id);

-- Trigger function to automatically create a 'main' branch when a new session is created
CREATE OR REPLACE FUNCTION public.on_session_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.branches (session_id, path_id, label, color)
  VALUES (new.id, 'main', 'Principal', '#6366f1');
  RETURN new;
END;
$$;

CREATE TRIGGER on_session_created_trigger
  AFTER INSERT ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.on_session_created();

-- Migration step: Insert a 'main' branch for all existing sessions
INSERT INTO public.branches (session_id, path_id, label, color)
SELECT id, 'main', 'Principal', '#6366f1'
FROM public.sessions;

-- Update existing messages to point to their session's 'main' branch
UPDATE public.messages m
SET branch_id = b.id
FROM public.branches b
WHERE m.session_id = b.session_id AND b.path_id = 'main';
