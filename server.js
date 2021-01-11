import cors from "cors";
import express from "express";
import Web3 from "web3";
import bn from "bn.js";

import dbClient from "./db/client";

import NftxContract from "./contracts/NFTXv4.json";
import XStoreContract from "./contracts/XStore.json";
import Erc20Contract from "./contracts/ERC20.json";

import addresses from "./addresses/mainnet.json";

import xcollection from "./routes/xcollection";
import {
  addToCollection,
  getCollection,
  updateInCollection,
  replaceInCollection,
} from "./db";

const app = express();

// testing
app.get("/", (_, res) => {
  res.send("<h1>Hello from Express Server!</h1>");
});

const web3 = new Web3(
  "https://eth-mainnet.alchemyapi.io/v2/fL1uiXELcu8QeuLAxoCNmnbf_XuVlHBD"
);

const nftx = new web3.eth.Contract(NftxContract.abi, addresses.nftxProxy);
const xStore = new web3.eth.Contract(XStoreContract.abi, addresses.xStore);
const nftxToken = new web3.eth.Contract(
  Erc20Contract.abi,
  "0x87d73e916d7057945c9bcd8cdd94e42a6f47f776"
);

app.get("/nftx-circulating-supply", async (_, res) => {
  const ignoreList = [
    "0x8f217d5cccd08fd9dce24d6d42aba2bb4ff4785b", // founder
    "0x40d73df4f99bae688ce3c23a01022224fe16c7b2", // dao
    "0x843d81eAF23c0073426581dE5a3735B060888f1b", // operations
  ];
  let supply = new bn(await nftxToken.methods.totalSupply().call());
  for (let i = 0; i < ignoreList.length; i++) {
    let amount = new bn(
      await nftxToken.methods.balanceOf(ignoreList[i]).call()
    );
    supply = supply.sub(amount);
  }
  res.send(web3.utils.fromWei(supply));
});

app.use(cors());
app.use(express.json());

app.use("/xcollection", xcollection);

app.listen(process.env.PORT || 5000);

//
let loopIndex = 0;
const cycle = async () => {
  console.log("\ncycling...", loopIndex);

  const lastChunkArr = await dbClient
    .db("xdb")
    .collection("xstore_event_chunks")
    .find()
    .project({ events: 0 })
    .sort({ startBlock: -1 })
    .limit(1)
    .toArray();

  console.log("mostRecentChunk", lastChunkArr);

  let startBlock = null;
  if (lastChunkArr && lastChunkArr[0]) {
    const lastChunk = lastChunkArr[0];
    const currentBlock = await web3.eth.getBlockNumber();
    if (lastChunk.endBlock < currentBlock) {
      startBlock = lastChunk.endBlock + 1;
    } else {
      console.log(
        "lastChunk.endBlock not < currentBlock",
        lastChunk.endBlock,
        currentBlock
      );
    }
  } else if (Array.isArray(lastChunkArr) && lastChunkArr.length === 0) {
    startBlock = 11442000;
  }

  if (startBlock !== null) {
    console.log("startBLock !== null", startBlock);

    const newChunks = await fetchEventChunks(xStore, startBlock);
    if (
      newChunks.length === 1 &&
      newChunks[0].events.length === 0 &&
      lastChunkArr[0]
    ) {
      console.log(
        "no new events, going to update",
        lastChunkArr[0].endBlock,
        "to",
        newChunks[0].endBlock
      );
      await updateInCollection("xstore_event_chunks", lastChunkArr[0], {
        endBlock: newChunks[0].endBlock,
      });
    } else if (newChunks.length > 0) {
      console.log(
        "newChunks.length =",
        newChunks.length,
        " newChunks[0].events.length:",
        newChunks[0].events.length
      );
      newChunks.sort((a, b) => a.startBlock - b.startBlock);
      for (let i = 0; i < newChunks.length; i++) {
        console.log(
          "adding obj to collection with startBlock:",
          newChunks[i].startBlock,
          " and endBlock:",
          newChunks[i].endBlock
        );
        await addToCollection("xstore_event_chunks", newChunks[i]);
      }
    }
  } else {
    console.log("startBlock = null");
  }

  console.log("finished cycle");
  setTimeout(() => {
    loopIndex += 1;
    cycle();
  }, 3000);
};

const fetchEventChunks = async (contract, initialBlock) => {
  console.log("inside fetch event chunks");
  // const initialBlock = 11442000;
  const currentBlock = await web3.eth.getBlockNumber();
  let startBlock = initialBlock;
  let interval = 1024;
  let eventChunks = [];
  while (startBlock <= currentBlock) {
    console.log("\ninside first while loop");
    interval *= 2;
    console.log("doubling interval to", interval);
    let events;
    let endBlock;
    while (!events) {
      endBlock =
        startBlock + interval > currentBlock
          ? currentBlock
          : startBlock + interval;

      console.log("\ninside second while loop, interval = ", interval);
      console.log("startBlock =", startBlock, " endBlock =", endBlock);
      try {
        events = await contract.getPastEvents("allEvents", {
          fromBlock: startBlock,
          toBlock: endBlock,
        });
        console.log("got _events, length = ", events.length);
      } catch (error) {
        if (error.message.includes("response size exceeded")) {
          if (interval <= 1) {
            throw "bottomed out inside cycle()";
          } else {
            console.log(error.message);
            interval /= 2;
            console.log("dividing interval in half to", interval);
          }
        } else {
          throw error;
        }
      }
    }
    console.log("outside second while loop");
    eventChunks.push({ startBlock, endBlock, events });
    startBlock = endBlock + 1;
  }
  console.log("outside first while loop");

  return eventChunks;
};

setTimeout(() => {
  cycle();
}, 3000);
