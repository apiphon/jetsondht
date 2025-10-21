import { supabase } from "../../../lib/supabase";

export async function POST(req) {
  try {
    const body = await req.json();
    const { temperature, humidity } = body;

    const { error } = await supabase
      .from("sensor_logs")
      .insert([{ temperature, humidity }]);

    if (error) throw error;

    return Response.json({ success: true });
  } catch (error) {
    console.error("Insert error:", error.message);
    return Response.json({ success: false, error: error.message });
  }
}

export async function GET() {
  const { data, error } = await supabase
    .from("sensor_logs")
    .select("*")
    .order("created_at", { ascending: true })
    .limit(1000);

  if (error) {
    console.error("Fetch error:", error.message);
    return Response.json({ success: false, error: error.message });
  }

  return Response.json({ success: true, data });
}
