import { createClient } from "@supabase/supabase-js";

const PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const PUBLIC_SUPABASE_BUCKET =
  process.env.NEXT_PUBLIC_SUPABASE_BUCKET ?? process.env.SUPABASE_BUCKET;

export const supabasePublic =
  PUBLIC_SUPABASE_URL && PUBLIC_SUPABASE_ANON_KEY
    ? createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
        auth: { autoRefreshToken: true, persistSession: true },
      })
    : null;

export const publicBucket = PUBLIC_SUPABASE_BUCKET ?? "uploads";
