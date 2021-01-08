import express from "express";

import { addToXCollection, getXCollection, replaceInXCollection } from "../db";

const router = express.Router();

router.get("/", async (_, res) => {
  res.status(200);
  res.send(await getXCollection());
  // res.send("hello world");
});

router.post("/add", async (req, res) => {
  res.status(201);
  res.json(await addToXCollection(req.body));
});

// router.put("/replace", async (req, res) => {
//   res.status(204);
//   res.json(await replaceInXCollection(req.body));
// });

export default router;
