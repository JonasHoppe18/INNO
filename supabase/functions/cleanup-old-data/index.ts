import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RETENTION_DAYS = 30

Deno.serve(async (_req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data, error } = await supabase.rpc('delete_old_retrieval_traces', {
    retention_days: RETENTION_DAYS
  })

  if (error) {
    console.error('cleanup-old-data error:', error.message)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  console.log(`cleanup-old-data: deleted ${data} retrieval_traces older than ${RETENTION_DAYS} days`)
  return new Response(JSON.stringify({ deleted: data, retention_days: RETENTION_DAYS }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
