"use client";

import { useEffect, useState, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import mqtt from "mqtt";
import { Line } from "react-chartjs-2";
import "chart.js/auto";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default function Dashboard() {
  const [data, setData] = useState([]);
  const [temperature, setTemperature] = useState(0);
  const [humidity, setHumidity] = useState(0);
  const [timeRange, setTimeRange] = useState(5 * 60 * 1000); // 5 นาที
  const lastSaveRef = useRef(0);

  // โหลดข้อมูลจากฐานข้อมูล
  useEffect(() => {
    async function fetchData() {
      const since = new Date(Date.now() - timeRange).toISOString();
      const { data: logs, error } = await supabase
        .from("sensor_logs")
        .select("*")
        .gte("created_at", since)
        .order("created_at", { ascending: true });

      if (!error && logs) {
        const formatted = logs.map((row) => ({
          time: new Date(row.created_at).toLocaleTimeString("th-TH", {
            hour12: false,
            timeZone: "Asia/Bangkok",
          }),
          temperature: row.temperature,
          humidity: row.humidity,
          timestamp: new Date(row.created_at).getTime(),
        }));
        setData(formatted);
      }
    }
    fetchData();
  }, [timeRange]);

  // รับ MQTT และอัปเดตเรียลไทม์
  useEffect(() => {
    const client = mqtt.connect("wss://broker.hivemq.com:8884/mqtt");

    client.on("connect", () => {
      client.subscribe("jetson/box/sensor");
    });

    client.on("message", async (topic, message) => {
      try {
        const payload = JSON.parse(message.toString());
        const { temperature, humidity } = payload;
        const now = new Date();
    
        // อัปเดตค่าปัจจุบัน
        setTemperature(temperature);
        setHumidity(humidity);
    
        // เพิ่มจุดใหม่ทุก 1 วิ และลบจุดเก่าทันที (กราฟเลื่อนต่อเนื่อง)
        setData((prev) => {
          const newEntry = {
            time: now.toLocaleTimeString("th-TH", {
              hour12: false,
              timeZone: "Asia/Bangkok",
            }),
            temperature,
            humidity,
            timestamp: now.getTime(),
          };
    
          // จำกัดจำนวนจุดตามช่วงเวลา (เลื่อนสด ๆ)
          const updated = [...prev, newEntry];
          const maxPoints = timeRange / 1000; // หน่วยวินาที
          return updated.length > maxPoints
            ? updated.slice(updated.length - maxPoints)
            : updated;
        });
    
        // บันทึกข้อมูลลงฐานทุก 15 วิ
        const nowMs = Date.now();
        if (nowMs - lastSaveRef.current >= 15000) {
          lastSaveRef.current = nowMs;
          await fetch("/api/log", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ temperature, humidity }),
          });
        }
      } catch (err) {
        console.error("MQTT message error:", err);
      }
    });
    

    return () => client.end();
  }, [timeRange]);

  // ปุ่มช่วงเวลา
  const timeRanges = {
    "1 นาที": 60 * 1000,
    "5 นาที": 5 * 60 * 1000,
    "30 นาที": 30 * 60 * 1000,
    "1 ชม.": 60 * 60 * 1000,
    "6 ชม.": 6 * 60 * 60 * 1000,
    "1 วัน": 24 * 60 * 60 * 1000,
  };

  // Export CSV
  const exportCSV = () => {
    const header = "Time,Temperature (°C),Humidity (%)\n";
    const rows = data
      .map((d) => `${d.time},${d.temperature},${d.humidity}`)
      .join("\n");
    const csv = header + rows;

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `jetson_data_${new Date()
      .toISOString()
      .slice(0, 19)
      .replace(/:/g, "-")}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // ตัวเลือกกราฟ
  const chartOptions = {
    responsive: true,
    scales: {
      x: { grid: { color: "rgba(255,255,255,0.1)" } },
      y: { grid: { color: "rgba(255,255,255,0.1)" } },
    },
    elements: { point: { radius: 2 } },
    plugins: { legend: { labels: { color: "#fff" } } },
  };

  return (
    <div className="bg-gray-900 text-white min-h-screen p-4">
      <h1 className="text-lg font-bold">🌡️ Jetson Box Dashboard</h1>
      <p>
        Temp: {temperature.toFixed(1)} °C | Humidity: {humidity.toFixed(1)} %
      </p>

      <div className="mt-3 space-x-2">
        {Object.entries(timeRanges).map(([label, value]) => (
          <button
            key={label}
            onClick={() => setTimeRange(value)}
            className={`px-2 py-1 rounded ${
              timeRange === value ? "bg-blue-500" : "bg-gray-700"
            }`}
          >
            {label}
          </button>
        ))}
        <button
          onClick={exportCSV}
          className="ml-2 bg-green-600 px-2 py-1 rounded"
        >
          Export CSV
        </button>
      </div>

      <div className="mt-6 space-y-6">
        <div className="bg-gray-800 p-3 rounded-xl shadow-md">
          <h2 className="text-sm mb-2 text-red-400">Temperature (°C)</h2>
          <Line
            data={{
              labels: data.map((d) => d.time),
              datasets: [
                {
                  label: "temperature",
                  data: data.map((d) => d.temperature),
                  borderColor: "#ff6b6b",
                  backgroundColor: "rgba(255,107,107,0.1)",
                  tension: 0.3,
                },
              ],
            }}
            options={chartOptions}
          />
        </div>

        <div className="bg-gray-800 p-3 rounded-xl shadow-md">
          <h2 className="text-sm mb-2 text-blue-400">Humidity (%)</h2>
          <Line
            data={{
              labels: data.map((d) => d.time),
              datasets: [
                {
                  label: "humidity",
                  data: data.map((d) => d.humidity),
                  borderColor: "#4dabf7",
                  backgroundColor: "rgba(77,171,247,0.1)",
                  tension: 0.3,
                },
              ],
            }}
            options={chartOptions}
          />
        </div>
      </div>
    </div>
  );
}
