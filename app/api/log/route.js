import { supabase } from "../../../lib/supabase";

export async function GET() {
  const { data, error } = await supabase
    .from("sensor_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json(data.reverse());
}
