const express = require("express");
const cors = require("cors");
require("dotenv").config();
/*
require("./db");
require("./jobs");
*/
const app = express();

app.use(cors({ origin: "*" }));
app.use(express.json());

app.get("/hello", (req, res) => {
  res.send("Hello World");
});

/*
app.use("/auth", require("./routes/auth.routes"));
app.use("/webhook", require("./routes/webhook.routes"));
app.use("/leads", require("./routes/leads.routes"));
*/

module.exports = app;
