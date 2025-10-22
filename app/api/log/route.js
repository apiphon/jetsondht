import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, serviceRoleKey);

export async function POST(request) {
  try {
    const body = await request.json();
    const { temperature, humidity } = body;

    const { error } = await supabase
      .from("sensor_logs")
      .insert([{ temperature, humidity }]);

    if (error) {
      console.error("Insert error:", error);
      return new Response(JSON.stringify({ error }), { status: 500 });
    }

    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (err) {
    console.error("Server error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
