const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

/* ================= STATIC FILES ================= */
app.use(express.static(path.join(__dirname, "public"), {
  index: false
}));

/* ================= ROUTES ================= */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "intro.html"));
});

app.get("/home", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/history.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "history.html"));
});

/* ================= SQLITE ================= */
const db = new sqlite3.Database("./airdata.db");

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS sensor_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      temperature REAL,
      humidity REAL,
      ppm REAL,
      dust REAL,
      timestamp TEXT
    )
  `);

  console.log("📦 SQLite Ready");
});

/* ================= TIME ================= */
function getManilaTime() {
  return new Date().toLocaleString("en-PH", {
    timeZone: "Asia/Manila"
  });
}

/* ================= HISTORY API ================= */
app.get("/history", (req, res) => {
  db.all(
    "SELECT * FROM sensor_data ORDER BY id DESC LIMIT 100",
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

/* ================= DELETE ROUTES ================= */
app.delete("/history", (req, res) => {
  db.run("DELETE FROM sensor_data", function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "All history deleted", rowsDeleted: this.changes });
  });
});

app.delete("/history/last10", (req, res) => {
  db.run(`
    DELETE FROM sensor_data
    WHERE id IN (
      SELECT id FROM sensor_data
      ORDER BY id ASC
      LIMIT 10
    )
  `, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Oldest 10 deleted", rowsDeleted: this.changes });
  });
});

app.delete("/history/reset", (req, res) => {
  db.serialize(() => {
    db.run("DELETE FROM sensor_data", function (err) {
      if (err) return res.status(500).json({ error: err.message });

      db.run(
        "DELETE FROM sqlite_sequence WHERE name='sensor_data'",
        (err2) => {
          if (err2) return res.status(500).json({ error: err2.message });

          res.json({ message: "Factory reset complete", success: true });
        }
      );
    });
  });
});

/* ================= SYSTEM STATE ================= */
let latestData = null;
let lastPacketTime = Date.now();
let serialStatus = "DISCONNECTED";

/* ================= SERIAL (FIXED FOR CLOUD) ================= */

let SerialPort, ReadlineParser;

try {
  ({ SerialPort } = require("serialport"));
  ({ ReadlineParser } = require("@serialport/parser-readline"));
} catch (e) {
  console.log("⚠️ Serial modules not available (cloud mode)");
}

function connectSerial() {
  if (!SerialPort) {
    console.log("☁️ Serial disabled (no hardware environment)");
    return;
  }

  let port = new SerialPort({
    path: "COM7", // LOCAL ONLY
    baudRate: 9600,
    autoOpen: false
  });

  port.open((err) => {
    if (err) {
      console.log("❌ Serial open failed:", err.message);
      serialStatus = "DISCONNECTED";
      setTimeout(connectSerial, 3000);
      return;
    }

    console.log("✅ Serial Connected");
    serialStatus = "CONNECTED";

    const parser = port.pipe(
      new ReadlineParser({ delimiter: "\n" })
    );

    parser.on("data", (line) => {
      const parts = line.trim().split(",");

      if (parts.length !== 4) return;

      const [temp, hum, ppm, dust] = parts.map(Number);

      if ([temp, hum, ppm, dust].some(isNaN)) return;

      latestData = {
        temperature: temp,
        humidity: hum,
        ppm,
        dust
      };

      lastPacketTime = Date.now();

      io.emit("air-data", latestData);
    });
  });

  port.on("close", () => {
    console.log("⚠️ Serial closed, reconnecting...");
    serialStatus = "RECONNECTING";
    setTimeout(connectSerial, 3000);
  });
}

/* ================= ONLY RUN SERIAL LOCALLY ================= */
if (process.env.LOCAL === "true") {
  connectSerial();
} else {
  console.log("☁️ Running in CLOUD MODE (Serial OFF)");
}

/* ================= SAVE DATA ================= */
setInterval(() => {
  if (!latestData) return;

  db.run(`
    INSERT INTO sensor_data (temperature, humidity, ppm, dust, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `, [
    latestData.temperature,
    latestData.humidity,
    latestData.ppm,
    latestData.dust,
    getManilaTime()
  ]);
}, 60000);

/* ================= SYSTEM STATUS ================= */
setInterval(() => {
  const diff = (Date.now() - lastPacketTime) / 1000;

  let signal = "LIVE";
  if (diff > 2) signal = "DELAYED";
  if (diff > 5) signal = "DISCONNECTED";

  io.emit("system-status", {
    serial: serialStatus,
    signal,
    lastUpdate: diff.toFixed(1)
  });
}, 1000);

/* ================= START SERVER ================= */
server.listen(3000, () => {
  console.log("🚀 http://localhost:3000");
});