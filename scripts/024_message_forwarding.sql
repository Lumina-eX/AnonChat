-- Message forwarding support (issue #287)
--
-- Forwarded messages are stored as regular messages in the destination room,
-- with extra metadata identifying them as forwarded.
--
-- Privacy: we intentionally do NOT store the source room id or the original
-- author on the forwarded copy. Members of the destination group must not be
-- able to learn anything about the (possibly restricted) source group or who
-- originally wrote the message. `forwarded_from_message_id` is only useful to
-- someone who can already read the source room (RLS on messages enforces this),
-- and it is set to NULL automatically when the original is deleted.

alter table public.messages
  add column if not exists is_forwarded boolean not null default false;

alter table public.messages
  add column if not exists forwarded_from_message_id uuid
    references public.messages(id) on delete set null;

alter table public.messages
  add column if not exists forwarded_original_created_at timestamp with time zone;

create index if not exists messages_forwarded_from_idx
  on public.messages(forwarded_from_message_id)
  where forwarded_from_message_id is not null;
