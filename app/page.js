"use client";
import { useEffect, useState, useRef } from "react";
import mqtt from "mqtt";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { supabase } from "../lib/supabase";
import { utils, writeFile } from "xlsx";

export default function Home() {
  const [data, setData] = useState([]);
  const [temp, setTemp] = useState(0);
  const [hum, setHum] = useState(0);
  const [timeRange, setTimeRange] = useState(5 * 60 * 1000); // เริ่มต้น 5 นาที
  const lastSavedRef = useRef(0);

  // โหลดข้อมูลจาก Supabase
  useEffect(() => {
    async function loadLogs() {
      const since = new Date(Date.now() - timeRange).toISOString();

      const { data: logs, error } = await supabase
        .from("sensor_logs")
        .select("*")
        .gte("created_at", since)
        .order("created_at", { ascending: true });

      if (!error && logs) {
        setData(
          logs.map((item) => ({
            temperature: item.temperature,
            humidity: item.humidity,
            time: new Date(item.created_at).toLocaleTimeString(),
          }))
        );
      } else if (error) {
        console.error("Load error:", error.message);
      }
    }

    loadLogs();
    const interval = setInterval(loadLogs, 10000); // refresh ทุก 10 วินาที
    return () => clearInterval(interval);
  }, [timeRange]);

  // MQTT
  useEffect(() => {
    const client = mqtt.connect("wss://broker.hivemq.com:8884/mqtt");

    client.on("connect", () => {
      console.log("✅ Connected to MQTT broker");
      client.subscribe("jetson/box/sensor");
    });

    client.on("message", async (topic, message) => {
      try {
        const payload = JSON.parse(message.toString());
        const { temperature, humidity } = payload;

        setTemp(temperature);
        setHum(humidity);

        const newEntry = {
          temperature,
          humidity,
          time: new Date().toLocaleTimeString(),
        };

        setData((prev) => [...prev.slice(-299), newEntry]);

        // ⏱️ บันทึกทุก 15 วินาที
        const now = Date.now();
        if (now - lastSavedRef.current >= 15000) {
          lastSavedRef.current = now;
          const { error } = await supabase
            .from("sensor_logs")
            .insert([{ temperature, humidity }]);
          if (error) console.error("DB save error:", error.message);
          else console.log("💾 Saved to DB");
        }
      } catch (err) {
        console.error("MQTT parse error:", err);
      }
    });

    return () => {
      client.end();
    };
  }, []);

  // Export CSV
  const exportCSV = () => {
    const ws = utils.json_to_sheet(data);
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, "SensorLogs");
    writeFile(wb, "sensor_logs.xlsx");
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6 space-y-6">
      <h1 className="text-2xl font-bold flex items-center mb-4">
        <span className="mr-2">🌡️</span> Jetson Box Dashboard
      </h1>

      <p className="mb-4">
        Temp: {temp.toFixed(1)} °C | Humidity: {hum.toFixed(1)} %
      </p>

      {/* ปุ่มเลือกช่วงเวลา */}
      <div className="flex flex-wrap gap-2 mb-4">
        {[
          { label: "1 นาที", ms: 1 * 60 * 1000 },
          { label: "5 นาที", ms: 5 * 60 * 1000 },
          { label: "30 นาที", ms: 30 * 60 * 1000 },
          { label: "1 ชม.", ms: 60 * 60 * 1000 },
          { label: "6 ชม.", ms: 6 * 60 * 60 * 1000 },
          { label: "1 วัน", ms: 24 * 60 * 60 * 1000 },
        ].map((r) => (
          <button
            key={r.ms}
            onClick={() => setTimeRange(r.ms)}
            className={`px-3 py-1 rounded ${
              timeRange === r.ms
                ? "bg-blue-600 text-white"
                : "bg-gray-800 hover:bg-gray-700"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      <button
        onClick={exportCSV}
        className="bg-green-600 hover:bg-green-700 px-4 py-2 rounded mb-4"
      >
        Export CSV
      </button>

      {/* กราฟอุณหภูมิ */}
      <div className="bg-gray-900 rounded-xl p-4">
        <h2 className="text-lg font-semibold mb-2 text-red-400">Temperature (°C)</h2>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" /> {/* ✅ ตารางอ่อน */}
            <XAxis dataKey="time" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line
              type="linear"
              dataKey="temperature"
              stroke="#ff6b6b"
              dot={{ r: 2, strokeWidth: 1 }} // ✅ จุดพล็อตเล็ก ๆ
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* กราฟความชื้น */}
      <div className="bg-gray-900 rounded-xl p-4">
        <h2 className="text-lg font-semibold mb-2 text-blue-400">Humidity (%)</h2>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" /> {/* ✅ ตารางอ่อน */}
            <XAxis dataKey="time" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line
              type="linear"
              dataKey="humidity"
              stroke="#339af0"
              dot={{ r: 2, strokeWidth: 1 }} // ✅ จุดพล็อตเล็ก ๆ
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
