// app/api/log/route.js
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// ทำให้รันฝั่ง Node runtime แน่ๆ (กัน edge บางกรณี)
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const { temperature, humidity } = await request.json();

    // อ่าน env ตรงนี้ (ภายในฟังก์ชัน) เพื่อไม่ให้ break ตอน build
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      console.error("Missing Supabase env vars at runtime.");
      return NextResponse.json(
        { error: "Server is misconfigured (missing env vars)." },
        { status: 500 }
      );
    }

    // สร้าง client เมื่อมีคำขอเท่านั้น
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { error } = await supabase.from("sensor_logs").insert([
      {
        temperature,
        humidity,
        // created_at: จะให้ DB ใส่ค่า NOW() เอง ถ้าคอลัมน์เป็น default now()
      },
    ]);

    if (error) {
      console.error("Supabase insert error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("API /api/log error:", err);
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
}
