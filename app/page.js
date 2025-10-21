"use client";
import { useEffect, useState } from "react";
import mqtt from "mqtt";
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { supabase } from "../lib/supabase";
import { utils, writeFile } from "xlsx";

export default function Home() {
  const [data, setData] = useState([]);
  const [temp, setTemp] = useState(0);
  const [hum, setHum] = useState(0);

  // โหลดข้อมูลจากฐานข้อมูลเมื่อเปิดเว็บ
  useEffect(() => {
    async function loadLogs() {
      const { data: logs, error } = await supabase
        .from("sensor_logs")
        .select("*")
        .order("created_at", { ascending: true })
        .limit(100);

      if (!error && logs) {
        setData(
          logs.map((item) => ({
            temperature: item.temperature,
            humidity: item.humidity,
            time: new Date(item.created_at).toLocaleTimeString(),
          }))
        );
      }
    }
    loadLogs();
  }, []);

  // เชื่อมต่อ MQTT และรับค่าจาก ESP32
  useEffect(() => {
    const client = mqtt.connect("wss://broker.hivemq.com:8884/mqtt");

    client.on("connect", () => {
      console.log("Connected to MQTT broker");
      client.subscribe("jetson/box/sensor");
    });

    client.on("message", (topic, message) => {
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

        // อัปเดตก่อน
        setData((prev) => [...prev.slice(-49), newEntry]);

        // เก็บลงฐานข้อมูล
        fetch("/api/log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ temperature, humidity }),
        });
      } catch (err) {
        console.error("Error parsing MQTT message:", err);
      }
    });

    return () => {
      client.end();
    };
  }, []);

  // export csv
  const exportCSV = () => {
    const ws = utils.json_to_sheet(data);
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, "SensorLogs");
    writeFile(wb, "sensor_logs.xlsx");
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      <h1 className="text-2xl font-bold flex items-center mb-4">
        <span className="mr-2">🌡️</span> Jetson Box Dashboard
      </h1>
      <p className="mb-4">
        Temp: {temp.toFixed(1)} °C | Humidity: {hum.toFixed(1)} %
      </p>

      <button
        onClick={exportCSV}
        className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded mb-4"
      >
        Export CSV
      </button>

      <div className="bg-gray-900 rounded-xl p-4">
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={data}>
            <XAxis dataKey="time" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="temperature" stroke="#ff6b6b" />
            <Line type="monotone" dataKey="humidity" stroke="#339af0" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
