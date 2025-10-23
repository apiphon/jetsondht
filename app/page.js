"use client";

import { useEffect, useState, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import mqtt from "mqtt";
import { Line } from "react-chartjs-2";
import "chart.js/auto";
import "chartjs-adapter-date-fns";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default function Dashboard() {
  const INTERVAL_MS = 1000;
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

        setData((prev) => {
          const updated = [...prev];
          const nowTs = now.getTime();

          // เติมช่องว่างด้วยค่าล่าสุด ถ้าช่องว่างระหว่างจุดมากกว่า INTERVAL_MS
          if (updated.length > 0) {
            let last = updated[updated.length - 1];
            let gapTs = nowTs - last.timestamp;
            while (gapTs > INTERVAL_MS) {
              const newTs = last.timestamp + INTERVAL_MS;
              updated.push({
                timestamp: newTs,
                temperature: last.temperature,
                humidity: last.humidity,
                offline: true,
              });
              last = updated[updated.length - 1];
              gapTs = nowTs - last.timestamp;
            }
          }

          // เพิ่มข้อมูลปัจจุบันจาก sensor
          updated.push({
            temperature,
            humidity,
            timestamp: nowTs,
          });

          // กรองข้อมูลให้เหลือเฉพาะในช่วง timeRange
          const windowStartTs = nowTs - timeRange;
          return updated.filter((d) => d.timestamp >= windowStartTs);
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

    intervalId = setInterval(() => {
      const elapsed = Date.now() - lastMessageRef.current;

      if (elapsed < 20000) setConnectionStatus("connected");
      else if (elapsed < 40000) setConnectionStatus("unstable");
      else setConnectionStatus("lost");

      setData((prev) => {
        if (prev.length === 0) return prev;
        const updated = [...prev];
        const nowTs = Date.now();
        const last = updated[updated.length - 1];
        const gap = nowTs - last.timestamp;

        if (gap >= 2000) {
          let lastTs = last.timestamp;
          while (lastTs + INTERVAL_MS < nowTs) {
            lastTs += INTERVAL_MS;
            updated.push({
              timestamp: lastTs,
              temperature: last.temperature,
              humidity: last.humidity,
              offline: true,
            });
          }

          const offlineFlag =
            elapsed > 40000 ||
            (elapsed > 30000 && connectionStatus === "lost");

          updated.push({
            timestamp: nowTs,
            temperature: last.temperature,
            humidity: last.humidity,
            offline: offlineFlag,
          });

          const windowStartTs = nowTs - timeRange;
          return updated.filter((d) => d.timestamp >= windowStartTs);
        }
        return updated;
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

  const tempTrend = data.map((d, i, arr) => {
    const window = arr.slice(Math.max(0, i - 10), i + 1);
    return (
      window.reduce((sum, x) => sum + x.temperature, 0) / window.length || 0
    );
  });

  const humTrend = data.map((d, i, arr) => {
    const window = arr.slice(Math.max(0, i - 10), i + 1);
    return window.reduce((sum, x) => sum + x.humidity, 0) / window.length || 0;
  });

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 0 },
    scales: {
      x: {
        type: "time",
        time: {
          unit: "second",
          stepSize: 5,
          tooltipFormat: "HH:mm:ss",
          displayFormats: { second: "HH:mm:ss" },
        },
        grid: { color: "rgba(255,255,255,0.1)" },
        ticks: { color: "#ccc" },
      },
      y: {
        grid: { color: "rgba(255,255,255,0.1)" },
        ticks: { color: "#ccc" },
      },
    },
    elements: { point: { radius: 0 }, line: { tension: 0.3, borderWidth: 2 } },
    plugins: { legend: { labels: { color: "#fff" } } },
  };

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
      </div>

      {/* 📈 กราฟเต็มจอ 2 อันใน 1 หน้าจอ */}
      <div
        className="flex flex-col mt-4 space-y-4"
        style={{ height: "calc(100vh - 200px)" }}
      >
        {/* Temperature */}
        <div className="bg-gray-800 p-3 rounded-xl shadow-md flex-1 min-h-0">
          <h2 className="text-sm mb-2 text-red-400">Temperature (°C)</h2>
          <div className="h-full">
            <Line
              data={{
                datasets: [
                  {
                    label: "Temperature (Live)",
                    data: data.map((d) => ({
                      x: d.timestamp,
                      y: d.temperature,
                    })),
                    borderColor: "rgba(255,107,107,1)",
                    backgroundColor: "rgba(255,107,107,0.05)",
                  },
                  {
                    label: "Trend (avg)",
                    data: data.map((d, i) => ({
                      x: d.timestamp,
                      y: tempTrend[i],
                    })),
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

        {/* Humidity */}
        <div className="bg-gray-800 p-3 rounded-xl shadow-md flex-1 min-h-0">
          <h2 className="text-sm mb-2 text-blue-400">Humidity (%)</h2>
          <div className="h-full">
            <Line
              data={{
                datasets: [
                  {
                    label: "Humidity (Live)",
                    data: data.map((d) => ({
                      x: d.timestamp,
                      y: d.humidity,
                    })),
                    borderColor: "rgba(77,171,247,1)",
                    backgroundColor: "rgba(77,171,247,0.05)",
                  },
                  {
                    label: "Trend (avg)",
                    data: data.map((d, i) => ({
                      x: d.timestamp,
                      y: humTrend[i],
                    })),
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
    </div>
  );
}
