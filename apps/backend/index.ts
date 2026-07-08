import express from "express";
import cors from "cors"; 
import { middleware } from "./middleware";
const app = express();
app.use(express.json())
app.use(cors())

app.post("/buy",middleware, (req, res) => {
  res.json({
    message:"hi!"
    })
})
app.post("/sell",middleware, (req, res) => {
    const {  } = req.body;
})
app.post("/split",middleware,(req, res) => {
    const {  } = req.body;
})
app.post("/merge",middleware, (req, res) => {
    const {  } = req.body;
})
app.get("/balance",middleware, (req, res) => {
    const {  } = req.body;
})
app.get("/position",middleware, (req, res) => {
    const {  } = req.body;
})
app.get("/history",middleware, (req, res) => {
    const {  } = req.body;
})
app.listen(3000, () => {
    console.log("Server is running on port 3000");
})