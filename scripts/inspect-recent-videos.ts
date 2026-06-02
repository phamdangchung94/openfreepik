import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, {
  prepare: false,
  max: 1,
  idle_timeout: 10,
});

async function main() {
  const rows = await sql`
    SELECT
      id,
      created_at,
      tier,
      duration_seconds,
      with_audio,
      status,
      freepik_task_id,
      video_url,
      magnific_video_url,
      video_url_expires_at
    FROM usage_logs
    WHERE status = 'succeeded'
    ORDER BY created_at DESC
    LIMIT 8
  `;

  console.log(`Recent ${rows.length} succeeded rows:\n`);
  for (const r of rows) {
    const vu = r.video_url as string | null;
    const mu = r.magnific_video_url as string | null;
    const vuHost = vu ? new URL(vu).hostname : "(null)";
    const muHost = mu ? new URL(mu).hostname : "(null)";
    console.log(`[${r.created_at}] ${r.tier}/${r.duration_seconds}s/audio=${r.with_audio}`);
    console.log(`  task_id:           ${r.freepik_task_id}`);
    console.log(`  video_url host:    ${vuHost}`);
    console.log(`  magnific_url host: ${muHost}`);
    console.log(`  expires_at:        ${r.video_url_expires_at}`);
    console.log(``);
  }
}

main()
  .then(() => sql.end())
  .catch(async (e) => {
    console.error(e);
    await sql.end();
    process.exit(1);
  });
