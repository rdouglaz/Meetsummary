import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string) || 'https://zqhttqqsjowkdwyockrp.supabase.co';
const supabasePublishableKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string) || 'sb_publishable_k1lEijLdZ05mgMjOd1mzNg_vgfwwv73';

export const supabase = createClient<Database>(supabaseUrl, supabasePublishableKey, {
  realtime: { params: { eventsPerSecond: 10 } },
  auth: { persistSession: true, autoRefreshToken: true },
});
