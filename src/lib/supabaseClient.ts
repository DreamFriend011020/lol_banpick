import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://ymprslubmqymliobzyhm.supabase.co/rest/v1/19_SFL_TEST';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InltcHJzbHVibXF5bWxpb2J6eWhtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM2MTI5NDUsImV4cCI6MjEwOTE4ODk0NX0.uzybECOhTMPcBZbGY9Ormq8Jl_2xaw5vzgS_o-XKSpI';

/**
 * 환경 변수가 설정되어 있을 때만 Supabase 클라이언트를 생성합니다.
 * 미설정 시 로컬/브로드캐스트 테스트 모드로 동작할 수 있도록 null을 반환합니다.
 */
export const supabase: SupabaseClient | null =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
    })
    : null;

