"use client";

import { useEffect, useState } from "react";
import { Line } from "react-chartjs-2";
import mqtt from "mqtt";
import "chart.js/auto";

export default function Dashboard() {
  const [temperature, setTemperature] = useState(0);
  const [humidity, setHumidity] = useState(0);
  const [dataLog, setDataLog] = useState([]);

  useEffect(() => {
    // 🛰️ เชื่อมต่อ MQTT WebSocket
    const client = mqtt.connect("wss://broker.hivemq.com:8884/mqtt");

    client.on("connect", () => {
      console.log("✅ Connected to MQTT broker");
      client.subscribe("jetson/box/sensor");
    });

    client.on("message", (topic, message) => {
      if (topic === "jetson/box/sensor") {
        try {
          const payload = JSON.parse(message.toString());
          const { temperature, humidity } = payload;

          setTemperature(temperature);
          setHumidity(humidity);
          setDataLog((prev) => [
            ...prev.slice(-19),
            { time: new Date().toLocaleTimeString(), temperature, humidity },
          ]);
        } catch (err) {
          console.error("Invalid message:", err);
        }
      }
    });

    return () => client.end();
  }, []);

  const chartData = {
    labels: dataLog.map((d) => d.time),
    datasets: [
      {
        label: "Temperature (°C)",
        data: dataLog.map((d) => d.temperature),
        borderColor: "rgba(255, 99, 132, 1)",
        backgroundColor: "rgba(255, 99, 132, 0.2)",
      },
      {
        label: "Humidity (%)",
        data: dataLog.map((d) => d.humidity),
        borderColor: "rgba(54, 162, 235, 1)",
        backgroundColor: "rgba(54, 162, 235, 0.2)",
      },
    ],
  };

  return (
    <div className="p-6 bg-black text-white min-h-screen">
      <h1 className="text-2xl font-bold mb-2">🌡️ Jetson Box Dashboard</h1>
      <p>
        Temp: {temperature.toFixed(1)} °C | Humidity: {humidity.toFixed(1)} %
      </p>
      <div className="mt-6 bg-gray-900 p-4 rounded-lg">
        <Line data={chartData} />
      </div>
    </div>
  );
}
