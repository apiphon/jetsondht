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
  const [connectionStatus, setConnectionStatus] = useState("connected");

  const lastSaveRef = useRef(0);
  const lastMessageRef = useRef(Date.now());

  // 🧩 โหลดข้อมูลย้อนหลังจาก Supabase
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

  // 🔌 MQTT และการอัปเดตเรียลไทม์
  useEffect(() => {
    const client = mqtt.connect("wss://broker.hivemq.com:8884/mqtt");
    let intervalId;

    client.on("connect", () => {
      client.subscribe("jetson/box/sensor");
      console.log("✅ MQTT connected");
    });

    client.on("message", async (topic, message) => {
      try {
        const payload = JSON.parse(message.toString());
        const { temperature, humidity } = payload;
        const now = new Date();

        lastMessageRef.current = Date.now();
        setTemperature(temperature);
        setHumidity(humidity);

        // ✅ เพิ่มจุดใหม่และลบข้อมูลเกินช่วงเวลา
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
          const updated = [...prev, newEntry].filter(
            (d) => now.getTime() - d.timestamp <= timeRange
          );
          return updated;
        });

        // ✅ เขียนลงฐานข้อมูลทุก 15 วินาที
        const sec = now.getSeconds();
        if (sec % 15 === 0) {
          const nowMs = Date.now();
          if (nowMs - lastSaveRef.current >= 1000) {
            lastSaveRef.current = nowMs;
            await fetch("/api/log", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ temperature, humidity }),
            });
          }
        }
      } catch (err) {
        console.error("MQTT message error:", err);
      }
    });

    // 🔍 ตรวจสอบสถานะการเชื่อมต่อและอัปเดตกราฟต่อเนื่อง
    intervalId = setInterval(() => {
      const elapsed = Date.now() - lastMessageRef.current;

      if (elapsed < 20000) setConnectionStatus("connected");
      else if (elapsed < 40000) setConnectionStatus("unstable");
      else setConnectionStatus("lost");

      // ถ้าไม่มีข้อมูลใหม่เกิน 2 วินาที → ลากค่าล่าสุดต่อ
      setData((prev) => {
        if (prev.length === 0) return prev;
        const last = prev[prev.length - 1];
        const now = new Date();
        const gap = now.getTime() - last.timestamp;

        if (gap >= 2000) {
          const hold = {
            time: now.toLocaleTimeString("th-TH", {
              hour12: false,
              timeZone: "Asia/Bangkok",
            }),
            temperature: last.temperature,
            humidity: last.humidity,
            timestamp: now.getTime(),
            offline:
              elapsed > 40000 ||
              (elapsed > 30000 && connectionStatus === "lost"),
          };
          const updated = [...prev, hold].filter(
            (d) => now.getTime() - d.timestamp <= timeRange
          );
          return updated;
        }

        return prev;
      });
    }, 1000);

    return () => {
      clearInterval(intervalId);
      client.end();
    };
  }, [timeRange]);

  // 🕒 ปุ่มเลือกช่วงเวลา
  const timeRanges = {
    "1 นาที": 60 * 1000,
    "5 นาที": 5 * 60 * 1000,
    "30 นาที": 30 * 60 * 1000,
    "1 ชม.": 60 * 60 * 1000,
    "6 ชม.": 6 * 60 * 60 * 1000,
    "1 วัน": 24 * 60 * 60 * 1000,
  };

  // 📊 สถิติ
  const avgTemp =
    data.length > 0
      ? (data.reduce((a, b) => a + b.temperature, 0) / data.length).toFixed(1)
      : 0;

  const avgHum =
    data.length > 0
      ? (data.reduce((a, b) => a + b.humidity, 0) / data.length).toFixed(1)
      : 0;

  const maxTemp = Math.max(...data.map((d) => d.temperature), 0);
  const minTemp = Math.min(...data.map((d) => d.temperature), 0);

  // 📈 Moving Average (10 จุด)
  const tempTrend = data.map((d, i, arr) => {
    const window = arr.slice(Math.max(0, i - 10), i + 1);
    return (
      window.reduce((sum, x) => sum + x.temperature, 0) / window.length || 0
    );
  });

  const humTrend = data.map((d, i, arr) => {
    const window = arr.slice(Math.max(0, i - 10), i + 1);
    return (
      window.reduce((sum, x) => sum + x.humidity, 0) / window.length || 0
    );
  });

  // 📤 Export CSV (แก้บั๊กแล้ว ✅)
  const exportCSV = async () => {
    const since = new Date(Date.now() - timeRange).toISOString();
    const { data: logs, error } = await supabase
      .from("sensor_logs")
      .select("*")
      .gte("created_at", since)
      .order("created_at", { ascending: true });

    if (error) {
      alert("Error fetching data from database");
      console.error(error);
      return;
    }

    if (!logs || logs.length === 0) {
      alert("No data found in database");
      return;
    }

    // เติมค่าที่หายไป (Gap > 15s)
    const filled = [];
    let lastTemp = logs[0].temperature;
    let lastHum = logs[0].humidity;
    let lastTime = new Date(logs[0].created_at).getTime();

    for (let i = 0; i < logs.length; i++) {
      const current = new Date(logs[i].created_at).getTime();
      const diff = current - lastTime;

      if (diff > 16000) {
        const missingSteps = Math.floor(diff / 15000) - 1;
        for (let j = 1; j <= missingSteps; j++) {
          const fakeTime = new Date(lastTime + j * 15000);
          filled.push({
            time: fakeTime.toLocaleTimeString("th-TH", {
              hour12: false,
              timeZone: "Asia/Bangkok",
            }),
            temperature: lastTemp,
            humidity: lastHum,
            note: "MISSING → filled from last value",
          });
        }
      }

      filled.push({
        time: new Date(logs[i].created_at).toLocaleTimeString("th-TH", {
          hour12: false,
          timeZone: "Asia/Bangkok",
        }),
        temperature: logs[i].temperature,
        humidity: logs[i].humidity,
        note: "REAL",
      });

      lastTemp = logs[i].temperature;
      lastHum = logs[i].humidity;
      lastTime = current;
    }

    // ✅ สร้าง CSV
    const header = "Time,Temperature (°C),Humidity (%),Status\n";
    const rows = filled
      .map(
        (d) => `${d.time},${d.temperature},${d.humidity},${d.note}`
      )
      .join("\n");
    const csv = header + rows;

    // ✅ ดาวน์โหลดไฟล์
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `jetson_data_filled_${new Date()
      .toISOString()
      .slice(0, 19)
      .replace(/:/g, "-")}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // ⚙️ การตั้งค่ากราฟ Chart.js
  const chartOptions = {
    responsive: true,
    animation: false,
    scales: {
      x: {
        grid: { color: "rgba(255,255,255,0.1)" },
        ticks: { color: "#ccc" },
      },
      y: {
        grid: { color: "rgba(255,255,255,0.1)" },
        ticks: { color: "#ccc" },
      },
    },
    elements: {
      point: { radius: 2 },
      line: { tension: 0.3, borderWidth: 2 },
    },
    plugins: {
      legend: { labels: { color: "#fff" } },
      tooltip: { animation: false },
    },
  };

  // 🎨 สีสถานะการเชื่อมต่อ
  const statusColor =
    connectionStatus === "connected"
      ? "text-green-400"
      : connectionStatus === "unstable"
      ? "text-yellow-400"
      : "text-red-400";

  const statusText =
    connectionStatus === "connected"
      ? "🟢 Connected"
      : connectionStatus === "unstable"
      ? "🟡 Unstable"
      : "🔴 Connection Lost";

  // 🧭 ส่วนแสดงผลหน้าเว็บ
  return (
    <div className="bg-gray-900 text-white min-h-screen p-4">
      <h1 className="text-lg font-bold">🌡️ Jetson Box Dashboard</h1>
      <p className={`font-semibold ${statusColor}`}>{statusText}</p>

      <p>
        Temp: {temperature.toFixed(1)}°C | Humidity: {humidity.toFixed(1)}%
      </p>

      <p className="text-sm text-gray-400">
        Avg Temp: {avgTemp}°C | Max: {maxTemp}°C | Min: {minTemp}°C | Avg Hum:{" "}
        {avgHum}%
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

      {/* กราฟ */}
      <div className="mt-6 space-y-6">
        <div className="bg-gray-800 p-3 rounded-xl shadow-md">
          <h2 className="text-sm mb-2 text-red-400">Temperature (°C)</h2>
          <Line
            data={{
              labels: data.map((d) => d.time),
              datasets: [
                {
                  label: "Temperature (Live)",
                  data: data.map((d) => d.temperature),
                  borderColor: "rgba(255,107,107,1)",
                  backgroundColor: "rgba(255,107,107,0.05)",
                  tension: 0.3,
                },
                {
                  label: "Trend (avg)",
                  data: tempTrend,
                  borderColor: "rgba(255,255,255,0.4)",
                  borderDash: [4, 4],
                  pointRadius: 0,
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
                  label: "Humidity (Live)",
                  data: data.map((d) => d.humidity),
                  borderColor: "rgba(77,171,247,1)",
                  backgroundColor: "rgba(77,171,247,0.05)",
                  tension: 0.3,
                },
                {
                  label: "Trend (avg)",
                  data: humTrend,
                  borderColor: "rgba(255,255,255,0.4)",
                  borderDash: [4, 4],
                  pointRadius: 0,
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
